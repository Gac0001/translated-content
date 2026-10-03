'use strict';
/**
 * Sauvegarde PostgreSQL (pg_dump, format personnalisé) dans BACKUP_DIR.
 * Chaque tentative, réussie ou non, est inscrite au registre `sauvegardes`.
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const config = require('../config/env');
const db = require('../db/knex');
const { AppError } = require('../utils/errors');

async function enregistrer(row) {
  try { await db('sauvegardes').insert(row); } catch (e) { console.error('[SAUVEGARDE] registre indisponible :', e.message); }
}

/**
 * @param suffixe   suffixe du nom de fichier (ex. « -avant-reinitialisation »)
 * @param options   { origine: MANUELLE | AVANT_REINITIALISATION | PROGRAMMEE, user: { id, username } }
 */
async function creerSauvegarde(suffixe = '', { origine = 'MANUELLE', user = null } = {}) {
  const debut = Date.now();
  const auteur = { user_id: user ? user.id : null, username: user ? user.username : 'système' };
  fs.mkdirSync(config.backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const file = path.join(config.backupDir, `sig-dep-${stamp}${suffixe}.dump`);
  const url = new URL(config.databaseUrl);
  const env = { ...process.env, PGPASSWORD: decodeURIComponent(url.password) };
  const args = ['-h', url.hostname, '-p', url.port || '5432', '-U', decodeURIComponent(url.username), '-F', 'c', '-f', file, url.pathname.slice(1)];
  try {
    await new Promise((resolve, reject) => {
      const p = spawn(config.pgDumpPath, args, { env });
      let err = '';
      p.stderr.on('data', (d) => { err += d; });
      p.on('error', () => reject(new AppError(500, 'PG_DUMP_INDISPONIBLE', 'pg_dump est introuvable. Installez les outils clients PostgreSQL ou renseignez PG_DUMP_PATH dans le fichier .env.')));
      p.on('close', (code) => (code === 0 ? resolve() : reject(new AppError(500, 'SAUVEGARDE_ECHEC', `Échec de la sauvegarde : ${err.trim().slice(0, 300)}`))));
    });
  } catch (e) {
    try { fs.unlinkSync(file); } catch (x) { /* fichier partiel absent */ }
    await enregistrer({ statut: 'ECHEC', origine, erreur: e.message, duree_ms: Date.now() - debut, ...auteur });
    await require('./alertes').alerter({ type: 'SAUVEGARDE_ECHEC', gravite: 'ATTENTION', titre: 'Échec d’une sauvegarde de la base', message: e.message, user, unique: 60 });
    throw e;
  }
  const r = { fichier: path.basename(file), tailleOctets: fs.statSync(file).size };
  await enregistrer({ statut: 'REUSSIE', origine, fichier: r.fichier, taille_octets: r.tailleOctets, duree_ms: Date.now() - debut, ...auteur });
  return r;
}

/** Dernière sauvegarde réussie (registre, à défaut fichiers présents), échecs récents. */
async function etatSauvegardes() {
  const [derniere, derniereTentative, echecs30j] = await Promise.all([
    db('sauvegardes').where({ statut: 'REUSSIE' }).orderBy('created_at', 'desc').first(),
    db('sauvegardes').orderBy('created_at', 'desc').first(),
    db('sauvegardes').where({ statut: 'ECHEC' }).where('created_at', '>', db.raw(`now() - interval '30 days'`)).count('* as n').first(),
  ]);
  let fichier = null;
  if (!derniere) {
    try {
      fichier = fs.readdirSync(config.backupDir).filter((f) => /\.(dump|sql)$/.test(f))
        .map((f) => ({ f, d: fs.statSync(path.join(config.backupDir, f)).mtime })).sort((a, b) => b.d - a.d)[0] || null;
    } catch (e) { /* aucun répertoire */ }
  }
  return {
    derniereReussie: derniere ? { date: derniere.created_at, fichier: derniere.fichier, tailleOctets: Number(derniere.taille_octets), origine: derniere.origine }
      : fichier ? { date: fichier.d, fichier: fichier.f, origine: 'FICHIER' } : null,
    derniereTentative: derniereTentative ? { date: derniereTentative.created_at, statut: derniereTentative.statut, erreur: derniereTentative.erreur } : null,
    echecs30j: Number(echecs30j.n),
  };
}

module.exports = { creerSauvegarde, etatSauvegardes };

'use strict';
/**
 * Centre de santé du système : contrôle de chaque composant (API, PostgreSQL, stockage,
 * sauvegarde, courriels, génération PDF/Excel), historique et alertes de changement d’état.
 *
 * États : OK | ATTENTION | PANNE | INACTIF (composant désactivé par configuration).
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const PDFDocument = require('pdfkit');
const ExcelJS = require('exceljs');
const db = require('../db/knex');
const config = require('../config/env');
const { politique } = require('./politique');
const { etatSauvegardes } = require('./sauvegarde');
const { verifyConnection } = require('./mailer');
const { alerter } = require('./alertes');
const { version } = require('../../package.json');

const ORDRE = { OK: 0, INACTIF: 0, ATTENTION: 1, PANNE: 2 };
const LIBELLES = { api: 'API', postgresql: 'PostgreSQL', stockage: 'Stockage', sauvegarde: 'Sauvegarde', courriels: 'Courriels', documents: 'PDF / Excel' };

const octets = (n) => (n >= 1073741824 ? `${(n / 1073741824).toFixed(1)} Go` : `${Math.round(n / 1048576)} Mo`);

function avecDelai(promesse, ms, message) {
  let t;
  return Promise.race([promesse, new Promise((_, rej) => { t = setTimeout(() => rej(new Error(message)), ms); })]).finally(() => clearTimeout(t));
}

/** Version de l’application : numéro, commit (si disponible), dernière migration. */
function versionApplication() {
  let commit = process.env.APP_COMMIT || null;
  if (!commit) {
    try {
      const gitDir = path.resolve(__dirname, '../../../../.git');
      const head = fs.readFileSync(path.join(gitDir, 'HEAD'), 'utf8').trim();
      commit = head.startsWith('ref:') ? fs.readFileSync(path.join(gitDir, head.slice(5).trim()), 'utf8').trim() : head;
    } catch (e) { commit = null; }
  }
  return { version, commit: commit ? commit.slice(0, 8) : null, node: process.version, environnement: config.env };
}

/** Espace disque du volume des fichiers (Node ≥ 18.15). */
async function espaceDisque() {
  const s = await fs.promises.statfs(config.uploadDir);
  const total = s.blocks * s.bsize; const libre = s.bavail * s.bsize;
  return { total, libre, pourcentLibre: total ? Math.round((libre / total) * 1000) / 10 : 0 };
}

async function controlerApi() {
  const m = process.memoryUsage();
  return { statut: 'OK', detail: `Opérationnelle — version ${version}, disponible depuis ${Math.round(process.uptime() / 60)} min, mémoire ${Math.round(m.rss / 1048576)} Mo.` };
}

async function controlerPostgresql() {
  const t0 = Date.now();
  try {
    await avecDelai(db.raw('select 1'), 5000, 'délai dépassé (5 s)');
    const ms = Date.now() - t0;
    const taille = (await db.raw('select pg_size_pretty(pg_database_size(current_database())) as t')).rows[0].t;
    return { statut: ms > 1000 ? 'ATTENTION' : 'OK', detail: `${ms > 1000 ? 'Lente' : 'Opérationnelle'} — réponse en ${ms} ms, base de ${taille}.`, mesure: ms };
  } catch (e) {
    return { statut: 'PANNE', detail: `Indisponible : ${e.message}` };
  }
}

async function controlerStockage() {
  const p = await politique();
  try {
    const d = await espaceDisque();
    // Test d’écriture réel dans le répertoire des fichiers
    const test = path.join(config.uploadDir, `.sante-${crypto.randomUUID()}`);
    fs.writeFileSync(test, 'ok'); fs.unlinkSync(test);
    const statut = d.pourcentLibre < p.disque_seuil_critique ? 'PANNE' : d.pourcentLibre < p.disque_seuil_attention ? 'ATTENTION' : 'OK';
    return { statut, detail: `${octets(d.libre)} libres sur ${octets(d.total)} (${d.pourcentLibre} %)${statut === 'OK' ? '' : ` — seuil ${statut === 'PANNE' ? 'critique' : 'd’alerte'} : ${statut === 'PANNE' ? p.disque_seuil_critique : p.disque_seuil_attention} %`}.`, mesure: d.pourcentLibre };
  } catch (e) {
    return { statut: 'PANNE', detail: `Écriture impossible dans le répertoire des fichiers : ${e.message}` };
  }
}

async function controlerSauvegarde() {
  try {
    const s = await etatSauvegardes();
    if (!s.derniereReussie) return { statut: 'ATTENTION', detail: 'Aucune sauvegarde réussie enregistrée.' };
    const heures = Math.round((Date.now() - new Date(s.derniereReussie.date).getTime()) / 3600000);
    const echecRecent = s.derniereTentative && s.derniereTentative.statut === 'ECHEC';
    const testEchoue = s.dernierTest && s.dernierTest.statut !== 'OK';
    const statut = heures > 24 * 7 ? 'PANNE' : (heures > 48 || echecRecent || testEchoue) ? 'ATTENTION' : 'OK';
    return { statut, detail: `Dernière sauvegarde réussie il y a ${heures} h${echecRecent ? ' ; la dernière tentative a échoué' : ''}${s.echecs30j ? ` ; ${s.echecs30j} échec(s) en 30 jours` : ''}${s.dernierTest ? ` ; dernier test de restauration ${s.dernierTest.statut === 'OK' ? 'réussi' : 'ÉCHOUÉ'}` : ''}.`, mesure: heures };
  } catch (e) {
    return { statut: 'ATTENTION', detail: `État des sauvegardes indisponible : ${e.message}` };
  }
}

async function controlerCourriels() {
  if (!config.mail.enabled) return { statut: 'INACTIF', detail: 'Messagerie désactivée (MAIL_ENABLED=false) : alertes et récupération par e-mail indisponibles.' };
  try {
    const v = await avecDelai(verifyConnection(), 8000, 'délai dépassé (8 s)');
    if (!v.ok) return { statut: 'PANNE', detail: v.message };
    const echecs = Number((await db('email_outbox').where('statut', 'ECHEC').where('created_at', '>', db.raw(`now() - interval '24 hours'`)).count('* as n').first()).n);
    return { statut: echecs ? 'ATTENTION' : 'OK', detail: `Serveur de messagerie joignable${echecs ? ` ; ${echecs} envoi(s) en échec sur 24 h` : ''}.` };
  } catch (e) {
    return { statut: 'PANNE', detail: `Serveur de messagerie injoignable : ${e.message}` };
  }
}

async function controlerDocuments() {
  try {
    const t0 = Date.now();
    const pdf = await new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4' });
      const parts = [];
      doc.on('data', (c) => parts.push(c)); doc.on('end', () => resolve(Buffer.concat(parts))); doc.on('error', reject);
      doc.text('Contrôle de santé du SIG-DEP'); doc.end();
    });
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet('Contrôle').addRow(['SIG-DEP', new Date()]);
    const xlsx = await wb.xlsx.writeBuffer();
    if (pdf.slice(0, 4).toString() !== '%PDF' || xlsx.length < 100) throw new Error('fichier généré invalide');
    return { statut: 'OK', detail: `PDF et Excel générés en ${Date.now() - t0} ms.` };
  } catch (e) {
    return { statut: 'PANNE', detail: `Génération impossible : ${e.message}` };
  }
}

const CONTROLES = { api: controlerApi, postgresql: controlerPostgresql, stockage: controlerStockage, sauvegarde: controlerSauvegarde, courriels: controlerCourriels, documents: controlerDocuments };

let dernierEtat = null; // conservé en mémoire : utile si la base elle-même est indisponible
let panneBaseDepuis = null;

/** Exécute tous les contrôles, enregistre le résultat et signale les changements d’état. */
async function controler(origine = 'AUTO') {
  const t0 = Date.now();
  const entrees = await Promise.all(Object.entries(CONTROLES).map(async ([cle, fn]) => {
    try { return [cle, { libelle: LIBELLES[cle], ...(await fn()) }]; } catch (e) { return [cle, { libelle: LIBELLES[cle], statut: 'PANNE', detail: e.message }]; }
  }));
  const composants = Object.fromEntries(entrees);
  const global = Object.values(composants).reduce((g, c) => (ORDRE[c.statut] > ORDRE[g] ? c.statut : g), 'OK');
  const resultat = { global, composants, dureeMs: Date.now() - t0, verifieAt: new Date().toISOString(), version: versionApplication() };

  if (composants.postgresql.statut === 'PANNE') {
    panneBaseDepuis = panneBaseDepuis || new Date();
    console.error(`[SANTE] PostgreSQL indisponible depuis ${panneBaseDepuis.toISOString()}`);
    dernierEtat = resultat;
    return resultat;
  }
  // Comparaison avec le contrôle précédent (en base, à défaut en mémoire)
  const precedent = (await db('sante_controles').orderBy('id', 'desc').first()) || (dernierEtat && { composants: dernierEtat.composants });
  await db('sante_controles').insert({ global, composants: JSON.stringify(composants), duree_ms: resultat.dureeMs, origine });
  if (panneBaseDepuis) {
    const minutes = Math.round((Date.now() - panneBaseDepuis.getTime()) / 60000);
    await alerter({ type: 'SANTE_RETABLI', gravite: 'ATTENTION', titre: 'PostgreSQL de nouveau disponible', message: `Indisponibilité constatée pendant environ ${minutes} minute(s), depuis le ${panneBaseDepuis.toLocaleString('fr-FR', { timeZone: 'Africa/Kinshasa' })}.` });
    panneBaseDepuis = null;
  }
  if (precedent) {
    for (const [cle, c] of Object.entries(composants)) {
      const avant = precedent.composants[cle] && precedent.composants[cle].statut;
      if (!avant || avant === c.statut) continue;
      if (c.statut === 'PANNE') await alerter({ type: 'SANTE_PANNE', gravite: 'CRITIQUE', titre: `${c.libelle} en panne`, message: c.detail });
      else if (c.statut === 'ATTENTION' && avant === 'OK') await alerter({ type: 'SANTE_DEGRADE', gravite: 'ATTENTION', titre: `${c.libelle} : à surveiller`, message: c.detail });
      else if (avant === 'PANNE' || (c.statut === 'OK' && ORDRE[avant] > 0)) {
        await alerter({ type: 'SANTE_RETABLI', gravite: 'INFO', titre: `${c.libelle} rétabli${c.statut === 'ATTENTION' ? ' (à surveiller)' : ''}`, message: c.detail });
      }
    }
  } else {
    for (const c of Object.values(composants)) if (c.statut === 'PANNE') await alerter({ type: 'SANTE_PANNE', gravite: 'CRITIQUE', titre: `${c.libelle} en panne`, message: c.detail });
  }
  dernierEtat = resultat;
  return resultat;
}

/** Dernier contrôle connu (sans relancer les contrôles). */
async function dernierControle() {
  const r = await db('sante_controles').orderBy('id', 'desc').first();
  return r ? { global: r.global, composants: r.composants, dureeMs: r.duree_ms, verifieAt: r.created_at, origine: r.origine } : null;
}

module.exports = { controler, dernierControle, versionApplication, espaceDisque, LIBELLES };

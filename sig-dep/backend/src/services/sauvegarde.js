'use strict';
/**
 * Sauvegardes PostgreSQL (pg_dump, format personnalisé) dans BACKUP_DIR.
 *
 *  - Chiffrement AES-256-GCM lorsque BACKUP_ENC_KEY est définie (fichier « .dump.enc ») ;
 *  - empreinte SHA-256 du fichier final, copie hors serveur (BACKUP_COPY_DIR) ;
 *  - registre de chaque tentative (réussie ou échouée), palier de conservation des sauvegardes
 *    programmées (quotidienne, hebdomadaire, mensuelle) et purge selon la politique ;
 *  - vérification d’intégrité (empreinte + lecture de l’archive) et test de restauration réel
 *    dans une base temporaire.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { pipeline } = require('stream/promises');
const knexLib = require('knex');
const config = require('../config/env');
const db = require('../db/knex');
const { AppError } = require('../utils/errors');
const { politique } = require('./politique');

const MAGIC = Buffer.from('SIGDEPENC1');
const lazyAlerter = (...a) => require('./alertes').alerter(...a);

// ─── Outils ──────────────────────────────────────────────────────────────────
const cle = () => (config.backupEncKey ? crypto.createHash('sha256').update(config.backupEncKey).digest() : null);
const cleEmpreinte = () => (config.backupEncKey ? crypto.createHash('sha256').update(`id:${config.backupEncKey}`).digest('hex').slice(0, 16) : null);

function connexionPg(url = config.databaseUrl) {
  const u = new URL(url);
  return { u, env: { ...process.env, PGPASSWORD: decodeURIComponent(u.password) }, base: ['-h', u.hostname, '-p', u.port || '5432', '-U', decodeURIComponent(u.username)] };
}

function executer(binaire, args, env, libelle) {
  return new Promise((resolve, reject) => {
    const p = spawn(binaire, args, { env });
    let out = ''; let err = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', () => reject(new AppError(500, 'OUTIL_INDISPONIBLE', `${libelle} est introuvable. Installez les outils clients PostgreSQL ou renseignez ${binaire === config.pgDumpPath ? 'PG_DUMP_PATH' : 'PG_RESTORE_PATH'} dans le fichier .env.`)));
    p.on('close', (code) => (code === 0 ? resolve(out) : reject(new AppError(500, 'OUTIL_ECHEC', `${libelle} a échoué : ${err.trim().slice(0, 400)}`))));
  });
}

function sha256Fichier(f) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    fs.createReadStream(f).on('data', (d) => h.update(d)).on('end', () => resolve(h.digest('hex'))).on('error', reject);
  });
}

/** Chiffre un fichier : MAGIC | IV (12) | données chiffrées | étiquette GCM (16). */
async function chiffrerFichier(src, dst, k = cle()) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', k, iv);
  const out = fs.createWriteStream(dst);
  out.write(Buffer.concat([MAGIC, iv]));
  await pipeline(fs.createReadStream(src), c, out, { end: false });
  await new Promise((resolve, reject) => { out.on('error', reject); out.end(c.getAuthTag(), resolve); });
}

/** Déchiffre un fichier produit par chiffrerFichier (l’étiquette est vérifiée : toute altération est détectée). */
async function dechiffrerFichier(src, dst, k = cle()) {
  if (!k) throw new AppError(400, 'CLE_ABSENTE', 'Sauvegarde chiffrée : la clé BACKUP_ENC_KEY n’est pas définie sur ce serveur.');
  const taille = fs.statSync(src).size;
  const fd = fs.openSync(src, 'r');
  const entete = Buffer.alloc(MAGIC.length + 12); fs.readSync(fd, entete, 0, entete.length, 0);
  const tag = Buffer.alloc(16); fs.readSync(fd, tag, 0, 16, taille - 16);
  fs.closeSync(fd);
  if (!entete.subarray(0, MAGIC.length).equals(MAGIC)) throw new AppError(400, 'FORMAT', 'Fichier chiffré invalide.');
  const d = crypto.createDecipheriv('aes-256-gcm', k, entete.subarray(MAGIC.length));
  d.setAuthTag(tag);
  try {
    await pipeline(fs.createReadStream(src, { start: entete.length, end: taille - 17 }), d, fs.createWriteStream(dst));
  } catch (e) {
    throw new AppError(400, 'DECHIFFREMENT', 'Déchiffrement impossible : clé incorrecte ou fichier altéré.');
  }
}

/** Fichier « .dump » lisible par pg_restore (déchiffré dans un fichier temporaire si nécessaire). */
async function archiveLisible(fichier) {
  const chemin = path.join(config.backupDir, path.basename(fichier));
  if (!fs.existsSync(chemin)) throw new AppError(404, 'INTROUVABLE', `Fichier de sauvegarde introuvable : ${path.basename(fichier)}.`);
  if (!chemin.endsWith('.enc')) return { chemin, nettoyer: () => {} };
  const tmp = path.join(config.backupDir, `.tmp-${crypto.randomUUID()}.dump`);
  try { await dechiffrerFichier(chemin, tmp); } catch (e) { try { fs.unlinkSync(tmp); } catch (x) { /* rien */ } throw e; }
  return { chemin: tmp, nettoyer: () => { try { fs.unlinkSync(tmp); } catch (x) { /* rien */ } } };
}

// ─── Heure de Kinshasa et paliers ───────────────────────────────────────────
function kinshasa(d = new Date()) {
  const k = new Date(d.toLocaleString('en-US', { timeZone: 'Africa/Kinshasa' }));
  const date = `${k.getFullYear()}-${String(k.getMonth() + 1).padStart(2, '0')}-${String(k.getDate()).padStart(2, '0')}`;
  const lundi = new Date(k); lundi.setDate(k.getDate() - ((k.getDay() + 6) % 7));
  const semaine = `${lundi.getFullYear()}-${String(lundi.getMonth() + 1).padStart(2, '0')}-${String(lundi.getDate()).padStart(2, '0')}`;
  return { date, mois: date.slice(0, 7), semaine, heure: `${String(k.getHours()).padStart(2, '0')}:${String(k.getMinutes()).padStart(2, '0')}`, jour: k.getDay() };
}

/** Palier d’une nouvelle sauvegarde programmée : première du mois, sinon première de la semaine, sinon quotidienne. */
function determinerPalier(maintenant, precedentes) {
  const k = kinshasa(maintenant);
  const deja = precedentes.map((p) => kinshasa(new Date(p.created_at)));
  if (!deja.some((x) => x.mois === k.mois)) return 'MENSUELLE';
  if (!deja.some((x) => x.semaine === k.semaine)) return 'HEBDOMADAIRE';
  return 'QUOTIDIENNE';
}

/**
 * Faut-il lancer la sauvegarde programmée maintenant ? (fonction pure, testée)
 * Une par jour à partir de l’heure prévue ; jusqu’à 3 tentatives espacées d’une heure en cas d’échec.
 */
function doitSauvegarder(maintenant, p, tentativesDuJour) {
  if (!p.sauvegarde_auto) return false;
  const k = kinshasa(maintenant);
  if (k.heure < p.sauvegarde_heure) return false;
  if (tentativesDuJour.some((t) => t.statut === 'REUSSIE')) return false;
  if (tentativesDuJour.length >= 3) return false;
  const derniere = tentativesDuJour.reduce((m, t) => Math.max(m, new Date(t.created_at).getTime()), 0);
  return !derniere || maintenant.getTime() - derniere >= 3600000;
}

/**
 * Sauvegardes à supprimer selon la politique (fonction pure, testée) :
 * programmées → les N plus récentes, + N hebdomadaires (ou mensuelles), + N mensuelles ;
 * ponctuelles (manuelles, avant opération) → au-delà de X jours.
 */
function aSupprimer(sauvegardes, p, maintenant = new Date()) {
  const actives = sauvegardes.filter((s) => s.statut === 'REUSSIE' && !s.supprimee_at).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  const prog = actives.filter((s) => s.origine === 'PROGRAMMEE');
  const garder = new Set([
    ...prog.slice(0, p.retention_quotidienne),
    ...prog.filter((s) => ['HEBDOMADAIRE', 'MENSUELLE'].includes(s.palier)).slice(0, p.retention_hebdomadaire),
    ...prog.filter((s) => s.palier === 'MENSUELLE').slice(0, p.retention_mensuelle),
  ].map((s) => s.id));
  const limite = maintenant.getTime() - p.retention_ponctuelle_jours * 86400000;
  return actives.filter((s) => (s.origine === 'PROGRAMMEE' ? !garder.has(s.id) : new Date(s.created_at).getTime() < limite));
}

// ─── Création ────────────────────────────────────────────────────────────────
async function enregistrer(row) {
  try { return (await db('sauvegardes').insert(row).returning('*'))[0]; } catch (e) { console.error('[SAUVEGARDE] registre indisponible :', e.message); return null; }
}

/**
 * @param suffixe   suffixe du nom de fichier (ex. « -avant-reinitialisation »)
 * @param options   { origine: MANUELLE | PROGRAMMEE | AVANT_REINITIALISATION | AVANT_RESTAURATION | AVANT_MIGRATION, user, palier }
 */
async function creerSauvegarde(suffixe = '', { origine = 'MANUELLE', user = null, palier = null } = {}) {
  const debut = Date.now();
  const auteur = { user_id: user ? user.id : null, username: user ? user.username : 'système' };
  fs.mkdirSync(config.backupDir, { recursive: true });
  // Horodatage à la milliseconde, et jamais d’écrasement d’un fichier existant
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 23);
  const chiffre = !!cle();
  let nom = `sig-dep-${stamp}${suffixe}.dump${chiffre ? '.enc' : ''}`;
  for (let i = 2; fs.existsSync(path.join(config.backupDir, nom)); i++) nom = `sig-dep-${stamp}-${i}${suffixe}.dump${chiffre ? '.enc' : ''}`;
  const final = path.join(config.backupDir, nom);
  const brut = chiffre ? path.join(config.backupDir, `.tmp-${crypto.randomUUID()}.dump`) : final;
  const { u, env, base } = connexionPg();
  try {
    await executer(config.pgDumpPath, [...base, '-F', 'c', '-f', brut, u.pathname.slice(1)], env, 'pg_dump');
    if (chiffre) { await chiffrerFichier(brut, final); fs.unlinkSync(brut); }
  } catch (e) {
    for (const f of new Set([brut, final])) { try { fs.unlinkSync(f); } catch (x) { /* absent */ } }
    await enregistrer({ statut: 'ECHEC', origine, palier, erreur: e.message, duree_ms: Date.now() - debut, ...auteur });
    await lazyAlerter({ type: 'SAUVEGARDE_ECHEC', gravite: 'ATTENTION', titre: 'Échec d’une sauvegarde de la base', message: e.message, user, unique: 60 });
    throw e;
  }
  const empreinte = await sha256Fichier(final);
  // Copie hors serveur
  let copie = { copie_statut: 'ABSENTE', copie_detail: 'BACKUP_COPY_DIR non défini : aucune copie hors du serveur.' };
  if (config.backupCopyDir) {
    try {
      fs.mkdirSync(config.backupCopyDir, { recursive: true });
      fs.copyFileSync(final, path.join(config.backupCopyDir, nom));
      if ((await sha256Fichier(path.join(config.backupCopyDir, nom))) !== empreinte) throw new Error('empreinte de la copie différente');
      copie = { copie_statut: 'OK', copie_detail: path.join(config.backupCopyDir, nom) };
    } catch (e) {
      copie = { copie_statut: 'ECHEC', copie_detail: e.message };
      await lazyAlerter({ type: 'COPIE_ECHEC', gravite: 'ATTENTION', titre: 'Copie de la sauvegarde hors du serveur impossible', message: `${config.backupCopyDir} : ${e.message}`, unique: 60 });
    }
  }
  const row = await enregistrer({
    statut: 'REUSSIE', origine, palier, fichier: nom, taille_octets: fs.statSync(final).size, duree_ms: Date.now() - debut,
    empreinte, chiffre, cle_empreinte: cleEmpreinte(), ...copie, ...auteur,
  });
  return { id: row && row.id, fichier: nom, tailleOctets: fs.statSync(final).size, empreinte, chiffre, copie: copie.copie_statut };
}

// ─── Vérifications ───────────────────────────────────────────────────────────
async function noterVerification(row, type, statut, detail, debut, { origine = 'MANUEL', user = null } = {}) {
  await db('verifications_sauvegarde').insert({ sauvegarde_id: row.id, fichier: row.fichier, type, statut, detail: JSON.stringify(detail), duree_ms: Date.now() - debut, origine, username: user ? user.username : 'système' });
  if (type === 'INTEGRITE') await db('sauvegardes').where({ id: row.id }).update({ verifiee_at: db.fn.now(), verification_statut: statut });
  if (statut === 'ECHEC') {
    await lazyAlerter({ type: type === 'INTEGRITE' ? 'SAUVEGARDE_ALTEREE' : 'TEST_RESTAURATION_ECHEC', gravite: 'CRITIQUE', titre: type === 'INTEGRITE' ? `Sauvegarde ${row.fichier} inutilisable` : `Test de restauration échoué (${row.fichier})`, message: detail.erreur || JSON.stringify(detail).slice(0, 300), user, unique: 60 });
  }
}

/** Intégrité : présence, empreinte, déchiffrement, lecture de l’archive par pg_restore. */
async function verifierIntegrite(row, opts = {}) {
  const debut = Date.now();
  const detail = {};
  let archive = null;
  try {
    const chemin = path.join(config.backupDir, row.fichier);
    detail.present = fs.existsSync(chemin);
    if (!detail.present) throw new Error('fichier absent du répertoire des sauvegardes');
    detail.empreinteConforme = !row.empreinte || (await sha256Fichier(chemin)) === row.empreinte;
    if (!detail.empreinteConforme) throw new Error('empreinte différente : fichier modifié ou corrompu');
    if (row.chiffre && row.cle_empreinte && row.cle_empreinte !== cleEmpreinte()) throw new Error('chiffrée avec une autre clé que la clé BACKUP_ENC_KEY actuelle');
    archive = await archiveLisible(row.fichier);
    const liste = await executer(config.pgRestorePath, ['--list', archive.chemin], process.env, 'pg_restore');
    detail.objets = liste.split('\n').filter((l) => l && !l.startsWith(';')).length;
    detail.tables = liste.split('\n').filter((l) => / TABLE DATA /.test(l)).length;
    if (!detail.tables) throw new Error('archive sans données');
    await noterVerification(row, 'INTEGRITE', 'OK', detail, debut, opts);
    return { statut: 'OK', detail };
  } catch (e) {
    detail.erreur = e.message;
    await noterVerification(row, 'INTEGRITE', 'ECHEC', detail, debut, opts);
    return { statut: 'ECHEC', detail };
  } finally { if (archive) archive.nettoyer(); }
}

/** Test de restauration réel dans une base temporaire, contrôlée puis supprimée. */
async function testerRestauration(row, opts = {}) {
  const debut = Date.now();
  const detail = {};
  const { u, env, base } = connexionPg();
  const nomBase = `${u.pathname.slice(1)}_verif_${Date.now()}`.replace(/[^a-z0-9_]/gi, '_').slice(0, 60);
  let archive = null; let creee = false; let temp = null;
  try {
    archive = await archiveLisible(row.fichier);
    await db.raw(`CREATE DATABASE "${nomBase}"`); creee = true;
    await executer(config.pgRestorePath, [...base, '--no-owner', '--exit-on-error', '-d', nomBase, archive.chemin], env, 'pg_restore');
    const url = new URL(config.databaseUrl); url.pathname = `/${nomBase}`;
    temp = knexLib({ client: 'pg', connection: url.toString(), pool: { min: 0, max: 1 } });
    const compte = async (t) => Number((await temp(t).count('* as n').first()).n);
    detail.tables = Number((await temp.raw(`select count(*) as n from pg_tables where schemaname = 'public'`)).rows[0].n);
    detail.comptes = await compte('users');
    detail.agents = await compte('agents');
    detail.entreesAudit = await compte('audit_logs');
    const ruptures = (await temp.raw(`select count(*) as n from (select empreinte, audit_empreinte(a) as calc, empreinte_precedente,
      coalesce(lag(empreinte) over (order by maillon), repeat('0', 64)) as prec from audit_logs a where maillon is not null) x
      where empreinte is distinct from calc or empreinte_precedente is distinct from prec`)).rows[0].n;
    detail.auditIntegre = Number(ruptures) === 0;
    detail.migrations = await compte('knex_migrations');
    if (!detail.comptes || !detail.auditIntegre) throw new Error(!detail.comptes ? 'aucun compte dans la base restaurée' : 'journal d’audit restauré non intègre');
    await noterVerification(row, 'RESTAURATION', 'OK', detail, debut, opts);
    return { statut: 'OK', detail };
  } catch (e) {
    detail.erreur = e.message;
    await noterVerification(row, 'RESTAURATION', 'ECHEC', detail, debut, opts);
    return { statut: 'ECHEC', detail };
  } finally {
    if (temp) await temp.destroy();
    if (creee) { try { await db.raw(`DROP DATABASE IF EXISTS "${nomBase}" WITH (FORCE)`); } catch (e) { console.error('[SAUVEGARDE] base temporaire non supprimée :', nomBase, e.message); } }
    if (archive) archive.nettoyer();
  }
}

// ─── Planification et conservation ──────────────────────────────────────────
/** Supprime les sauvegardes hors politique (fichier, copie) et l’inscrit au registre. */
async function appliquerRetention() {
  const p = await politique();
  const cibles = aSupprimer(await db('sauvegardes').where({ statut: 'REUSSIE' }).whereNull('supprimee_at'), p);
  for (const s of cibles) {
    for (const dir of [config.backupDir, config.backupCopyDir].filter(Boolean)) { try { fs.unlinkSync(path.join(dir, s.fichier)); } catch (e) { /* déjà absent */ } }
    await db('sauvegardes').where({ id: s.id }).update({ supprimee_at: db.fn.now() });
  }
  return cibles.map((s) => s.fichier);
}

/** Tâche minute : sauvegarde nocturne, conservation, test de restauration hebdomadaire. */
async function tachePlanifiee(maintenant = new Date()) {
  const p = await politique();
  const k = kinshasa(maintenant);
  const programmees = await db('sauvegardes').where({ origine: 'PROGRAMMEE' }).orderBy('created_at', 'desc').limit(400);
  const duJour = programmees.filter((t) => kinshasa(new Date(t.created_at)).date === k.date);
  if (doitSauvegarder(maintenant, p, duJour)) {
    const palier = determinerPalier(maintenant, programmees.filter((t) => t.statut === 'REUSSIE'));
    try {
      const r = await creerSauvegarde('', { origine: 'PROGRAMMEE', palier });
      const row = await db('sauvegardes').where({ id: r.id }).first();
      await verifierIntegrite(row, { origine: 'AUTO' });
      await appliquerRetention();
    } catch (e) { /* échec déjà enregistré et signalé */ }
  }
  // Test de restauration hebdomadaire, le jour prévu, après la sauvegarde du jour
  if (p.test_restauration_auto && k.jour === p.test_restauration_jour && k.heure >= p.sauvegarde_heure) {
    const dejaFait = await db('verifications_sauvegarde').where({ type: 'RESTAURATION', origine: 'AUTO' }).where('created_at', '>', db.raw(`now() - interval '20 hours'`)).first();
    const derniere = await db('sauvegardes').where({ statut: 'REUSSIE' }).whereNull('supprimee_at').orderBy('created_at', 'desc').first();
    if (!dejaFait && derniere) await testerRestauration(derniere, { origine: 'AUTO' });
  }
}

/** Dernière sauvegarde réussie, dernière tentative, échecs récents, dernier test de restauration. */
async function etatSauvegardes() {
  const [derniere, derniereTentative, echecs30j, test] = await Promise.all([
    db('sauvegardes').where({ statut: 'REUSSIE' }).whereNull('supprimee_at').orderBy('created_at', 'desc').first(),
    db('sauvegardes').orderBy('created_at', 'desc').first(),
    db('sauvegardes').where({ statut: 'ECHEC' }).where('created_at', '>', db.raw(`now() - interval '30 days'`)).count('* as n').first(),
    db('verifications_sauvegarde').where({ type: 'RESTAURATION' }).orderBy('created_at', 'desc').first(),
  ]);
  let fichier = null;
  if (!derniere) {
    try {
      fichier = fs.readdirSync(config.backupDir).filter((f) => /\.(dump|sql|enc)$/.test(f))
        .map((f) => ({ f, d: fs.statSync(path.join(config.backupDir, f)).mtime })).sort((a, b) => b.d - a.d)[0] || null;
    } catch (e) { /* aucun répertoire */ }
  }
  return {
    derniereReussie: derniere ? { date: derniere.created_at, fichier: derniere.fichier, tailleOctets: Number(derniere.taille_octets), origine: derniere.origine, chiffre: derniere.chiffre, copie: derniere.copie_statut }
      : fichier ? { date: fichier.d, fichier: fichier.f, origine: 'FICHIER' } : null,
    derniereTentative: derniereTentative ? { date: derniereTentative.created_at, statut: derniereTentative.statut, erreur: derniereTentative.erreur } : null,
    echecs30j: Number(echecs30j.n),
    dernierTest: test ? { date: test.created_at, statut: test.statut, fichier: test.fichier } : null,
    chiffrement: !!cle(), copieHorsServeur: config.backupCopyDir,
  };
}

module.exports = {
  creerSauvegarde, etatSauvegardes, verifierIntegrite, testerRestauration, appliquerRetention, tachePlanifiee,
  chiffrerFichier, dechiffrerFichier, archiveLisible, sha256Fichier, connexionPg, executer,
  doitSauvegarder, determinerPalier, aSupprimer, kinshasa,
};

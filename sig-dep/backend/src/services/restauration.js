'use strict';
/**
 * Restauration d’une sauvegarde : demande de l’Admin Système → validation du Directeur
 * (mot de passe, 24 h) → exécution par l’Admin (phrase, mot de passe, second facteur).
 *
 * Exécution :
 *  1. sauvegarde de l’état actuel (retour arrière automatique en cas d’échec) ;
 *  2. mode maintenance imposé ;
 *  3. mise de côté des traces postérieures au début de la sauvegarde (audit, connexions,
 *     alertes) et des registres techniques (sauvegardes, vérifications, demandes) ;
 *  4. remplacement du schéma par la sauvegarde, puis migrations ;
 *  5. réintégration des traces (marquées « réintégrées après restauration ») et des registres ;
 *  6. révocation de toutes les sessions ; audit et alerte critique (Directeur informé).
 */
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcrypt');
const db = require('../db/knex');
const config = require('../config/env');
const { AppError } = require('../utils/errors');
const sauvegarde = require('./sauvegarde');
const maintenance = require('./maintenance');
const { audit } = require('./audit');
const { notify } = require('./notifications');
const { alerter, adminsActifs, directeursActifs } = require('./alertes');
const { verifierSecondFacteur } = require('./deuxFacteurs');
const { invalider } = require('./politique');

const PHRASE = 'RESTAURER';
const VALIDITE_HEURES = 24;
const REGISTRES = ['sauvegardes', 'verifications_sauvegarde', 'demandes_restauration'];

const erreur = (status, code, message) => new AppError(status, code, message);

async function expirer() {
  await db('demandes_restauration').whereIn('statut', ['EN_ATTENTE', 'VALIDEE']).where('expire_at', '<', db.fn.now()).update({ statut: 'EXPIREE' });
}

async function demander(sauvegardeId, motif, req) {
  await expirer();
  const s = await db('sauvegardes').where({ id: sauvegardeId, statut: 'REUSSIE' }).whereNull('supprimee_at').first();
  if (!s) throw erreur(404, 'INTROUVABLE', 'Sauvegarde introuvable ou supprimée.');
  if (await db('demandes_restauration').whereIn('statut', ['EN_ATTENTE', 'VALIDEE']).first()) throw erreur(409, 'DEMANDE_EN_COURS', 'Une demande de restauration est déjà en cours : attendez sa décision ou annulez-la.');
  const v = await sauvegarde.verifierIntegrite(s, { user: { id: req.ctx.userId, username: req.ctx.username } });
  if (v.statut !== 'OK') throw erreur(400, 'SAUVEGARDE_INUTILISABLE', `Cette sauvegarde ne peut pas être restaurée : ${v.detail.erreur}.`);
  const [d] = await db('demandes_restauration').insert({
    sauvegarde_id: s.id, fichier: s.fichier, sauvegarde_date: s.created_at, motif,
    demande_par: req.ctx.userId, demande_par_username: req.ctx.username, expire_at: new Date(Date.now() + VALIDITE_HEURES * 3600000),
  }).returning('*');
  await audit(req, { action: 'DEMANDE_RESTAURATION', module: 'sauvegarde', entite: 'restauration', entiteId: d.id, apres: { fichier: s.fichier, date: s.created_at }, message: motif });
  await notify(await directeursActifs(), { type: 'SECURITE', titre: 'Demande de restauration de la base à valider', message: `L’Admin Système demande la restauration de la sauvegarde du ${new Date(s.created_at).toLocaleString('fr-FR', { timeZone: 'Africa/Kinshasa' })}. Motif : ${motif}. Sans décision, la demande expire dans ${VALIDITE_HEURES} h.`, lien: '/restaurations', expediteur: req.ctx.userId });
  return d;
}

async function decider(id, { decision, motDePasse, commentaire }, req) {
  await expirer();
  const d = await db('demandes_restauration').where({ id }).first();
  if (!d) throw erreur(404, 'INTROUVABLE', 'Demande introuvable.');
  if (d.statut !== 'EN_ATTENTE') throw erreur(400, 'STATUT', `Cette demande est ${d.statut === 'EXPIREE' ? 'expirée' : 'déjà traitée'}.`);
  const u = await db('users').where({ id: req.ctx.userId }).first();
  if (!motDePasse || !(await bcrypt.compare(motDePasse, u.password_hash))) throw erreur(400, 'MOT_DE_PASSE', 'Mot de passe incorrect.');
  const valide = decision === 'VALIDER';
  await db('demandes_restauration').where({ id }).update({
    statut: valide ? 'VALIDEE' : 'REFUSEE', decide_par: req.ctx.userId, decide_par_username: req.ctx.username, decide_at: db.fn.now(),
    decision_commentaire: commentaire || null, ...(valide ? { expire_at: new Date(Date.now() + VALIDITE_HEURES * 3600000) } : {}),
  });
  await audit(req, { action: valide ? 'VALIDATION_RESTAURATION' : 'REFUS_RESTAURATION', module: 'sauvegarde', entite: 'restauration', entiteId: id, message: commentaire || d.fichier });
  await notify(await adminsActifs(), { type: 'SECURITE', titre: valide ? 'Restauration validée par le Directeur' : 'Restauration refusée par le Directeur', message: `${d.fichier}${commentaire ? ` — ${commentaire}` : ''}${valide ? ` (exécutable pendant ${VALIDITE_HEURES} h)` : ''}`, lien: '/restaurations', expediteur: req.ctx.userId });
  return db('demandes_restauration').where({ id }).first();
}

async function annuler(id, req) {
  const d = await db('demandes_restauration').where({ id }).first();
  if (!d || !['EN_ATTENTE', 'VALIDEE'].includes(d.statut)) throw erreur(400, 'STATUT', 'Seule une demande en cours peut être annulée.');
  await db('demandes_restauration').where({ id }).update({ statut: 'ANNULEE' });
  await audit(req, { action: 'ANNULATION_RESTAURATION', module: 'sauvegarde', entite: 'restauration', entiteId: id, message: d.fichier });
}

// ─── Exécution ───────────────────────────────────────────────────────────────
async function remplacerSchema(archive) {
  const { u, env, base } = sauvegarde.connexionPg();
  await db.raw('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await sauvegarde.executer(config.pgRestorePath, [...base, '--no-owner', '--exit-on-error', '--single-transaction', '-d', u.pathname.slice(1), archive], env, 'pg_restore');
}

async function reinsererTraces(traces, dateSauvegarde) {
  const n = { audit: 0, connexions: 0, alertes: 0 };
  const marque = `[Réintégré après restauration de la sauvegarde du ${new Date(dateSauvegarde).toLocaleString('fr-FR', { timeZone: 'Africa/Kinshasa' })}]`;
  const empreintes = new Set(await db('audit_logs').whereNotNull('empreinte').pluck('empreinte'));
  for (const a of traces.audit) {
    if (a.empreinte && empreintes.has(a.empreinte)) continue; // déjà présente dans la sauvegarde
    const { id, maillon, empreinte, empreinte_precedente: ep, ...reste } = a;
    await db('audit_logs').insert({ ...reste, ancienne_valeur: reste.ancienne_valeur ? JSON.stringify(reste.ancienne_valeur) : null, nouvelle_valeur: reste.nouvelle_valeur ? JSON.stringify({ ...(reste.nouvelle_valeur || {}), _reintegre: { id_origine: id, maillon_origine: maillon, empreinte_origine: empreinte } }) : JSON.stringify({ _reintegre: { id_origine: id, maillon_origine: maillon, empreinte_origine: empreinte } }), message: `${marque} ${reste.message || ''}`.trim() });
    n.audit += 1;
  }
  for (const l of traces.connexions) {
    const deja = await db('login_history').where({ created_at: l.created_at, username: l.username, succes: l.succes }).first();
    if (deja) continue;
    const { id, ...reste } = l;
    await db('login_history').insert(reste); n.connexions += 1;
  }
  for (const al of traces.alertes) {
    const deja = await db('alertes_securite').where({ created_at: al.created_at, type: al.type }).first();
    if (deja) continue;
    const { id, ...reste } = al;
    await db('alertes_securite').insert({ ...reste, details: reste.details ? JSON.stringify(reste.details) : null }); n.alertes += 1;
  }
  return n;
}

async function restaurerRegistres(registres) {
  for (const t of REGISTRES) {
    await db(t).del();
    const rows = registres[t].map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v !== null && typeof v === 'object' && !(v instanceof Date) ? JSON.stringify(v) : v])));
    for (let i = 0; i < rows.length; i += 200) await db(t).insert(rows.slice(i, i + 200));
    await db.raw(`SELECT setval(pg_get_serial_sequence('${t}', 'id'), GREATEST((SELECT COALESCE(MAX(id), 0) FROM ${t}), 1))`);
  }
}

async function executer(id, { confirmation, motDePasse, code }, req) {
  await expirer();
  const d = await db('demandes_restauration').where({ id }).first();
  if (!d) throw erreur(404, 'INTROUVABLE', 'Demande introuvable.');
  if (d.statut !== 'VALIDEE') throw erreur(400, 'STATUT', d.statut === 'EN_ATTENTE' ? 'La demande n’a pas encore été validée par le Directeur.' : `Demande ${d.statut.toLowerCase()} : exécution impossible.`);
  if (String(confirmation || '').trim().toUpperCase() !== PHRASE) throw erreur(400, 'CONFIRMATION', `Saisissez « ${PHRASE} » pour confirmer.`);
  const u = await db('users').where({ id: req.ctx.userId }).first();
  if (!motDePasse || !(await bcrypt.compare(motDePasse, u.password_hash))) throw erreur(400, 'MOT_DE_PASSE', 'Mot de passe incorrect.');
  if (!(await verifierSecondFacteur(u, code)).ok) throw erreur(400, 'CODE_2FA', 'Code de double authentification incorrect.');
  const s = await db('sauvegardes').where({ fichier: d.fichier, statut: 'REUSSIE' }).whereNull('supprimee_at').first();
  if (!s) throw erreur(404, 'INTROUVABLE', 'La sauvegarde demandée n’est plus disponible.');
  const auteur = { id: req.ctx.userId, username: req.ctx.username };
  const debutSauvegarde = new Date(new Date(s.created_at).getTime() - (s.duree_ms || 0) - 60000);

  const v = await sauvegarde.verifierIntegrite(s, { user: auteur });
  if (v.statut !== 'OK') throw erreur(400, 'SAUVEGARDE_INUTILISABLE', `Sauvegarde inutilisable : ${v.detail.erreur}.`);
  // 1. Sauvegarde de l’état actuel : indispensable au retour arrière
  const avant = await sauvegarde.creerSauvegarde('-avant-restauration', { origine: 'AVANT_RESTAURATION', user: auteur });
  await audit(req, { action: 'RESTAURATION', module: 'sauvegarde', entite: 'restauration', entiteId: id, message: `Début de la restauration de ${s.fichier} (état actuel sauvegardé : ${avant.fichier})` });

  // 2. Maintenance imposée
  maintenance.imposer('Restauration de la base de données en cours. Le service reprendra dans quelques minutes.');
  const resultat = { fichier: s.fichier, sauvegardeAvant: avant.fichier };
  let archive = null; let archiveAvant = null;
  try {
    // 3. Traces et registres mis de côté (conservés aussi dans un fichier)
    const traces = {
      audit: await db('audit_logs').where('created_at', '>=', debutSauvegarde).orderBy('maillon'),
      connexions: await db('login_history').where('created_at', '>=', debutSauvegarde).orderBy('id'),
      alertes: await db('alertes_securite').where('created_at', '>=', debutSauvegarde).orderBy('id'),
    };
    const registres = Object.fromEntries(await Promise.all(REGISTRES.map(async (t) => [t, await db(t).orderBy('id')])));
    const nomTraces = `traces-avant-restauration-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.json`;
    fs.writeFileSync(path.join(config.backupDir, nomTraces), JSON.stringify({ demande: d, traces, registres }, null, 1));
    resultat.fichierTraces = nomTraces;

    // 4. Remplacement du schéma ; en cas d’échec, retour à l’état sauvegardé juste avant
    archive = await sauvegarde.archiveLisible(s.fichier);
    try {
      await remplacerSchema(archive.chemin);
    } catch (e) {
      archiveAvant = await sauvegarde.archiveLisible(avant.fichier);
      await remplacerSchema(archiveAvant.chemin);
      throw erreur(500, 'RESTAURATION_ECHEC', `Restauration impossible (${e.message}). La base a été remise dans son état d’avant la restauration.`);
    }
    await db.migrate.latest();
    invalider();

    // 5. Réintégration des traces et des registres
    await restaurerRegistres(registres);
    resultat.reintegre = await reinsererTraces(traces, s.created_at);
    // 6. Toutes les sessions sont révoquées (les comptes reviennent à l’état de la sauvegarde)
    await db('refresh_tokens').whereNull('revoked_at').update({ revoked_at: db.fn.now(), revoked_reason: 'RESTAURATION' });
    await db('users').increment('token_version', 1);
    await db('demandes_restauration').where({ id }).update({ statut: 'EXECUTEE', execute_at: db.fn.now(), execute_par_username: req.ctx.username, resultat: JSON.stringify(resultat) });
    await audit(req, { action: 'RESTAURATION', module: 'sauvegarde', entite: 'restauration', entiteId: id, apres: resultat, message: `Base restaurée à partir de ${s.fichier} (sauvegarde du ${new Date(s.created_at).toISOString()})` });
    await alerter({ type: 'RESTAURATION', gravite: 'CRITIQUE', titre: 'Base de données restaurée', message: `Sauvegarde du ${new Date(s.created_at).toLocaleString('fr-FR', { timeZone: 'Africa/Kinshasa' })} restaurée par ${req.ctx.username}. Traces réintégrées : ${resultat.reintegre.audit} entrée(s) d’audit. Toutes les sessions ont été fermées.`, user: auteur });
    return resultat;
  } catch (e) {
    resultat.erreur = e.message;
    try { await db('demandes_restauration').where({ id }).update({ statut: 'ECHEC', execute_at: db.fn.now(), execute_par_username: req.ctx.username, resultat: JSON.stringify(resultat) }); } catch (x) { /* registre indisponible */ }
    await audit(req, { action: 'RESTAURATION', module: 'sauvegarde', entite: 'restauration', entiteId: id, resultat: 'ECHEC', message: e.message });
    await alerter({ type: 'RESTAURATION_ECHEC', gravite: 'CRITIQUE', titre: 'Échec de la restauration de la base', message: e.message, user: auteur });
    throw e;
  } finally {
    if (archive) archive.nettoyer();
    if (archiveAvant) archiveAvant.nettoyer();
    maintenance.lever();
  }
}

module.exports = { demander, decider, annuler, executer, expirer, PHRASE, VALIDITE_HEURES };

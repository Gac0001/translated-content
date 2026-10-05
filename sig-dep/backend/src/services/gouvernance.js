'use strict';
/**
 * Gouvernance du compte Admin Système (cahier des charges, § 12) :
 *  1. double confirmation des opérations critiques par le Directeur ;
 *  2. accès de support temporaire aux pièces jointes, validé par le Directeur et audité ;
 *  3. compte d’urgence scellé, activé par le Directeur ou le Secrétaire Général, surveillé.
 */
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const db = require('../db/knex');
const { notify } = require('./notifications');
const { alerter, directeursActifs } = require('./alertes');
const { comptesExercant } = require('./interims');
const { revokeAllForUser } = require('./tokens');
const { temporaryPassword } = require('../utils/password');
const { badRequest, forbidden, notFound, conflict } = require('../utils/errors');

const heure = 3600000;
const fr = (d) => new Date(d).toLocaleString('fr-FR', { timeZone: 'Africa/Kinshasa', dateStyle: 'short', timeStyle: 'short' });

async function verifierMotDePasse(userId, motDePasse) {
  const u = await db('users').where({ id: userId }).first();
  if (!motDePasse || !(await bcrypt.compare(motDePasse, u.password_hash))) throw badRequest('Mot de passe incorrect.');
  return u;
}

// ═══ 1. Double confirmation des opérations critiques ════════════════════════
const OPERATIONS = {
  REINITIALISATION: 'Réinitialisation de la base',
  POLITIQUE: 'Modification de la politique de sécurité',
  MIGRATIONS: 'Application des migrations de la base',
  ROLE_ADMIN: 'Modification des permissions du rôle Admin Système',
};
const VALIDITE_HEURES = 24;

/** Forme canonique (clés triées) pour comparer les paramètres d’une opération à ceux de la demande. */
function canon(v) {
  if (Array.isArray(v)) return `[${v.map(canon).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(',')}}`;
  return JSON.stringify(v);
}

async function expirerConfirmations() {
  await db('demandes_confirmation').whereIn('statut', ['EN_ATTENTE', 'CONFIRMEE']).where('expire_at', '<', db.fn.now())
    .update({ statut: 'EXPIREE', updated_at: db.fn.now() });
}

/**
 * Exige la confirmation du Directeur avant une opération critique.
 * Renvoie { demande } si une demande confirmée de l’auteur porte exactement sur ces paramètres,
 * sinon { reponse } (202) : demande créée ou déjà en attente.
 */
async function exigerConfirmation(req, type, parametres, resume) {
  await expirerConfirmations();
  const cle = canon(parametres);
  const candidates = await db('demandes_confirmation').where({ type, demandeur_id: req.ctx.userId })
    .whereIn('statut', ['EN_ATTENTE', 'CONFIRMEE']).orderBy('id', 'desc');
  const meme = candidates.find((d) => canon(d.parametres) === cle);
  if (meme && meme.statut === 'CONFIRMEE') return { demande: meme };
  if (meme) {
    return { reponse: { confirmationRequise: true, demande: meme, message: 'Cette opération attend déjà la confirmation du Directeur.' } };
  }
  const [d] = await db('demandes_confirmation').insert({
    type, parametres: JSON.stringify(parametres), resume, motif: (req.body && req.body.motif) || null,
    demandeur_id: req.ctx.userId, demandeur: req.ctx.username, expire_at: new Date(Date.now() + VALIDITE_HEURES * heure),
  }).returning('*');
  await notify(await directeursActifs(), {
    type: 'SECURITE', titre: `Opération critique à confirmer : ${OPERATIONS[type]}`,
    message: `${resume} — demandée par ${req.ctx.username}. Sans décision, la demande expire dans ${VALIDITE_HEURES} h.`, lien: '/gouvernance',
  });
  await require('./audit').audit(req, { action: 'DEMANDE_CONFIRMATION', module: 'gouvernance', entite: 'demande_confirmation', entiteId: d.id, apres: { type, resume } });
  return { reponse: { confirmationRequise: true, demande: d, message: 'Opération critique : une demande de confirmation a été adressée au Directeur. Relancez l’opération une fois la demande confirmée.' } };
}

/** Réserve une demande confirmée pour l’exécution (une seule exécution possible). */
async function consommer(demande) {
  const n = await db('demandes_confirmation').where({ id: demande.id, statut: 'CONFIRMEE' }).where('expire_at', '>', db.fn.now())
    .update({ statut: 'EXECUTEE', execute_at: db.fn.now(), updated_at: db.fn.now() });
  if (!n) throw conflict('Cette confirmation a déjà été utilisée ou a expiré.', 'CONFIRMATION_INVALIDE');
}

/** L’exécution a échoué : la confirmation reste utilisable jusqu’à son échéance. */
async function restituer(demande) {
  await db('demandes_confirmation').where({ id: demande.id, statut: 'EXECUTEE' }).update({ statut: 'CONFIRMEE', execute_at: null, updated_at: db.fn.now() });
}

async function deciderConfirmation(ctx, id, { decision, motDePasse, commentaire }) {
  await expirerConfirmations();
  const d = await db('demandes_confirmation').where({ id }).first();
  if (!d) throw notFound('Demande introuvable.');
  if (d.statut !== 'EN_ATTENTE') throw badRequest('Cette demande n’est plus en attente.');
  if (d.demandeur_id === ctx.userId) throw forbidden('L’auteur d’une demande ne peut pas la confirmer.', 'CONFLIT_INTERET');
  await verifierMotDePasse(ctx.userId, motDePasse);
  if (decision === 'REFUSER' && (!commentaire || commentaire.trim().length < 5)) throw badRequest('Motivez le refus.');
  await db('demandes_confirmation').where({ id }).update({
    statut: decision === 'CONFIRMER' ? 'CONFIRMEE' : 'REFUSEE', decideur_id: ctx.userId, decideur: ctx.username, decide_at: db.fn.now(),
    commentaire: commentaire || null, updated_at: db.fn.now(),
    // Une confirmation s’exécute dans les 24 heures.
    ...(decision === 'CONFIRMER' ? { expire_at: new Date(Date.now() + VALIDITE_HEURES * heure) } : {}),
  });
  await notify(d.demandeur_id, {
    type: 'SECURITE', titre: `${OPERATIONS[d.type]} : ${decision === 'CONFIRMER' ? 'confirmée par le Directeur' : 'refusée par le Directeur'}`,
    message: decision === 'CONFIRMER' ? `Relancez l’opération dans les ${VALIDITE_HEURES} heures. ${d.resume}` : commentaire, lien: '/gouvernance',
  });
  return db('demandes_confirmation').where({ id }).first();
}

async function annulerConfirmation(ctx, id) {
  const d = await db('demandes_confirmation').where({ id }).first();
  if (!d) throw notFound('Demande introuvable.');
  if (d.demandeur_id !== ctx.userId) throw forbidden('Seul l’auteur peut annuler sa demande.');
  if (!['EN_ATTENTE', 'CONFIRMEE'].includes(d.statut)) throw badRequest('Cette demande ne peut plus être annulée.');
  await db('demandes_confirmation').where({ id }).update({ statut: 'ANNULEE', updated_at: db.fn.now() });
}

// ═══ 2. Accès de support temporaire ═════════════════════════════════════════
const TYPES_SUPPORT = { COURRIER: 'Courrier', DOCUMENT: 'Document', INSTRUCTION: 'Instruction', TASK: 'Tâche', PIP: 'Fiche PIP', ACTE: 'Acte administratif' };

function porteeSupport(a) {
  if (!a.entity_type) return 'toutes les pièces jointes';
  return `pièces jointes ${a.entity_id ? `de l’élément ${TYPES_SUPPORT[a.entity_type]} n° ${a.entity_id}` : `des éléments de type ${TYPES_SUPPORT[a.entity_type]}`}`;
}

async function expirerSupport() {
  const echus = await db('acces_support').where({ statut: 'ACTIF' }).where('fin_at', '<', db.fn.now());
  if (echus.length) await db('acces_support').whereIn('id', echus.map((a) => a.id)).update({ statut: 'EXPIRE', updated_at: db.fn.now() });
}

async function demanderSupport(ctx, { motif, entity_type: type, entity_id: entityId, duree_minutes: duree }) {
  const enCours = await db('acces_support').where({ demandeur_id: ctx.userId }).whereIn('statut', ['EN_ATTENTE', 'ACTIF']).where((w) => w.whereNull('fin_at').orWhere('fin_at', '>', db.fn.now())).first();
  if (enCours) throw conflict('Un accès de support est déjà en attente ou actif : terminez-le avant d’en demander un autre.');
  const [a] = await db('acces_support').insert({
    demandeur_id: ctx.userId, demandeur: ctx.username, motif, entity_type: type || null, entity_id: entityId || null, duree_minutes: duree,
  }).returning('*');
  await notify(await directeursActifs(), {
    type: 'SECURITE', titre: 'Accès de support à valider',
    message: `${ctx.username} demande un accès de ${duree} min aux ${porteeSupport(a)}. Motif : ${motif}`, lien: '/gouvernance',
  });
  return a;
}

async function deciderSupport(ctx, id, { decision, motDePasse, commentaire }) {
  await expirerSupport();
  const a = await db('acces_support').where({ id }).first();
  if (!a) throw notFound('Demande introuvable.');
  if (a.demandeur_id === ctx.userId) throw forbidden('L’auteur d’une demande ne peut pas la valider.', 'CONFLIT_INTERET');
  await verifierMotDePasse(ctx.userId, motDePasse);
  if (decision === 'REVOQUER') {
    if (a.statut !== 'ACTIF') throw badRequest('Cet accès n’est pas actif.');
    await db('acces_support').where({ id }).update({ statut: 'REVOQUE', fin_at: db.fn.now(), commentaire: commentaire || a.commentaire, updated_at: db.fn.now() });
  } else {
    if (a.statut !== 'EN_ATTENTE') throw badRequest('Cette demande n’est plus en attente.');
    if (decision === 'REFUSER' && (!commentaire || commentaire.trim().length < 5)) throw badRequest('Motivez le refus.');
    const debut = new Date();
    await db('acces_support').where({ id }).update({
      statut: decision === 'VALIDER' ? 'ACTIF' : 'REFUSE', decideur_id: ctx.userId, decideur: ctx.username, decide_at: db.fn.now(), commentaire: commentaire || null,
      ...(decision === 'VALIDER' ? { debut_at: debut, fin_at: new Date(debut.getTime() + a.duree_minutes * 60000) } : {}), updated_at: db.fn.now(),
    });
  }
  const r = await db('acces_support').where({ id }).first();
  const libelle = { VALIDER: `accordé jusqu’au ${r.fin_at ? fr(r.fin_at) : ''}`, REFUSER: 'refusé', REVOQUER: 'révoqué' }[decision];
  await notify(a.demandeur_id, { type: 'SECURITE', titre: `Accès de support ${libelle}`, message: commentaire || porteeSupport(a), lien: '/gouvernance' });
  return r;
}

async function terminerSupport(ctx, id) {
  const a = await db('acces_support').where({ id }).first();
  if (!a || a.demandeur_id !== ctx.userId) throw notFound('Accès introuvable.');
  if (!['EN_ATTENTE', 'ACTIF'].includes(a.statut)) throw badRequest('Cet accès est déjà terminé.');
  await db('acces_support').where({ id }).update({ statut: a.statut === 'ACTIF' ? 'TERMINE' : 'REFUSE', fin_at: db.fn.now(), commentaire: a.statut === 'ACTIF' ? a.commentaire : 'Demande retirée par son auteur', updated_at: db.fn.now() });
}

/** Accès de support actif couvrant cet élément pour cet utilisateur (lecture seule). */
async function accesSupportActif(ctx, type, id) {
  if (!ctx.roles.includes('ADMIN_SYSTEME')) return null;
  return db('acces_support').where({ demandeur_id: ctx.userId, statut: 'ACTIF' }).where('fin_at', '>', db.fn.now())
    .where((w) => w.whereNull('entity_type').orWhere((c) => c.where('entity_type', type).where((cc) => cc.whereNull('entity_id').orWhere('entity_id', id))))
    .first();
}

async function noterConsultation(acces) {
  await db('acces_support').where({ id: acces.id }).increment('consultations', 1);
}

// ═══ 3. Compte d’urgence ════════════════════════════════════════════════════
const URGENCE_MAX_HEURES = 24;

async function compteUrgence(trx = db) {
  return trx('users').where({ compte_urgence: true }).first();
}

async function etatUrgence() {
  const u = await compteUrgence();
  const historique = await db('activations_urgence').orderBy('id', 'desc').limit(20);
  return {
    username: u ? u.username : null,
    actif: !!u && u.statut !== 'DESACTIVE',
    jusqua: u ? u.urgence_jusqua : null,
    historique,
  };
}

async function destinatairesUrgence() {
  return [...await directeursActifs(), ...await comptesExercant('SECRETAIRE_GENERAL')];
}

/**
 * Active le compte d’urgence pour une durée limitée et renvoie un mot de passe temporaire,
 * à remettre à la personne chargée de l’intervention. À la connexion : nouveau mot de passe et
 * double authentification sur son propre téléphone.
 */
async function activerUrgence({ par, parId = null, motif, heures }) {
  if (!motif || motif.trim().length < 10) throw badRequest('Motif requis (10 caractères au moins).');
  if (!Number.isInteger(heures) || heures < 1 || heures > URGENCE_MAX_HEURES) throw badRequest(`Durée entre 1 et ${URGENCE_MAX_HEURES} heures.`);
  const u = await compteUrgence();
  if (!u) throw notFound('Compte d’urgence absent : appliquez les migrations.');
  if (u.statut !== 'DESACTIVE') throw conflict('Le compte d’urgence est déjà actif.');
  const temp = temporaryPassword();
  const jusqua = new Date(Date.now() + heures * heure);
  await db.transaction(async (trx) => {
    await trx('users').where({ id: u.id }).update({
      password_hash: await bcrypt.hash(temp, 12), statut: 'ACTIF', must_change_password: true, failed_attempts: 0, locked_until: null,
      totp_actif: false, totp_secret: null, totp_active_at: null, urgence_jusqua: jusqua, updated_at: trx.fn.now(),
    });
    await trx('codes_secours').where({ user_id: u.id }).del();
    await trx('activations_urgence').insert({ active_par_id: parId, active_par: par, motif, fin_prevue_at: jusqua });
  });
  await revokeAllForUser(u.id, 'ACTIVATION_URGENCE');
  await alerter({ type: 'URGENCE_ACTIVE', gravite: 'CRITIQUE', titre: 'Compte d’urgence activé', message: `Par ${par}, jusqu’au ${fr(jusqua)}. Motif : ${motif}`, user: { id: u.id, username: u.username } });
  await notify(await comptesExercant('SECRETAIRE_GENERAL'), { type: 'SECURITE', titre: 'Compte d’urgence activé', message: `Par ${par}, jusqu’au ${fr(jusqua)}. Motif : ${motif}`, lien: '/gouvernance' });
  return { username: u.username, motDePasseTemporaire: temp, jusqua };
}

async function fermerUrgence({ par, motif = 'Fermeture manuelle' }) {
  const u = await compteUrgence();
  if (!u || u.statut === 'DESACTIVE') return false;
  await db.transaction(async (trx) => {
    await trx('users').where({ id: u.id }).update({
      password_hash: await bcrypt.hash(crypto.randomBytes(32).toString('base64'), 12), statut: 'DESACTIVE', must_change_password: true,
      totp_actif: false, totp_secret: null, totp_active_at: null, urgence_jusqua: null, updated_at: trx.fn.now(),
    });
    await trx('codes_secours').where({ user_id: u.id }).del();
    await trx('activations_urgence').whereNull('fin_at').update({ fin_at: trx.fn.now(), ferme_par: par, motif_fermeture: motif });
  });
  await revokeAllForUser(u.id, 'FERMETURE_URGENCE');
  await alerter({ type: 'URGENCE_FERMEE', gravite: 'ATTENTION', titre: 'Compte d’urgence refermé', message: `Par ${par} — ${motif}.`, user: { id: u.id, username: u.username } });
  await notify(await destinatairesUrgence(), { type: 'SECURITE', titre: 'Compte d’urgence refermé', message: `Par ${par} — ${motif}.`, lien: '/gouvernance' });
  return true;
}

/** Toute connexion au compte d’urgence est signalée immédiatement au Directeur et au SG. */
async function signalerConnexionUrgence(user, ip) {
  await db('activations_urgence').whereNull('fin_at').increment('connexions', 1);
  await alerter({ type: 'URGENCE_CONNEXION', gravite: 'CRITIQUE', titre: 'Connexion au compte d’urgence', message: `Depuis l’adresse ${ip}, le ${fr(new Date())}.`, user: { id: user.id, username: user.username }, ip });
  await notify(await comptesExercant('SECRETAIRE_GENERAL'), { type: 'SECURITE', titre: 'Connexion au compte d’urgence', message: `Depuis l’adresse ${ip}.`, lien: '/gouvernance' });
}

/** Tâche périodique : échéances des confirmations, des accès de support et du compte d’urgence. */
async function tachePeriodique() {
  await expirerConfirmations();
  await expirerSupport();
  const u = await compteUrgence();
  if (u && u.statut !== 'DESACTIVE' && u.urgence_jusqua && new Date(u.urgence_jusqua) <= new Date()) {
    await fermerUrgence({ par: 'SIG-DEP', motif: 'Échéance de l’activation' });
  }
}

module.exports = {
  OPERATIONS, TYPES_SUPPORT, VALIDITE_HEURES, URGENCE_MAX_HEURES, canon,
  exigerConfirmation, consommer, restituer, deciderConfirmation, annulerConfirmation, expirerConfirmations,
  demanderSupport, deciderSupport, terminerSupport, accesSupportActif, noterConsultation, porteeSupport, expirerSupport,
  compteUrgence, etatUrgence, activerUrgence, fermerUrgence, signalerConnexionUrgence, tachePeriodique, verifierMotDePasse,
};

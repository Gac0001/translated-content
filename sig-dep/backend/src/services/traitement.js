'use strict';
/**
 * Étapes communes aux instructions et aux tâches (annexe 2 du cahier des charges) :
 * blocage motivé, rapport intermédiaire, annulation, prolongation motivée de l’échéance.
 * L’exécutant signale ; l’émetteur décide. Chaque étape est historisée, auditée et notifiée.
 */
const db = require('../db/knex');
const { audit } = require('./audit');
const { notify } = require('./notifications');
const { addHistory } = require('./history');
const { badRequest, forbidden, conflict } = require('../utils/errors');
const { aujourdhui } = require('./interims');

const LIBELLES = {
  BROUILLON: 'Brouillon', TRANSMISE: 'Transmise', RECUE: 'Reçue', EN_COURS: 'En cours', BLOQUEE: 'Bloquée',
  RAPPORT_INTERMEDIAIRE: 'Rapport intermédiaire', A_CORRIGER: 'À corriger', EXECUTEE: 'Exécutée', VALIDEE: 'Validée',
  CLOTUREE: 'Clôturée', EN_RETARD: 'En retard', ANNULEE: 'Annulée',
};
/** Statuts dans lesquels l’exécutant travaille (avancement, rapport, blocage, compte rendu). */
const ACTIFS = ['TRANSMISE', 'RECUE', 'EN_COURS', 'RAPPORT_INTERMEDIAIRE', 'A_CORRIGER', 'EN_RETARD'];
const TERMINES = ['VALIDEE', 'CLOTUREE', 'ANNULEE'];

const CONFIG = {
  INSTRUCTION: {
    table: 'instructions', executant: 'destinataire_user_id', emetteur: 'emetteur_user_id', lien: '/instructions/',
    module: 'instructions', notif: 'INSTRUCTION', notifRetour: 'INSTRUCTION_REPONSE', libelle: (r) => r.objet,
  },
  TASK: {
    table: 'tasks', executant: 'agent_user_id', emetteur: 'assigne_par_user_id', lien: '/taches/',
    module: 'taches', notif: 'TACHE', notifRetour: 'TACHE', libelle: (r) => r.titre,
  },
};

const enRetard = (row) => !!row.echeance && String(row.echeance) < aujourdhui();

function assertStatut(row, allowed) {
  if (!allowed.includes(row.statut)) throw badRequest(`Opération impossible au statut « ${LIBELLES[row.statut]} ».`);
}

async function changer(req, type, row, patch, action, commentaire, destinataires, titre) {
  const c = CONFIG[type];
  const [u] = await db(c.table).where({ id: row.id }).update({ ...patch, updated_at: db.fn.now() }).returning('*');
  await addHistory(type, row.id, req.ctx.userId, { action, ancien: row.statut, nouveau: u.statut, avancement: u.avancement, commentaire });
  await audit(req, { action: 'MODIFICATION', module: c.module, entite: c.table === 'tasks' ? 'task' : 'instruction', entiteId: row.id, avant: { statut: row.statut, echeance: row.echeance }, apres: { statut: u.statut, echeance: u.echeance }, message: action });
  const to = [].concat(destinataires || []).filter((x) => x && x !== req.ctx.userId);
  if (to.length) await notify(to, { type: action === 'RAPPORT_INTERMEDIAIRE' ? c.notifRetour : c.notif, titre: `${titre} — ${row.reference}`, message: commentaire || c.libelle(row), lien: `${c.lien}${row.id}`, expediteur: req.ctx.userId });
  return u;
}

/** L’exécutant signale un blocage motivé ; l’émetteur est alerté. */
async function bloquer(req, type, row, motif) {
  const c = CONFIG[type];
  if (row[c.executant] !== req.ctx.userId) throw forbidden('Seul l’exécutant peut signaler un blocage.');
  assertStatut(row, ACTIFS);
  return changer(req, type, row, { statut: 'BLOQUEE', statut_avant_blocage: row.statut, motif_blocage: motif, bloquee_at: db.fn.now() }, 'BLOCAGE', motif, [row[c.emetteur], row.copie_user_id], 'Blocage signalé');
}

/** Levée du blocage par l’exécutant ou l’émetteur : reprise au statut précédent (ou « en retard »). */
async function debloquer(req, type, row, commentaire) {
  const c = CONFIG[type];
  if (![row[c.executant], row[c.emetteur]].includes(req.ctx.userId)) throw forbidden('Seuls l’exécutant et l’émetteur peuvent lever le blocage.');
  assertStatut(row, ['BLOQUEE']);
  let statut = row.statut_avant_blocage || 'EN_COURS';
  if (['RECUE', 'EN_COURS', 'RAPPORT_INTERMEDIAIRE', 'EN_RETARD'].includes(statut)) statut = enRetard(row) ? 'EN_RETARD' : 'EN_COURS';
  const autre = req.ctx.userId === row[c.executant] ? row[c.emetteur] : row[c.executant];
  return changer(req, type, row, { statut, statut_avant_blocage: null }, 'DEBLOCAGE', commentaire || 'Blocage levé', [autre, row.copie_user_id], 'Blocage levé');
}

/** Rapport d’étape de l’exécutant : n’achève pas le traitement. */
async function rapportIntermediaire(req, type, row, { texte, avancement }) {
  const c = CONFIG[type];
  if (row[c.executant] !== req.ctx.userId) throw forbidden('Seul l’exécutant peut transmettre un rapport intermédiaire.');
  assertStatut(row, ACTIFS);
  const patch = { statut: 'RAPPORT_INTERMEDIAIRE' };
  if (avancement !== undefined && avancement !== null) {
    if (avancement < row.avancement) throw badRequest('L’avancement ne peut pas diminuer dans un rapport intermédiaire.');
    patch.avancement = avancement;
  }
  return changer(req, type, row, patch, 'RAPPORT_INTERMEDIAIRE', texte, [row[c.emetteur], row.copie_user_id], 'Rapport intermédiaire');
}

/** Annulation motivée par l’émetteur, tant que le traitement n’est pas validé. */
async function annuler(req, type, row, motif) {
  const c = CONFIG[type];
  if (row[c.emetteur] !== req.ctx.userId) throw forbidden('Seul l’émetteur peut annuler.');
  if (TERMINES.includes(row.statut)) throw badRequest(`Opération impossible au statut « ${LIBELLES[row.statut]} ».`);
  await db('prolongations').where({ entity_type: type, entity_id: row.id, statut: 'DEMANDEE' })
    .update({ statut: 'REFUSEE', decide_par: req.ctx.userId, decide_at: db.fn.now(), commentaire: 'Traitement annulé' });
  return changer(req, type, row, { statut: 'ANNULEE', motif_annulation: motif, annulee_at: db.fn.now() }, 'ANNULATION', motif,
    row.statut === 'BROUILLON' ? [] : [row[c.executant], row.copie_user_id], 'Annulation');
}

async function prolongations(type, id) {
  return db('prolongations as p').join('users as u', 'u.id', 'p.demandeur_user_id').leftJoin('agents as a', 'a.id', 'u.agent_id')
    .leftJoin('users as ud', 'ud.id', 'p.decide_par').leftJoin('agents as ad', 'ad.id', 'ud.agent_id')
    .where({ 'p.entity_type': type, 'p.entity_id': id }).orderBy('p.created_at')
    .select('p.*', db.raw(`concat_ws(' ', a.prenom, a.nom) as demandeur_nom`), db.raw(`concat_ws(' ', ad.prenom, ad.nom) as decideur_nom`));
}

function controlerDate(row, date) {
  if (date < aujourdhui()) throw badRequest('La nouvelle échéance ne peut pas être antérieure à aujourd’hui.');
  if (row.echeance && date <= String(row.echeance)) throw badRequest('La nouvelle échéance doit être postérieure à l’échéance actuelle.');
}

/** Applique une nouvelle échéance : l’échéance initiale est conservée, le retard est levé. */
function patchEcheance(row, date) {
  const patch = { echeance: date, echeance_initiale: row.echeance_initiale || row.echeance, rappel_envoye: false };
  if (row.statut === 'EN_RETARD') patch.statut = 'EN_COURS';
  return patch;
}

/** L’exécutant demande une prolongation motivée ; une seule demande en attente à la fois. */
async function demanderProlongation(req, type, row, { echeance, motif }) {
  const c = CONFIG[type];
  if (row[c.executant] !== req.ctx.userId) throw forbidden('Seul l’exécutant peut demander une prolongation.');
  assertStatut(row, [...ACTIFS, 'BLOQUEE']);
  controlerDate(row, echeance);
  try {
    const [p] = await db('prolongations').insert({ entity_type: type, entity_id: row.id, demandeur_user_id: req.ctx.userId, echeance_actuelle: row.echeance, echeance_demandee: echeance, motif }).returning('*');
    await addHistory(type, row.id, req.ctx.userId, { action: 'DEMANDE_PROLONGATION', commentaire: `Échéance demandée : ${echeance.split('-').reverse().join('/')} — ${motif}` });
    await audit(req, { action: 'CREATION', module: c.module, entite: 'prolongation', entiteId: p.id, apres: p });
    await notify(row[c.emetteur], { type: c.notif, titre: `Demande de prolongation — ${row.reference}`, message: motif, lien: `${c.lien}${row.id}`, expediteur: req.ctx.userId });
    return p;
  } catch (e) {
    if (e.code === '23505') throw conflict('Une demande de prolongation est déjà en attente de décision.');
    throw e;
  }
}

/** L’émetteur accorde (éventuellement à une autre date) ou refuse la prolongation demandée. */
async function deciderProlongation(req, type, row, { accorder, echeance, commentaire }) {
  const c = CONFIG[type];
  if (row[c.emetteur] !== req.ctx.userId) throw forbidden('Seul l’émetteur décide de la prolongation.');
  const p = await db('prolongations').where({ entity_type: type, entity_id: row.id, statut: 'DEMANDEE' }).first();
  if (!p) throw badRequest('Aucune demande de prolongation en attente.');
  if (!accorder) {
    if (!commentaire || commentaire.trim().length < 3) throw badRequest('Motivez le refus de la prolongation.');
    await db('prolongations').where({ id: p.id }).update({ statut: 'REFUSEE', decide_par: req.ctx.userId, decide_at: db.fn.now(), commentaire });
    await addHistory(type, row.id, req.ctx.userId, { action: 'PROLONGATION_REFUSEE', commentaire });
    await audit(req, { action: 'MODIFICATION', module: c.module, entite: 'prolongation', entiteId: p.id, message: 'Prolongation refusée' });
    await notify(row[c.executant], { type: c.notif, titre: `Prolongation refusée — ${row.reference}`, message: commentaire, lien: `${c.lien}${row.id}`, expediteur: req.ctx.userId });
    return db(c.table).where({ id: row.id }).first();
  }
  const date = echeance || String(p.echeance_demandee);
  controlerDate(row, date);
  await db('prolongations').where({ id: p.id }).update({ statut: 'ACCORDEE', decide_par: req.ctx.userId, decide_at: db.fn.now(), commentaire: commentaire || null, echeance_demandee: date });
  return changer(req, type, row, patchEcheance(row, date), 'PROLONGATION_ACCORDEE', `Nouvelle échéance : ${date.split('-').reverse().join('/')}${commentaire ? ` — ${commentaire}` : ''}`, [row[c.executant], row.copie_user_id], 'Prolongation accordée');
}

/** L’émetteur prolonge directement le délai (motif obligatoire). */
async function prolonger(req, type, row, { echeance, motif }) {
  const c = CONFIG[type];
  if (row[c.emetteur] !== req.ctx.userId) throw forbidden('Seul l’émetteur peut prolonger le délai.');
  if (TERMINES.includes(row.statut) || row.statut === 'BROUILLON') throw badRequest(`Opération impossible au statut « ${LIBELLES[row.statut]} ».`);
  controlerDate(row, echeance);
  const enAttente = await db('prolongations').where({ entity_type: type, entity_id: row.id, statut: 'DEMANDEE' }).first();
  if (enAttente) throw conflict('Une demande de prolongation est en attente : accordez-la ou refusez-la.');
  await db('prolongations').insert({ entity_type: type, entity_id: row.id, demandeur_user_id: req.ctx.userId, echeance_actuelle: row.echeance, echeance_demandee: echeance, motif, statut: 'ACCORDEE', decide_par: req.ctx.userId, decide_at: db.fn.now() });
  return changer(req, type, row, patchEcheance(row, echeance), 'PROLONGATION', `Nouvelle échéance : ${echeance.split('-').reverse().join('/')} — ${motif}`, [row[c.executant], row.copie_user_id], 'Délai prolongé');
}

module.exports = {
  LIBELLES, ACTIFS, TERMINES, enRetard, assertStatut, bloquer, debloquer, rapportIntermediaire, annuler,
  prolongations, demanderProlongation, deciderProlongation, prolonger,
};

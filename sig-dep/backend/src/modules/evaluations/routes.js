'use strict';
/**
 * Évaluation annuelle des politiques sectorielles et budgétaires (cahier, §§ 34 et 51).
 * Le Bureau Suivi-Évaluation ouvre le dossier de l’exercice à réception de la convocation du
 * Ministère du Budget ; les annexes I à V sont reprises du SIG-DEP (PTBA validés, crédits,
 * effectifs), complétées et contrôlées (taux, totaux) ; le Bureau Programme complète la
 * projection sur trois ans (annexe II). Les états de la Direction des Ressources Humaines
 * (montants des primes et salaires) et la convocation sont joints comme pièces.
 */
const express = require('express');
const { z } = require('zod');
const db = require('../../db/knex');
const validate = require('../../middleware/validate');
const { requirePerm } = require('../../middleware/auth');
const { audit } = require('../../services/audit');
const { notify } = require('../../services/notifications');
const { addHistory, getHistory } = require('../../services/history');
const { nextReference } = require('../../services/sequence');
const { loadAllNodes } = require('../../services/hierarchy');
const { directeursActifs } = require('../../services/alertes');
const correspondance = require('../../services/correspondance');
const { BY_CODE } = require('../documents/types');
const evaluation = require('../../services/evaluation');
const dossierService = require('../../services/evaluationDossier');
const { badRequest, forbidden, notFound, conflict } = require('../../utils/errors');

const router = express.Router();
const idParam = z.object({ id: z.coerce.number().int().positive() });
const ligneParams = z.object({ id: z.coerce.number().int().positive(), ligneId: z.coerce.number().int().positive() });
const annexeEnum = z.enum(Object.keys(evaluation.ANNEXES));
const annee = z.coerce.number().int().min(2000).max(2100);
const iso = (d) => (d instanceof Date ? new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Kinshasa' }).format(d) : d ? String(d).slice(0, 10) : null);

const MODIFIABLE = ['PREPARATION', 'A_CORRIGER'];
const VISIBLE_SUPERVISION = ['VALIDE', 'TRANSMIS'];

function scopeEvaluations(qb, ctx) {
  if (!ctx.can('planification.consulter')) return qb.whereRaw('false');
  return ctx.perimetre === 'SUPERVISION_GLOBALE' ? qb.whereIn('statut', VISIBLE_SUPERVISION) : qb;
}

/**
 * Droits sur un dossier : préparation et soumission (Bureau Suivi-Évaluation), projection (Bureau
 * Programme), vérification (Chef de la Division Programme et Suivi), validation et signature de la
 * lettre (Directeur), transmission au Secrétaire Général (Directeur ou Secrétariat de Direction).
 */
function droits(ctx, e) {
  const modifiable = MODIFIABLE.includes(e.statut);
  const preparer = ctx.can('evaluation.preparer') && modifiable;
  const verifier = ctx.can('evaluation.verifier') && e.statut === 'SOUMIS';
  const valider = ctx.can('evaluation.valider') && e.statut === 'VERIFIE';
  return {
    modifier: preparer,
    annexes: Object.fromEntries(Object.keys(evaluation.ANNEXES).map((a) => [a, preparer || (a === 'II' && ctx.can('evaluation.contribuer') && modifiable)])),
    pieces: preparer,
    soumettre: preparer, verifier, valider, retourner: verifier || valider,
    transmettre: (ctx.can('evaluation.transmettre') || ctx.can('evaluation.valider')) && e.statut === 'VALIDE' && ctx.perimetre !== 'SUPERVISION_GLOBALE',
  };
}

async function charger(ctx, id) {
  const e = await db('evaluations').where({ id }).first();
  if (!e) throw notFound('Dossier d’évaluation introuvable.');
  if (!(await scopeEvaluations(db('evaluations').where({ id }), ctx).first('id'))) throw forbidden('Dossier non accessible.', 'HORS_PERIMETRE');
  return e;
}
const presenter = (e) => ({ ...e, convocation_date: iso(e.convocation_date), date_limite: iso(e.date_limite) });

/** Comptes d’un Bureau (titulaires et intérimaires), pour les notifications. */
async function comptesBureau(code) {
  const b = await db('bureaux').where({ code }).first('id');
  return b ? (await loadAllNodes()).filter((n) => n.node && n.bureauId === b.id).map((n) => n.userId) : [];
}

/** Comptes de la Division Programme et Suivi (Chef de Division, titulaire ou intérimaire). */
async function chefsDivisionPs() {
  const d = await db('divisions').where({ code: 'DIV-PS' }).first('id');
  return d ? (await loadAllNodes()).filter((n) => n.node && n.divisionId === d.id && !n.bureauId && n.primaryRole === 'CHEF_DIVISION').map((n) => n.userId) : [];
}
async function secretairesGeneraux() {
  return db('users as u').join('user_roles as ur', 'ur.user_id', 'u.id').join('roles as r', 'r.id', 'ur.role_id')
    .where({ 'r.code': 'SECRETAIRE_GENERAL', 'u.statut': 'ACTIF' }).pluck('u.id');
}

/** CDS-MT : projections reportées depuis les dossiers transmis (déclarée avant « /:id »). */
router.get('/cdsmt', requirePerm('planification.consulter'), async (req, res) => {
  res.json(await dossierService.cdsmt());
});

router.get('/', requirePerm('planification.consulter'), async (req, res) => {
  const rows = await scopeEvaluations(db('evaluations as e'), req.ctx).orderBy('annee', 'desc')
    .select('e.*', db.raw('(SELECT count(*)::int FROM evaluation_lignes l WHERE l.evaluation_id = e.id AND NOT l.exclue) as lignes'));
  res.json({ data: rows.map(presenter), droits: { ouvrir: req.ctx.can('evaluation.preparer') } });
});

const enteteSchema = z.object({
  convocation_reference: z.string().trim().min(3).max(200), convocation_date: z.string().date(), date_limite: z.string().date().optional().nullable(),
  annee_projection: annee.optional(), observations: z.string().trim().max(5000).optional().nullable(),
});

router.post('/', requirePerm('planification.consulter'), validate({ body: enteteSchema.extend({ annee }) }), async (req, res) => {
  if (!req.ctx.can('evaluation.preparer')) throw forbidden('Le dossier d’évaluation est ouvert par le Bureau Suivi-Évaluation.');
  const b = req.valid.body;
  const projection = b.annee_projection ?? b.annee + 1;
  if (projection < b.annee || projection > b.annee + 3) throw badRequest('La projection commence entre l’exercice évalué et les trois exercices suivants.');
  if (b.date_limite && b.date_limite < b.convocation_date) throw badRequest('L’échéance précède la date de la convocation.');
  if (await db('evaluations').where({ annee: b.annee }).first('id')) throw conflict(`Un dossier d’évaluation de l’exercice ${b.annee} existe déjà.`);
  const { e, bilans } = await db.transaction(async (trx) => {
    const [x] = await trx('evaluations').insert({
      reference: await nextReference('EVAL', 'DEP/EVAL', trx), annee: b.annee, annee_projection: projection,
      convocation_reference: b.convocation_reference, convocation_date: b.convocation_date, date_limite: b.date_limite || null,
      observations: b.observations || null, prepare_par: req.ctx.userId,
    }).returning('*');
    const out = {};
    for (const a of Object.keys(evaluation.ANNEXES)) out[a] = await evaluation.actualiser(x, a, req.ctx.userId, trx);
    await addHistory('EVALUATION', x.id, req.ctx.userId, { action: 'CREATION', nouveau: 'PREPARATION', commentaire: `Convocation ${b.convocation_reference}`, details: out }, trx);
    return { e: x, bilans: out };
  });
  await audit(req, { action: 'CREATION', module: 'planification', entite: 'evaluation', entiteId: e.id, apres: { annee: e.annee, reference: e.reference } });
  const prg = await comptesBureau('BUR-PRG');
  if (prg.length) await notify(prg, { type: 'EVALUATION', titre: `Évaluation ${e.annee} : projection sur trois ans à compléter`, message: `${e.reference} — annexe II (${projection}-${projection + 2})${e.date_limite ? `, échéance ${iso(e.date_limite)}` : ''}`, lien: `/evaluations/${e.id}?onglet=II`, expediteur: req.ctx.userId });
  res.status(201).json({ ...presenter(e), bilans });
});

router.get('/:id', requirePerm('planification.consulter'), validate({ params: idParam }), async (req, res) => {
  const e = await charger(req.ctx, req.valid.params.id);
  const d = await evaluation.dossier(e);
  res.json({
    ...presenter(e), ...d, historique: await getHistory('EVALUATION', e.id),
    droits: droits(req.ctx, e), niveaux: evaluation.NIVEAUX,
    lettre: dossierService.lettre(e), rubriques: dossierService.NOTE, resume_propose: dossierService.resumePropose(e, d),
    bloquants: dossierService.bloquants(e, d),
  });
});

router.put('/:id', requirePerm('planification.consulter'), validate({ params: idParam, body: enteteSchema }), async (req, res) => {
  const e = await charger(req.ctx, req.valid.params.id);
  if (!droits(req.ctx, e).modifier) throw forbidden('Seul le Bureau Suivi-Évaluation modifie un dossier en préparation.');
  const b = req.valid.body;
  const projection = b.annee_projection ?? e.annee_projection;
  if (projection < e.annee || projection > e.annee + 3) throw badRequest('La projection commence entre l’exercice évalué et les trois exercices suivants.');
  if (b.date_limite && b.date_limite < b.convocation_date) throw badRequest('L’échéance précède la date de la convocation.');
  const [u] = await db('evaluations').where({ id: e.id }).update({
    convocation_reference: b.convocation_reference, convocation_date: b.convocation_date, date_limite: b.date_limite || null,
    annee_projection: projection, observations: b.observations ?? e.observations, updated_at: db.fn.now(),
  }).returning('*');
  // Nouvelle période de projection : l’annexe II suit
  if (projection !== e.annee_projection) await db.transaction((trx) => evaluation.actualiser(u, 'II', req.ctx.userId, trx));
  await addHistory('EVALUATION', e.id, req.ctx.userId, { action: 'MODIFICATION', commentaire: 'Convocation et période de projection' });
  await audit(req, { action: 'MODIFICATION', module: 'planification', entite: 'evaluation', entiteId: e.id });
  res.json(presenter(u));
});

/** Reprend les données du SIG-DEP dans une annexe (les valeurs modifiées sont conservées). */
router.post('/:id/annexes/:annexe/actualiser', requirePerm('planification.consulter'), validate({ params: idParam.extend({ annexe: annexeEnum }) }), async (req, res) => {
  const e = await charger(req.ctx, req.valid.params.id);
  const { annexe } = req.valid.params;
  if (!droits(req.ctx, e).annexes[annexe]) throw forbidden('Annexe non modifiable par vous à cette étape.');
  const bilan = await db.transaction((trx) => evaluation.actualiser(e, annexe, req.ctx.userId, trx));
  await addHistory('EVALUATION', e.id, req.ctx.userId, { action: 'ACTUALISATION', commentaire: `${evaluation.ANNEXES[annexe]} : ${bilan.ajoutees} ajoutée(s), ${bilan.actualisees} actualisée(s), ${bilan.absentes} sans source`, details: bilan });
  await audit(req, { action: 'MODIFICATION', module: 'planification', entite: 'evaluation', entiteId: e.id, message: `Actualisation de l’annexe ${annexe}` });
  res.json(bilan);
});

const valeursSchema = z.record(z.string(), z.union([z.string().max(2000), z.number().finite(), z.boolean(), z.null()]));

router.post('/:id/lignes', requirePerm('planification.consulter'), validate({ params: idParam, body: z.object({ annexe: annexeEnum, valeurs: valeursSchema }) }), async (req, res) => {
  const e = await charger(req.ctx, req.valid.params.id);
  const { annexe } = req.valid.body;
  if (!droits(req.ctx, e).annexes[annexe]) throw forbidden('Annexe non modifiable par vous à cette étape.');
  const valeurs = evaluation.normaliser(annexe, req.valid.body.valeurs);
  if (!valeurs[evaluation.LIBELLE[annexe]]) throw badRequest('Libellé de la ligne obligatoire.');
  const ordre = (await db('evaluation_lignes').where({ evaluation_id: e.id, annexe }).max('ordre as m').first()).m || 0;
  const [l] = await db('evaluation_lignes').insert({ evaluation_id: e.id, annexe, ordre: ordre + 1, valeurs: JSON.stringify(valeurs), modifie_par: req.ctx.userId }).returning('*');
  await addHistory('EVALUATION', e.id, req.ctx.userId, { action: 'LIGNE_AJOUTEE', commentaire: `Annexe ${annexe} : ${valeurs[evaluation.LIBELLE[annexe]]}` });
  await audit(req, { action: 'CREATION', module: 'planification', entite: 'evaluation_ligne', entiteId: l.id, apres: { annexe, valeurs } });
  res.status(201).json(l);
});

async function ligneDe(req) {
  const e = await charger(req.ctx, req.valid.params.id);
  const l = await db('evaluation_lignes').where({ id: req.valid.params.ligneId, evaluation_id: e.id }).first();
  if (!l) throw notFound('Ligne introuvable.');
  if (!droits(req.ctx, e).annexes[l.annexe]) throw forbidden('Annexe non modifiable par vous à cette étape.');
  return { e, l };
}

router.put('/:id/lignes/:ligneId', requirePerm('planification.consulter'), validate({ params: ligneParams, body: z.object({ valeurs: valeursSchema }) }), async (req, res) => {
  const { e, l } = await ligneDe(req);
  const valeurs = { ...l.valeurs, ...evaluation.normaliser(l.annexe, req.valid.body.valeurs) };
  if (!valeurs[evaluation.LIBELLE[l.annexe]]) throw badRequest('Libellé de la ligne obligatoire.');
  const [u] = await db('evaluation_lignes').where({ id: l.id }).update({ valeurs: JSON.stringify(valeurs), modifie_par: req.ctx.userId, updated_at: db.fn.now() }).returning('*');
  await audit(req, { action: 'MODIFICATION', module: 'planification', entite: 'evaluation_ligne', entiteId: l.id, avant: l.valeurs, apres: valeurs, message: `Évaluation ${e.annee}, annexe ${l.annexe}` });
  res.json({ ...u, calculs: evaluation.calculs(l.annexe, valeurs), anomalies: evaluation.controlerLigne(l.annexe, valeurs) });
});

/** Ligne reprise : écartée ou rétablie ; ligne ajoutée : supprimée. */
router.post('/:id/lignes/:ligneId/ecarter', requirePerm('planification.consulter'), validate({ params: ligneParams, body: z.object({ exclue: z.boolean() }) }), async (req, res) => {
  const { e, l } = await ligneDe(req);
  if (!l.cle) throw badRequest('Une ligne ajoutée se supprime.');
  await db('evaluation_lignes').where({ id: l.id }).update({ exclue: req.valid.body.exclue, modifie_par: req.ctx.userId, updated_at: db.fn.now() });
  await addHistory('EVALUATION', e.id, req.ctx.userId, { action: req.valid.body.exclue ? 'LIGNE_ECARTEE' : 'LIGNE_RETABLIE', commentaire: `Annexe ${l.annexe} : ${l.valeurs[evaluation.LIBELLE[l.annexe]]}` });
  await audit(req, { action: 'MODIFICATION', module: 'planification', entite: 'evaluation_ligne', entiteId: l.id, message: req.valid.body.exclue ? 'Ligne écartée' : 'Ligne rétablie' });
  res.json({ ok: true });
});
router.delete('/:id/lignes/:ligneId', requirePerm('planification.consulter'), validate({ params: ligneParams }), async (req, res) => {
  const { e, l } = await ligneDe(req);
  if (l.cle) throw badRequest('Une ligne reprise du SIG-DEP s’écarte ; elle ne se supprime pas.');
  await db('evaluation_lignes').where({ id: l.id }).del();
  await addHistory('EVALUATION', e.id, req.ctx.userId, { action: 'LIGNE_SUPPRIMEE', commentaire: `Annexe ${l.annexe} : ${l.valeurs[evaluation.LIBELLE[l.annexe]]}` });
  await audit(req, { action: 'SUPPRESSION', module: 'planification', entite: 'evaluation_ligne', entiteId: l.id, avant: l.valeurs });
  res.json({ ok: true });
});

// ─── Note de présentation et lettre de transmission ─────────────────────────
const texte = z.string().trim().max(20000).optional().nullable();
router.put('/:id/note', requirePerm('planification.consulter'), validate({ params: idParam, body: z.object(Object.fromEntries(dossierService.NOTE.map(([k]) => [k, texte]))) }), async (req, res) => {
  const e = await charger(req.ctx, req.valid.params.id);
  if (!droits(req.ctx, e).modifier) throw forbidden('La note de présentation est rédigée par le Bureau Suivi-Évaluation pendant la préparation.');
  const note = Object.fromEntries(dossierService.NOTE.map(([k]) => [k, req.valid.body[k] || null]));
  await db('evaluations').where({ id: e.id }).update({ note: JSON.stringify(note), updated_at: db.fn.now() });
  await addHistory('EVALUATION', e.id, req.ctx.userId, { action: 'MODIFICATION', commentaire: 'Note de présentation' });
  await audit(req, { action: 'MODIFICATION', module: 'planification', entite: 'evaluation', entiteId: e.id, message: 'Note de présentation' });
  res.json({ note });
});

router.put('/:id/lettre', requirePerm('planification.consulter'), validate({ params: idParam, body: z.object({
  destinataire: z.string().trim().min(3).max(300), adresse: z.string().trim().max(300).optional().nullable(), objet: z.string().trim().min(3).max(500),
  references: z.string().trim().max(500).optional().nullable(), formule_appel: z.string().trim().max(300).optional().nullable(), corps: z.string().trim().min(10).max(20000),
  formule_finale: z.string().trim().max(500).optional().nullable(), signataire_nom: z.string().trim().max(200).optional().nullable(),
  pieces: z.array(z.string().trim().min(1).max(300)).max(30).optional(), copies: z.array(z.string().trim().min(1).max(300)).max(30).optional(),
}) }), async (req, res) => {
  const e = await charger(req.ctx, req.valid.params.id);
  if (!droits(req.ctx, e).modifier) throw forbidden('La lettre de transmission est préparée par le Bureau Suivi-Évaluation pendant la préparation.');
  await db('evaluations').where({ id: e.id }).update({ lettre: JSON.stringify(req.valid.body), updated_at: db.fn.now() });
  await addHistory('EVALUATION', e.id, req.ctx.userId, { action: 'MODIFICATION', commentaire: 'Lettre de transmission' });
  await audit(req, { action: 'MODIFICATION', module: 'planification', entite: 'evaluation', entiteId: e.id, message: 'Lettre de transmission' });
  res.json({ lettre: dossierService.lettre({ ...e, lettre: req.valid.body }) });
});

// ─── Circuit ────────────────────────────────────────────────────────────────
const lien = (e, onglet) => `/evaluations/${e.id}${onglet ? `?onglet=${onglet}` : ''}`;
async function changer(req, e, patch, action, { commentaire = null, details = null } = {}, trx = db) {
  const [u] = await trx('evaluations').where({ id: e.id }).update({ ...patch, updated_at: trx.fn.now() }).returning('*');
  await addHistory('EVALUATION', e.id, req.ctx.userId, { action, ancien: e.statut, nouveau: u.statut, commentaire, details }, trx);
  return u;
}

router.post('/:id/soumettre', requirePerm('planification.consulter'), validate({ params: idParam }), async (req, res) => {
  const e = await charger(req.ctx, req.valid.params.id);
  if (!droits(req.ctx, e).soumettre) throw forbidden('Le dossier est soumis par le Bureau Suivi-Évaluation pendant la préparation.');
  const bloquants = dossierService.bloquants(e, await evaluation.dossier(e));
  if (bloquants.length) throw badRequest(`Dossier incomplet : ${bloquants.join(' ')}`);
  const u = await changer(req, e, { statut: 'SOUMIS', soumis_par: req.ctx.userId, soumis_at: db.fn.now() }, 'SOUMISSION');
  await audit(req, { action: 'MODIFICATION', module: 'planification', entite: 'evaluation', entiteId: e.id, message: `Évaluation ${e.annee} soumise` });
  await notify(await chefsDivisionPs(), { type: 'EVALUATION', titre: `Évaluation des politiques ${e.annee} à vérifier`, message: e.reference, lien: lien(e), expediteur: req.ctx.userId });
  res.json(presenter(u));
});

router.post('/:id/verifier', requirePerm('planification.consulter'), validate({ params: idParam }), async (req, res) => {
  const e = await charger(req.ctx, req.valid.params.id);
  if (!droits(req.ctx, e).verifier) throw forbidden('Le dossier soumis est vérifié par le Chef de la Division Programme et Suivi.');
  const u = await changer(req, e, { statut: 'VERIFIE', verifie_par: req.ctx.userId, verifie_at: db.fn.now() }, 'VERIFICATION');
  await audit(req, { action: 'MODIFICATION', module: 'planification', entite: 'evaluation', entiteId: e.id, message: `Évaluation ${e.annee} vérifiée` });
  await notify(await directeursActifs(), { type: 'EVALUATION', titre: `Évaluation des politiques ${e.annee} à valider`, message: `${e.reference} — lettre de transmission à signer`, lien: lien(e), expediteur: req.ctx.userId });
  res.json(presenter(u));
});

/** Validation du Directeur : signature de la lettre de transmission, qui reçoit son numéro officiel. */
router.post('/:id/valider', requirePerm('evaluation.valider'), validate({ params: idParam }), async (req, res) => {
  const e = await charger(req.ctx, req.valid.params.id);
  if (!droits(req.ctx, e).valider) throw forbidden('Le dossier vérifié est validé par le Directeur.');
  const u = await db.transaction(async (trx) => {
    const n = await correspondance.numeroter(trx, dossierService.documentLettre(e), BY_CODE.LETTRE_TRANSMISSION, req.ctx.userId);
    return changer(req, e, {
      statut: 'VALIDE', valide_par: req.ctx.userId, valide_at: trx.fn.now(),
      numero_lettre: n.numero_officiel, numerote_at: n.numerote_at, identite_version_id: n.identite_version_id,
    }, 'VALIDATION', { commentaire: `Lettre de transmission signée : ${n.numero_officiel}` }, trx);
  });
  await audit(req, { action: 'VALIDATION', module: 'planification', entite: 'evaluation', entiteId: e.id, message: `Évaluation ${e.annee} validée, lettre ${u.numero_lettre}` });
  const bsd = await comptesBureau('BSD');
  await notify([e.prepare_par, e.verifie_par, ...bsd], { type: 'EVALUATION', titre: `Évaluation des politiques ${e.annee} validée`, message: `Lettre ${u.numero_lettre} : dossier à transmettre au Secrétaire Général`, lien: lien(e), expediteur: req.ctx.userId });
  res.json(presenter(u));
});

router.post('/:id/retourner', requirePerm('planification.consulter'), validate({ params: idParam, body: z.object({ motif: z.string().trim().min(5).max(5000) }) }), async (req, res) => {
  const e = await charger(req.ctx, req.valid.params.id);
  if (!droits(req.ctx, e).retourner) throw forbidden('Vous ne pouvez pas retourner ce dossier à cette étape.');
  const u = await changer(req, e, { statut: 'A_CORRIGER', observations: req.valid.body.motif }, 'RETOUR_CORRECTION', { commentaire: req.valid.body.motif });
  await audit(req, { action: 'MODIFICATION', module: 'planification', entite: 'evaluation', entiteId: e.id, message: 'Retour pour correction' });
  await notify([e.prepare_par, e.soumis_par], { type: 'EVALUATION', titre: `Évaluation des politiques ${e.annee} à corriger`, message: req.valid.body.motif, lien: lien(e), expediteur: req.ctx.userId });
  res.json(presenter(u));
});

/** Transmission au Secrétaire Général : archivage du dossier et report des projections dans le CDS-MT. */
router.post('/:id/transmettre', requirePerm('planification.consulter'), validate({ params: idParam }), async (req, res) => {
  const e = await charger(req.ctx, req.valid.params.id);
  if (!droits(req.ctx, e).transmettre) throw forbidden('Le dossier validé est transmis par le Directeur ou le Secrétariat de Direction.');
  const d = await evaluation.dossier(e);
  const { u, reportees } = await db.transaction(async (trx) => {
    const n = await dossierService.reporterCdsmt(trx, e, d, req.ctx.userId);
    const x = await changer(req, e, { statut: 'TRANSMIS', transmis_par: req.ctx.userId, transmis_at: trx.fn.now() }, 'TRANSMISSION',
      { commentaire: `Transmis au Secrétaire Général (lettre ${e.numero_lettre}) ; ${n} projection(s) reportée(s) dans le CDS-MT`, details: { cdsmt: n } }, trx);
    return { u: x, reportees: n };
  });
  await audit(req, { action: 'MODIFICATION', module: 'planification', entite: 'evaluation', entiteId: e.id, message: `Évaluation ${e.annee} transmise au Secrétaire Général` });
  await notify(await secretairesGeneraux(), { type: 'EVALUATION', titre: `Dossier d’évaluation des politiques ${e.annee}`, message: `Lettre ${e.numero_lettre} de la Direction d’Études et Planification`, lien: lien(e), expediteur: req.ctx.userId });
  await notify([e.prepare_par], { type: 'EVALUATION', titre: `Évaluation des politiques ${e.annee} transmise`, message: `${reportees} projection(s) reportée(s) dans le CDS-MT`, lien: lien(e), expediteur: req.ctx.userId });
  res.json({ ...presenter(u), cdsmt: reportees });
});

// ─── Exports ────────────────────────────────────────────────────────────────
router.get('/:id/export/:format', requirePerm('exports.generer'), validate({ params: idParam.extend({ format: z.enum(['pdf', 'xlsx']) }) }), async (req, res) => {
  const e = await charger(req.ctx, req.valid.params.id);
  const d = await evaluation.dossier(e);
  await audit(req, { action: 'EXPORT', module: 'planification', entite: 'evaluation', entiteId: e.id, message: `Dossier ${e.annee} (${req.valid.params.format})` });
  if (req.valid.params.format === 'pdf') return dossierService.pdf(res, e, d);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="evaluation-politiques-${e.annee}-annexes.xlsx"`);
  return res.send(await dossierService.excel(e, d));
});

router.get('/:id/lettre/pdf', requirePerm('exports.generer'), validate({ params: idParam }), async (req, res) => {
  const e = await charger(req.ctx, req.valid.params.id);
  await audit(req, { action: 'EXPORT', module: 'planification', entite: 'evaluation', entiteId: e.id, message: `Lettre de transmission ${e.numero_lettre || '(projet)'}` });
  return correspondance.pdfLettre(res, dossierService.documentLettre(e), BY_CODE.LETTRE_TRANSMISSION, `lettre-transmission-evaluation-${e.annee}.pdf`);
});

module.exports = router;
module.exports.scopeEvaluations = scopeEvaluations;
module.exports.droits = droits;

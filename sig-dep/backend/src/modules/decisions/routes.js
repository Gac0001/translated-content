'use strict';
/**
 * Registre des décisions : décisions issues des comptes rendus de réunion validés et décisions
 * prises directement par le Directeur, avec responsable, échéance et résultat.
 * Une décision se met en œuvre par une instruction (chaîne hiérarchique, ou instruction
 * exceptionnelle du Directeur) ou par une tâche (Chef de Bureau → Agent de son Bureau).
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
const { ctxNode, relation, loadAllNodes } = require('../../services/hierarchy');
const { STATUTS, OUVERTES, scopeDecisions } = require('../../services/decisions');
const { aujourdhui } = require('../../services/interims');
const pdf = require('../../services/pdf');
const { sendWorkbook } = require('../../services/excel');
const { badRequest, forbidden, notFound } = require('../../utils/errors');

const router = express.Router();
const idParam = z.object({ id: z.coerce.number().int().positive() });
const nom = (p) => `nullif(concat_ws(' ', ${p}.prenom, ${p}.nom), '')`;

function baseQuery() {
  return db('decisions as d')
    .join('users as ur', 'ur.id', 'd.responsable_user_id').leftJoin('agents as ar', 'ar.id', 'ur.agent_id')
    .join('users as ud', 'ud.id', 'd.decideur_user_id').leftJoin('agents as ad', 'ad.id', 'ud.agent_id')
    .leftJoin('reunions as r', 'r.id', 'd.reunion_id')
    .leftJoin('instructions as i', 'i.id', 'd.instruction_id').leftJoin('tasks as t', 't.id', 'd.task_id')
    .select('d.*', db.raw(`coalesce(${nom('ar')}, ur.username) as responsable_nom`), db.raw(`coalesce(${nom('ad')}, ud.username) as decideur_nom`),
      'r.reference as reunion_reference', 'r.objet as reunion_objet',
      'i.reference as instruction_reference', 'i.statut as instruction_statut', 't.reference as task_reference', 't.statut as task_statut',
      db.raw(`(d.statut IN ('A_EXECUTER','EN_COURS') AND d.echeance IS NOT NULL AND d.echeance < CURRENT_DATE) as en_retard`));
}

const listQuery = z.object({
  statut: z.enum(Object.keys(STATUTS)).optional(), origine: z.enum(['REUNION', 'DIRECTEUR']).optional(),
  retard: z.enum(['1']).optional(), mes: z.enum(['1']).optional(), q: z.string().trim().max(100).optional(),
});

function listed(req) {
  const { statut, origine, retard, mes, q } = req.valid.query;
  const query = scopeDecisions(baseQuery(), req.ctx).whereNot('d.statut', 'PROJET');
  if (statut) query.where('d.statut', statut);
  if (origine) query.where('d.origine', origine);
  if (retard) query.whereIn('d.statut', OUVERTES).whereNotNull('d.echeance').where('d.echeance', '<', db.raw('CURRENT_DATE'));
  if (mes) query.where('d.responsable_user_id', req.ctx.userId);
  if (q) query.where((w) => w.whereILike('d.libelle', `%${q}%`).orWhereILike('d.reference', `%${q}%`));
  return query.orderByRaw(`CASE WHEN d.statut IN ('A_EXECUTER','EN_COURS') THEN 0 ELSE 1 END`).orderBy('d.echeance', 'asc').orderBy('d.id', 'desc');
}

router.get('/', validate({ query: listQuery }), async (req, res) => {
  const rows = await listed(req).limit(500);
  const stats = await scopeDecisions(db('decisions as d'), req.ctx).whereNot('d.statut', 'PROJET')
    .select(db.raw(`count(*) FILTER (WHERE d.statut IN ('A_EXECUTER','EN_COURS')) as ouvertes`),
      db.raw(`count(*) FILTER (WHERE d.statut IN ('A_EXECUTER','EN_COURS') AND d.echeance < CURRENT_DATE) as en_retard`),
      db.raw(`count(*) FILTER (WHERE d.statut = 'EXECUTEE') as executees`)).first();
  res.json({ data: rows, stats: { ouvertes: Number(stats.ouvertes), enRetard: Number(stats.en_retard), executees: Number(stats.executees) }, droits: { prendre: req.ctx.can('decisions.prendre') } });
});

router.get('/export/:format', requirePerm('exports.generer'), validate({ params: z.object({ format: z.enum(['pdf', 'xlsx']) }), query: listQuery }), async (req, res) => {
  const rows = await listed(req);
  const columns = [
    { header: 'Référence', key: 'reference', width: 16 }, { header: 'Décision', key: 'libelle', width: 40 },
    { header: 'Origine', value: (d) => (d.origine === 'REUNION' ? `Réunion ${d.reunion_reference}` : 'Directeur'), width: 20 },
    { header: 'Responsable', key: 'responsable_nom', width: 22 }, { header: 'Échéance', value: (d) => pdf.fmtDate(d.echeance), width: 11 },
    { header: 'Statut', value: (d) => `${STATUTS[d.statut]}${d.en_retard ? ' (en retard)' : ''}`, width: 14 }, { header: 'Résultat', value: (d) => d.resultat || '', width: 30 },
  ];
  await audit(req, { action: 'EXPORT', module: 'decisions', message: `Registre des décisions (${req.valid.params.format})` });
  if (req.valid.params.format === 'xlsx') return sendWorkbook(res, 'decisions-DEP.xlsx', [{ name: 'Décisions', titre: 'Registre des décisions', columns, rows }]);
  const { doc, finish } = pdf.createPdf(res, { filename: 'decisions-DEP.pdf', titre: 'Registre des décisions', landscape: true });
  pdf.table(doc, columns, rows);
  return finish();
});

async function charger(ctx, id) {
  if (!(await db('decisions').where({ id }).first())) throw notFound('Décision introuvable.');
  const d = await scopeDecisions(baseQuery().where('d.id', id), ctx).first();
  if (!d) throw forbidden('Cette décision est hors de votre périmètre.', 'HORS_PERIMETRE');
  return d;
}

/** Mode de mise en œuvre possible pour l’utilisateur : tâche, instruction ou instruction exceptionnelle. */
async function miseEnOeuvre(ctx, d) {
  if (!OUVERTES.includes(d.statut) || d.instruction_id || d.task_id) return null;
  if (d.decideur_user_id !== ctx.userId && !ctx.can('decisions.prendre')) return null;
  const all = await loadAllNodes();
  const me = ctxNode(ctx);
  const resp = all.find((n) => n.userId === d.responsable_user_id);
  if (!me || !resp || !resp.node) return null;
  if (resp.userId === ctx.userId) return null;
  const direct = relation(me, resp.node) === 'DESCENDANT';
  if (direct && resp.primaryRole === 'AGENT' && ctx.can('taches.attribuer')) return 'TACHE';
  if (direct && ctx.can('instructions.emettre')) return 'INSTRUCTION';
  if (ctx.primaryRole === 'DIRECTEUR' && ctx.can('instructions.exceptionnelle') && resp.primaryRole !== 'SECRETAIRE_GENERAL') return 'INSTRUCTION_EXCEPTIONNELLE';
  return null;
}

router.get('/:id', validate({ params: idParam }), async (req, res) => {
  const d = await charger(req.ctx, req.valid.params.id);
  const mode = await miseEnOeuvre(req.ctx, d);
  const estResponsable = d.responsable_user_id === req.ctx.userId;
  const estDecideur = d.decideur_user_id === req.ctx.userId || req.ctx.can('decisions.prendre');
  res.json({
    ...d, historique: await getHistory('DECISION', d.id),
    actions: {
      transformer: mode,
      rendreCompte: (estResponsable || estDecideur) && OUVERTES.includes(d.statut) && !d.instruction_id && !d.task_id,
      abandonner: estDecideur && OUVERTES.includes(d.statut),
    },
  });
});

const decisionSchema = z.object({
  libelle: z.string().trim().min(3).max(500),
  description: z.string().trim().max(5000).optional().nullable(),
  resultat_attendu: z.string().trim().max(2000).optional().nullable(),
  responsable_user_id: z.coerce.number().int().positive(),
  echeance: z.string().date().optional().nullable(),
});

/** Décision prise directement par le Directeur (hors réunion). */
router.post('/', requirePerm('decisions.prendre'), validate({ body: decisionSchema }), async (req, res) => {
  const b = req.valid.body;
  if (b.echeance && b.echeance < aujourdhui()) throw badRequest('L’échéance ne peut pas être antérieure à aujourd’hui.');
  const resp = (await loadAllNodes()).find((n) => n.userId === b.responsable_user_id && n.node);
  if (!resp || resp.primaryRole === 'SECRETAIRE_GENERAL') throw badRequest('Responsable inconnu ou hors de la Direction.');
  const dep = await db('directions').where({ code: 'DEP' }).first();
  const row = await db.transaction(async (trx) => {
    const [d] = await trx('decisions').insert({
      ...b, echeance: b.echeance || null, reference: await nextReference('DEC', 'DEP/DEC', trx), origine: 'DIRECTEUR', statut: 'A_EXECUTER',
      decideur_user_id: req.ctx.userId, created_by: req.ctx.userId, decidee_at: trx.fn.now(),
      direction_id: dep.id, division_id: resp.divisionId || null, bureau_id: resp.bureauId || null,
    }).returning('*');
    await addHistory('DECISION', d.id, req.ctx.userId, { action: 'DECISION', nouveau: 'A_EXECUTER', commentaire: `Décision du Directeur ; responsable : ${resp.nomComplet}` }, trx);
    return d;
  });
  await audit(req, { action: 'CREATION', module: 'decisions', entite: 'decision', entiteId: row.id, apres: { reference: row.reference, libelle: row.libelle } });
  if (resp.userId !== req.ctx.userId) await notify(resp.userId, { type: 'DECISION', titre: `Décision à exécuter : ${row.libelle}`, message: row.reference, lien: `/decisions/${row.id}`, expediteur: req.ctx.userId });
  res.status(201).json(row);
});

/** Met en œuvre la décision : instruction (ou instruction exceptionnelle du Directeur) ou tâche. */
router.post('/:id/transformer', validate({ params: idParam, body: z.object({
  contenu: z.string().trim().max(20000).optional(), echeance: z.string().date().optional().nullable(), priorite: z.enum(['BASSE', 'NORMALE', 'HAUTE', 'URGENTE']).default('NORMALE'),
}) }), async (req, res) => {
  const d = await charger(req.ctx, req.valid.params.id);
  const mode = await miseEnOeuvre(req.ctx, d);
  if (!mode) throw forbidden('Vous ne pouvez pas mettre en œuvre cette décision : elle doit être ouverte, et son responsable relever de vous.', 'CHAINE_HIERARCHIQUE');
  const b = req.valid.body;
  const echeance = b.echeance || (d.echeance && String(d.echeance) >= aujourdhui() ? String(d.echeance) : null);
  const contenu = b.contenu || [d.description, d.resultat_attendu ? `Résultat attendu : ${d.resultat_attendu}` : null, d.reunion_reference ? `Décision ${d.reference} de la réunion ${d.reunion_reference} (${d.reunion_objet}).` : `Décision ${d.reference} du Directeur.`].filter(Boolean).join('\n\n');
  let lien;
  if (mode === 'TACHE') {
    const t = await require('../tasks/routes').creerTache(req, { agent_user_id: d.responsable_user_id, titre: d.libelle.slice(0, 300), description: contenu, priorite: b.priorite, echeance });
    await db('decisions').where({ id: d.id }).update({ task_id: t.id, statut: 'EN_COURS', updated_at: db.fn.now() });
    lien = { type: 'TACHE', id: t.id, reference: t.reference };
  } else {
    const i = await require('../instructions/routes').creerInstruction(req, {
      destinataire_user_id: d.responsable_user_id, objet: d.libelle, contenu, priorite: b.priorite, echeance, brouillon: false,
      exceptionnelle: mode === 'INSTRUCTION_EXCEPTIONNELLE', justification_exception: mode === 'INSTRUCTION_EXCEPTIONNELLE' ? `Mise en œuvre de la décision ${d.reference}${d.reunion_reference ? ` (réunion ${d.reunion_reference})` : ''}` : null,
    });
    await db('decisions').where({ id: d.id }).update({ instruction_id: i.id, statut: 'EN_COURS', updated_at: db.fn.now() });
    lien = { type: 'INSTRUCTION', id: i.id, reference: i.reference };
  }
  await addHistory('DECISION', d.id, req.ctx.userId, { action: 'MISE_EN_OEUVRE', ancien: d.statut, nouveau: 'EN_COURS', commentaire: `${lien.type === 'TACHE' ? 'Tâche' : 'Instruction'} ${lien.reference}` });
  await audit(req, { action: 'MODIFICATION', module: 'decisions', entite: 'decision', entiteId: d.id, message: `Mise en œuvre : ${lien.reference}` });
  res.status(201).json(lien);
});

router.post('/:id/rendre-compte', validate({ params: idParam, body: z.object({ resultat: z.string().trim().min(3).max(10000) }) }), async (req, res) => {
  const d = await charger(req.ctx, req.valid.params.id);
  const autorise = d.responsable_user_id === req.ctx.userId || d.decideur_user_id === req.ctx.userId || req.ctx.can('decisions.prendre');
  if (!autorise || !OUVERTES.includes(d.statut) || d.instruction_id || d.task_id) throw badRequest('Compte rendu impossible : la décision est close ou suivie par une instruction ou une tâche.');
  const [u] = await db('decisions').where({ id: d.id }).update({ statut: 'EXECUTEE', resultat: req.valid.body.resultat, executee_at: db.fn.now(), updated_at: db.fn.now() }).returning('*');
  await addHistory('DECISION', d.id, req.ctx.userId, { action: 'EXECUTION', ancien: d.statut, nouveau: 'EXECUTEE', commentaire: req.valid.body.resultat.slice(0, 300) });
  await audit(req, { action: 'MODIFICATION', module: 'decisions', entite: 'decision', entiteId: d.id, message: 'Décision exécutée' });
  if (d.decideur_user_id !== req.ctx.userId) await notify(d.decideur_user_id, { type: 'DECISION', titre: `Décision exécutée : ${d.libelle}`, message: req.valid.body.resultat.slice(0, 200), lien: `/decisions/${d.id}`, expediteur: req.ctx.userId });
  res.json(u);
});

router.post('/:id/abandonner', validate({ params: idParam, body: z.object({ motif: z.string().trim().min(3).max(5000) }) }), async (req, res) => {
  const d = await charger(req.ctx, req.valid.params.id);
  if ((d.decideur_user_id !== req.ctx.userId && !req.ctx.can('decisions.prendre')) || !OUVERTES.includes(d.statut)) throw forbidden('Seul le décideur peut abandonner une décision ouverte.');
  const [u] = await db('decisions').where({ id: d.id }).update({ statut: 'ABANDONNEE', motif_abandon: req.valid.body.motif, updated_at: db.fn.now() }).returning('*');
  await addHistory('DECISION', d.id, req.ctx.userId, { action: 'ABANDON', ancien: d.statut, nouveau: 'ABANDONNEE', commentaire: req.valid.body.motif });
  await audit(req, { action: 'MODIFICATION', module: 'decisions', entite: 'decision', entiteId: d.id, message: `Décision abandonnée : ${req.valid.body.motif}` });
  if (d.responsable_user_id !== req.ctx.userId) await notify(d.responsable_user_id, { type: 'DECISION', titre: `Décision abandonnée : ${d.libelle}`, message: req.valid.body.motif, lien: `/decisions/${d.id}`, expediteur: req.ctx.userId });
  res.json(u);
});

module.exports = router;

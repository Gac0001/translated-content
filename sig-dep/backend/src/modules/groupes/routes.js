'use strict';
/**
 * Groupes de travail rattachés à la Direction (cahier des charges, § 14) : Cellule Genre,
 * commissions constituées pour un travail précis… Créés par acte ou décision du Directeur, avec un
 * objet, une date de début et, le cas échéant, une date de fin ; membres (agents de la Direction)
 * avec leur rôle et participants externes sans compte ; dossiers du groupe (pièces jointes).
 * L’appartenance ne modifie ni l’affectation, ni le grade, ni le rôle : elle donne seulement accès
 * aux dossiers du groupe. Un groupe ne compte jamais dans l’effectif ; il peut être désigné comme
 * structure responsable d’une activité.
 */
const express = require('express');
const { z } = require('zod');
const db = require('../../db/knex');
const validate = require('../../middleware/validate');
const { audit } = require('../../services/audit');
const { notify } = require('../../services/notifications');
const { addHistory, getHistory } = require('../../services/history');
const { notFound, badRequest, forbidden, conflict } = require('../../utils/errors');

const router = express.Router();
const idParam = z.object({ id: z.coerce.number().int().positive() });
const ROLES = { COORDONNATEUR: 'Coordonnateur', MEMBRE: 'Membre', RAPPORTEUR: 'Rapporteur' };
const dateIso = z.string().date();
const jour = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Kinshasa' }).format(new Date());
const iso = (d) => (d instanceof Date ? new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Kinshasa' }).format(d) : d ? String(d).slice(0, 10) : null);

const gerer = (ctx) => ctx.can('groupes.gerer') && ctx.perimetre !== 'SUPERVISION_GLOBALE';
/** Consultation : la Direction (organisation) voit tous les groupes ; un agent, ceux dont il est membre. */
function scopeGroupes(qb, ctx) {
  if (gerer(ctx) || ['DIRECTION', 'SUPERVISION_GLOBALE'].includes(ctx.perimetre)) return qb;
  if (!ctx.agentId) return qb.whereRaw('false');
  return qb.whereExists(db('groupe_membres as m').whereRaw('m.groupe_id = g.id').where('m.agent_id', ctx.agentId).whereNull('m.date_fin'));
}
const estMembre = async (groupeId, agentId) => !!agentId && !!(await db('groupe_membres').where({ groupe_id: groupeId, agent_id: agentId }).whereNull('date_fin').first('id'));

async function charger(ctx, id) {
  const g = await db('groupes_travail').where({ id }).first();
  if (!g) throw notFound('Groupe de travail introuvable.');
  const visible = await scopeGroupes(db('groupes_travail as g').where('g.id', id), ctx).first('g.id');
  if (!visible) throw forbidden('Vous n’êtes pas membre de ce groupe de travail.', 'HORS_PERIMETRE');
  return g;
}

async function detail(ctx, g) {
  const [membres, participants, historique, pieces, acte] = await Promise.all([
    db('groupe_membres as m').join('agents as a', 'a.id', 'm.agent_id').leftJoin('grades as gr', 'gr.id', 'a.grade_id')
      .leftJoin('affectations as af', function j() { this.on('af.agent_id', 'a.id').andOn('af.est_active', db.raw('true')); })
      .leftJoin('bureaux as b', 'b.id', 'af.bureau_id').leftJoin('divisions as d', 'd.id', 'af.division_id')
      .where('m.groupe_id', g.id).orderByRaw("m.date_fin NULLS FIRST, CASE m.role WHEN 'COORDONNATEUR' THEN 0 WHEN 'RAPPORTEUR' THEN 1 ELSE 2 END, a.nom")
      .select('m.*', 'a.matricule', db.raw(`concat_ws(' ', a.prenom, a.nom, a.postnom) as nom_complet`), 'gr.code_officiel as grade', db.raw(`COALESCE(b.nom, d.nom, 'Direction') as structure`)),
    db('groupe_participants').where({ groupe_id: g.id }).orderBy('id'),
    getHistory('GROUPE', g.id),
    db('attachments').where({ entity_type: 'GROUPE', entity_id: g.id }).whereNull('deleted_at').count('* as n').first(),
    g.acte_id ? db('actes_administratifs').where({ id: g.acte_id }).first('id', 'numero', 'reference', 'statut') : null,
  ]);
  const membre = await estMembre(g.id, ctx.agentId);
  const g2 = gerer(ctx);
  return {
    ...g, date_debut: iso(g.date_debut), date_fin: iso(g.date_fin), acte,
    membres: membres.map((m) => ({ ...m, role_libelle: ROLES[m.role], date_debut: iso(m.date_debut), date_fin: iso(m.date_fin) })),
    participants, historique, pieces: Number(pieces.n),
    droits: { gerer: g2 && g.statut === 'ACTIF', dossiers: g2 || membre || ctx.perimetre === 'DIRECTION', deposer: g.statut === 'ACTIF' && (g2 || membre) },
  };
}

/** Structures pouvant être désignées responsables d’une activité : Bureaux, Divisions, groupes actifs. */
router.get('/responsables', async (req, res) => {
  const [divisions, bureaux, groupes] = await Promise.all([
    db('divisions').where({ actif: true }).orderBy('ordre').select('nom'),
    db('bureaux').where({ actif: true }).orderBy('ordre').select('nom'),
    db('groupes_travail').where({ statut: 'ACTIF' }).orderBy('nom').select('nom'),
  ]);
  res.json({ data: [...bureaux.map((x) => ({ nom: x.nom, type: 'BUREAU' })), ...divisions.map((x) => ({ nom: x.nom, type: 'DIVISION' })), ...groupes.map((x) => ({ nom: x.nom, type: 'GROUPE' }))] });
});

router.get('/', validate({ query: z.object({ statut: z.enum(['ACTIF', 'CLOS']).optional() }) }), async (req, res) => {
  const q = scopeGroupes(db('groupes_travail as g'), req.ctx).orderBy([{ column: 'g.statut' }, { column: 'g.date_debut', order: 'desc' }])
    .select('g.*', db.raw('(SELECT count(*)::int FROM groupe_membres m WHERE m.groupe_id = g.id AND m.date_fin IS NULL) as membres'),
      db.raw('(SELECT count(*)::int FROM groupe_participants p WHERE p.groupe_id = g.id) as participants'),
      db.raw(`(SELECT concat_ws(' ', a.prenom, a.nom) FROM groupe_membres m JOIN agents a ON a.id = m.agent_id WHERE m.groupe_id = g.id AND m.role = 'COORDONNATEUR' AND m.date_fin IS NULL LIMIT 1) as coordonnateur`));
  if (req.valid.query.statut) q.where('g.statut', req.valid.query.statut);
  const rows = await q;
  res.json({ data: rows.map((g) => ({ ...g, date_debut: iso(g.date_debut), date_fin: iso(g.date_fin) })), droits: { creer: gerer(req.ctx) } });
});

router.get('/:id', validate({ params: idParam }), async (req, res) => {
  res.json(await detail(req.ctx, await charger(req.ctx, req.valid.params.id)));
});

const groupeSchema = z.object({
  nom: z.string().trim().min(3).max(200),
  objet: z.string().trim().min(10, 'Décrivez l’objet du groupe (10 caractères au moins).').max(4000),
  acte_reference: z.string().trim().min(3, 'Indiquez l’acte ou la décision de création.').max(200),
  acte_id: z.coerce.number().int().positive().optional().nullable(),
  date_debut: dateIso,
  date_fin: dateIso.optional().nullable(),
});

router.post('/', validate({ body: groupeSchema }), async (req, res) => {
  if (!gerer(req.ctx)) throw forbidden('La création des groupes de travail relève du Directeur et du Secrétariat de Direction.');
  const b = req.valid.body;
  if (b.date_fin && b.date_fin < b.date_debut) throw badRequest('La date de fin précède la date de début.');
  if (b.acte_id && !(await db('actes_administratifs').where({ id: b.acte_id, statut: 'VALIDE' }).first('id'))) throw badRequest('L’acte de création doit être un acte validé.');
  const annee = b.date_debut.slice(0, 4);
  const g = await db.transaction(async (trx) => {
    const n = Number((await trx('groupes_travail').where('code', 'like', `GT-${annee}-%`).count('* as n').first()).n) + 1;
    const [row] = await trx('groupes_travail').insert({ ...b, code: `GT-${annee}-${String(n).padStart(3, '0')}`, created_by: req.ctx.userId }).returning('*');
    await addHistory('GROUPE', row.id, req.ctx.userId, { action: 'CREATION', nouveau: 'ACTIF', commentaire: b.acte_reference }, trx);
    return row;
  });
  await audit(req, { action: 'CREATION', module: 'organisation', entite: 'groupe_travail', entiteId: g.id, apres: g });
  res.status(201).json(await detail(req.ctx, g));
});

router.put('/:id', validate({ params: idParam, body: groupeSchema }), async (req, res) => {
  const g = await charger(req.ctx, req.valid.params.id);
  if (!gerer(req.ctx) || g.statut !== 'ACTIF') throw forbidden('Seul un groupe actif se modifie, par le Directeur ou le Secrétariat de Direction.');
  const b = req.valid.body;
  if (b.date_fin && b.date_fin < b.date_debut) throw badRequest('La date de fin précède la date de début.');
  const [row] = await db('groupes_travail').where({ id: g.id }).update({ ...b, updated_at: db.fn.now() }).returning('*');
  await addHistory('GROUPE', g.id, req.ctx.userId, { action: 'MODIFICATION' });
  await audit(req, { action: 'MODIFICATION', module: 'organisation', entite: 'groupe_travail', entiteId: g.id, avant: g, apres: row });
  res.json(await detail(req.ctx, row));
});

router.post('/:id/membres', validate({ params: idParam, body: z.object({ agent_id: z.coerce.number().int().positive(), role: z.enum(Object.keys(ROLES)), date_debut: dateIso.optional() }) }), async (req, res) => {
  const g = await charger(req.ctx, req.valid.params.id);
  if (!gerer(req.ctx) || g.statut !== 'ACTIF') throw forbidden();
  const { agent_id: agentId, role } = req.valid.body;
  const ag = await db('agents').where({ id: agentId }).whereNull('archived_at').where('est_autorite', false).first();
  if (!ag) throw badRequest('Les membres sont des agents de la Direction ; les représentants d’autres services sont enregistrés comme participants externes.');
  if (await estMembre(g.id, agentId)) throw conflict('Cet agent est déjà membre du groupe.');
  if (role === 'COORDONNATEUR' && await db('groupe_membres').where({ groupe_id: g.id, role }).whereNull('date_fin').first('id')) throw conflict('Le groupe a déjà un coordonnateur : retirez-le d’abord.');
  await db('groupe_membres').insert({ groupe_id: g.id, agent_id: agentId, role, date_debut: req.valid.body.date_debut || jour(), created_by: req.ctx.userId });
  const nom = [ag.prenom, ag.nom].filter(Boolean).join(' ');
  await addHistory('GROUPE', g.id, req.ctx.userId, { action: 'MEMBRE_AJOUTE', commentaire: `${nom} — ${ROLES[role]}` });
  await audit(req, { action: 'MODIFICATION', module: 'organisation', entite: 'groupe_travail', entiteId: g.id, message: `Membre ajouté : ${nom} (${ROLES[role]})` });
  const user = await db('users').where({ agent_id: agentId }).first('id');
  if (user) await notify(user.id, { type: 'AFFECTATION', titre: `Membre du groupe de travail « ${g.nom} »`, message: `Rôle : ${ROLES[role]}. Votre affectation, votre grade et votre rôle ne changent pas.`, lien: `/groupes/${g.id}`, expediteur: req.ctx.userId });
  res.status(201).json(await detail(req.ctx, g));
});

router.post('/:id/membres/:membreId/retirer', validate({ params: z.object({ id: z.coerce.number().int().positive(), membreId: z.coerce.number().int().positive() }) }), async (req, res) => {
  const g = await charger(req.ctx, req.valid.params.id);
  if (!gerer(req.ctx) || g.statut !== 'ACTIF') throw forbidden();
  const m = await db('groupe_membres').where({ id: req.valid.params.membreId, groupe_id: g.id }).whereNull('date_fin').first();
  if (!m) throw notFound('Membre introuvable.');
  await db('groupe_membres').where({ id: m.id }).update({ date_fin: jour() });
  await addHistory('GROUPE', g.id, req.ctx.userId, { action: 'MEMBRE_RETIRE', commentaire: `Agent n° ${m.agent_id}` });
  await audit(req, { action: 'MODIFICATION', module: 'organisation', entite: 'groupe_travail', entiteId: g.id, message: `Membre retiré (agent ${m.agent_id})` });
  res.json(await detail(req.ctx, g));
});

router.post('/:id/participants', validate({ params: idParam, body: z.object({ nom: z.string().trim().min(3).max(200), service: z.string().trim().max(200).optional().nullable(), fonction: z.string().trim().max(200).optional().nullable(), contact: z.string().trim().max(200).optional().nullable() }) }), async (req, res) => {
  const g = await charger(req.ctx, req.valid.params.id);
  if (!gerer(req.ctx) || g.statut !== 'ACTIF') throw forbidden();
  await db('groupe_participants').insert({ ...req.valid.body, groupe_id: g.id, created_by: req.ctx.userId });
  await addHistory('GROUPE', g.id, req.ctx.userId, { action: 'PARTICIPANT_AJOUTE', commentaire: `${req.valid.body.nom}${req.valid.body.service ? ` (${req.valid.body.service})` : ''}` });
  res.status(201).json(await detail(req.ctx, g));
});

router.delete('/:id/participants/:pid', validate({ params: z.object({ id: z.coerce.number().int().positive(), pid: z.coerce.number().int().positive() }) }), async (req, res) => {
  const g = await charger(req.ctx, req.valid.params.id);
  if (!gerer(req.ctx) || g.statut !== 'ACTIF') throw forbidden();
  const p = await db('groupe_participants').where({ id: req.valid.params.pid, groupe_id: g.id }).first();
  if (!p) throw notFound();
  await db('groupe_participants').where({ id: p.id }).del();
  await addHistory('GROUPE', g.id, req.ctx.userId, { action: 'PARTICIPANT_RETIRE', commentaire: p.nom });
  res.json(await detail(req.ctx, g));
});

router.post('/:id/cloturer', validate({ params: idParam, body: z.object({ date_fin: dateIso, motif: z.string().trim().min(5).max(1000) }) }), async (req, res) => {
  const g = await charger(req.ctx, req.valid.params.id);
  if (!gerer(req.ctx)) throw forbidden();
  if (g.statut !== 'ACTIF') throw badRequest('Ce groupe est déjà clos.');
  if (req.valid.body.date_fin < iso(g.date_debut)) throw badRequest('La date de clôture précède la date de création.');
  await db.transaction(async (trx) => {
    await trx('groupes_travail').where({ id: g.id }).update({ statut: 'CLOS', date_fin: req.valid.body.date_fin, motif_cloture: req.valid.body.motif, updated_at: trx.fn.now() });
    await trx('groupe_membres').where({ groupe_id: g.id }).whereNull('date_fin').update({ date_fin: req.valid.body.date_fin });
    await addHistory('GROUPE', g.id, req.ctx.userId, { action: 'CLOTURE', ancien: 'ACTIF', nouveau: 'CLOS', commentaire: req.valid.body.motif }, trx);
  });
  await audit(req, { action: 'MODIFICATION', module: 'organisation', entite: 'groupe_travail', entiteId: g.id, message: `Clôture : ${req.valid.body.motif}` });
  res.json(await detail(req.ctx, await db('groupes_travail').where({ id: g.id }).first()));
});

module.exports = router;
module.exports.scopeGroupes = scopeGroupes;
module.exports.estMembre = estMembre;
module.exports.gerer = gerer;

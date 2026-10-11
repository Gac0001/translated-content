'use strict';
/**
 * Tâches : attribuées par le Chef de Bureau aux Agents de SON Bureau uniquement.
 * L’Agent met à jour l’avancement et rend compte ; le Chef de Bureau valide ou retourne.
 * Sous-tâches (décomposition d’une tâche), dépendances (une tâche n’avance qu’après celles dont
 * elle dépend) et preuves d’exécution jointes. Blocage, rapport intermédiaire, annulation et
 * prolongation motivée : voir services/traitement.
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
const { ctxNode, relation, loadAllNodes, directContacts } = require('../../services/hierarchy');
const { scopeTasks, loadEntity } = require('../../services/access');
const pdf = require('../../services/pdf');
const { sendWorkbook } = require('../../services/excel');
const { badRequest, forbidden } = require('../../utils/errors');
const traitement = require('../../services/traitement');

const STATUT_LIBELLES = traitement.LIBELLES;
/** Statuts d’une tâche qui ne retient plus celles qui en dépendent. */
const RESOLUS = ['EXECUTEE', 'VALIDEE', 'CLOTUREE', 'ANNULEE'];

const router = express.Router();
const idParam = z.object({ id: z.coerce.number().int().positive() });
const PRIORITES = ['BASSE', 'NORMALE', 'HAUTE', 'URGENTE'];
const STATUTS = Object.keys(STATUT_LIBELLES);

function baseQuery() {
  return db('tasks as t')
    .join('users as ua', 'ua.id', 't.agent_user_id').leftJoin('agents as aa', 'aa.id', 'ua.agent_id')
    .join('users as uc', 'uc.id', 't.assigne_par_user_id').leftJoin('agents as ac', 'ac.id', 'uc.agent_id')
    .leftJoin('bureaux as b', 'b.id', 't.bureau_id')
    .leftJoin('instructions as i', 'i.id', 't.instruction_id')
    .select('t.*', 'b.nom as bureau_nom', 'i.reference as instruction_reference',
      db.raw(`concat_ws(' ', aa.prenom, aa.nom) as agent_nom`), db.raw(`concat_ws(' ', ac.prenom, ac.nom) as chef_nom`));
}

/** Tâches dont dépend la tâche et qui ne sont pas encore exécutées. */
async function bloquantes(taskId) {
  return db('task_dependances as d').join('tasks as t', 't.id', 'd.depend_de_task_id')
    .where('d.task_id', taskId).whereNotIn('t.statut', RESOLUS).select('t.id', 't.reference', 't.titre', 't.statut');
}

async function assertDependancesLevees(row) {
  const b = await bloquantes(row.id);
  if (b.length) throw badRequest(`Cette tâche dépend de tâches non encore exécutées : ${b.map((t) => t.reference).join(', ')}.`);
}

/** Vérifie qu’ajouter « task dépend de dep » ne crée pas de cycle. */
async function creeraitUnCycle(taskId, depId) {
  if (taskId === depId) return true;
  const r = await db.raw(`WITH RECURSIVE amont(id) AS (
      SELECT depend_de_task_id FROM task_dependances WHERE task_id = ?
      UNION SELECT d.depend_de_task_id FROM task_dependances d JOIN amont a ON d.task_id = a.id)
    SELECT 1 FROM amont WHERE id = ? LIMIT 1`, [depId, taskId]);
  return r.rows.length > 0;
}

async function tachesDuChef(ctx, ids) {
  if (!ids.length) return [];
  const rows = await db('tasks').whereIn('id', ids).where({ assigne_par_user_id: ctx.userId });
  if (rows.length !== new Set(ids).size) throw forbidden('Seules vos propres tâches peuvent servir de tâche parente ou de dépendance.');
  return rows;
}

router.get('/agents', requirePerm('taches.attribuer'), async (req, res) => {
  res.json({ data: (await directContacts(req.ctx, 'DESCENDANT')).filter((n) => n.primaryRole === 'AGENT') });
});

const listQuery = z.object({ statut: z.enum(STATUTS).optional(), priorite: z.enum(PRIORITES).optional(), mes: z.enum(['true', 'false']).optional(), q: z.string().trim().max(100).optional() });

function listed(req) {
  const { statut, priorite, mes, q } = req.valid.query;
  const query = scopeTasks(baseQuery(), req.ctx);
  if (statut) query.where('t.statut', statut);
  if (priorite) query.where('t.priorite', priorite);
  if (mes === 'true') query.where('t.agent_user_id', req.ctx.userId);
  if (q) query.where((w) => w.whereILike('t.titre', `%${q}%`).orWhereILike('t.reference', `%${q}%`));
  return query.orderBy('t.created_at', 'desc');
}

router.get('/', requirePerm('taches.consulter'), validate({ query: listQuery }), async (req, res) => {
  res.json({ data: await listed(req).limit(500) });
});

router.get('/export/:format', requirePerm('taches.consulter'), requirePerm('exports.generer'), validate({ params: z.object({ format: z.enum(['pdf', 'xlsx']) }), query: listQuery }), async (req, res) => {
  const rows = await listed(req);
  const columns = [
    { header: 'Référence', key: 'reference', width: 16 }, { header: 'Tâche', key: 'titre', width: 36 },
    { header: 'Agent', key: 'agent_nom', width: 22 }, { header: 'Bureau', key: 'bureau_nom', width: 26 },
    { header: 'Échéance', value: (r) => pdf.fmtDate(r.echeance), width: 11 },
    { header: 'Statut', value: (r) => STATUT_LIBELLES[r.statut], width: 11 }, { header: 'Avancement', value: (r) => `${r.avancement} %`, width: 10 },
  ];
  await audit(req, { action: 'EXPORT', module: 'taches', message: `Liste des tâches (${req.valid.params.format})` });
  if (req.valid.params.format === 'xlsx') return sendWorkbook(res, 'taches-DEP.xlsx', [{ name: 'Tâches', titre: 'Suivi des tâches', columns, rows }]);
  const { doc, finish } = pdf.createPdf(res, { filename: 'taches-DEP.pdf', titre: 'Suivi des tâches', landscape: true });
  pdf.table(doc, columns, rows);
  return finish();
});

router.get('/:id', requirePerm('taches.consulter'), validate({ params: idParam }), async (req, res) => {
  await loadEntity(req.ctx, 'TASK', req.valid.params.id);
  const row = await baseQuery().where('t.id', req.valid.params.id).first();
  const [historique, pieces, prolongations, sousTaches, dependances, bloq, parent] = await Promise.all([
    getHistory('TASK', row.id), db('attachments').where({ entity_type: 'TASK', entity_id: row.id }).whereNull('deleted_at'),
    traitement.prolongations('TASK', row.id),
    scopeTasks(baseQuery().where('t.parent_task_id', row.id), req.ctx).orderBy('t.id'),
    db('task_dependances as d').join('tasks as t', 't.id', 'd.depend_de_task_id').where('d.task_id', row.id).select('t.id', 't.reference', 't.titre', 't.statut', 't.avancement'),
    bloquantes(row.id),
    row.parent_task_id ? db('tasks').where({ id: row.parent_task_id }).first('id', 'reference', 'titre', 'statut') : null,
  ]);
  const estAgent = row.agent_user_id === req.ctx.userId;
  const estChef = row.assigne_par_user_id === req.ctx.userId;
  const demande = prolongations.find((p) => p.statut === 'DEMANDEE') || null;
  const ACTIFS = traitement.ACTIFS;
  res.json({
    ...row, historique, pieces, prolongations, sousTaches, dependances, bloquantes: bloq, parent,
    actions: {
      estAgent, estChef,
      avancer: estAgent && ACTIFS.includes(row.statut) && !bloq.length,
      bloquer: estAgent && ACTIFS.includes(row.statut),
      debloquer: (estAgent || estChef) && row.statut === 'BLOQUEE',
      rapportIntermediaire: estAgent && ACTIFS.includes(row.statut) && !bloq.length,
      demanderProlongation: estAgent && [...ACTIFS, 'BLOQUEE'].includes(row.statut) && !demande,
      deciderProlongation: estChef && !!demande,
      prolonger: estChef && !demande && !traitement.TERMINES.includes(row.statut),
      annuler: estChef && !traitement.TERMINES.includes(row.statut),
      sousTache: estChef && !traitement.TERMINES.includes(row.statut) && !row.parent_task_id,
      dependances: estChef && !traitement.TERMINES.includes(row.statut),
      preuves: estAgent && ![...traitement.TERMINES].includes(row.statut),
    },
  });
});

/** Attribue une tâche à un Agent du Bureau ; utilisé aussi pour mettre en œuvre une décision. */
async function creerTache(req, { depend_de: dependDe = [], ...b }) {
  const me = ctxNode(req.ctx);
  const all = await loadAllNodes();
  const agent = all.find((n) => n.userId === b.agent_user_id);
  if (!me || !agent || !agent.node || agent.primaryRole !== 'AGENT' || relation(me, agent.node) !== 'DESCENDANT') {
    throw forbidden('Une tâche ne peut être attribuée qu’à un Agent de votre propre Bureau.', 'CHAINE_HIERARCHIQUE');
  }
  if (b.instruction_id) {
    const ins = await db('instructions').where({ id: b.instruction_id }).first();
    if (!ins || ins.destinataire_user_id !== req.ctx.userId) throw forbidden('L’instruction liée doit vous avoir été adressée.');
  }
  if (b.date_debut && b.echeance && b.echeance < b.date_debut) throw badRequest('L’échéance précède la date de début.');
  if (b.parent_task_id) {
    const [parent] = await tachesDuChef(req.ctx, [b.parent_task_id]);
    if (parent.parent_task_id) throw badRequest('Une sous-tâche ne peut pas être elle-même décomposée.');
    if (traitement.TERMINES.includes(parent.statut)) throw badRequest('La tâche parente est terminée ou annulée.');
    if (b.echeance && parent.echeance && b.echeance > String(parent.echeance)) throw badRequest('L’échéance de la sous-tâche dépasse celle de la tâche parente.');
  }
  await tachesDuChef(req.ctx, dependDe);
  const dep = await db('directions').where({ code: 'DEP' }).first();
  const row = await db.transaction(async (trx) => {
    const reference = await nextReference('TAC', 'DEP/TAC', trx);
    const [r] = await trx('tasks').insert({
      ...b, reference, assigne_par_user_id: req.ctx.userId, statut: 'TRANSMISE',
      direction_id: dep.id, division_id: agent.divisionId || null, bureau_id: agent.bureauId,
    }).returning('*');
    if (dependDe.length) await trx('task_dependances').insert([...new Set(dependDe)].map((d) => ({ task_id: r.id, depend_de_task_id: d })));
    await addHistory('TASK', r.id, req.ctx.userId, { action: 'ATTRIBUTION', nouveau: 'TRANSMISE', commentaire: `Attribuée à ${agent.nomComplet}${b.parent_task_id ? ' (sous-tâche)' : ''}` }, trx);
    if (b.parent_task_id) await addHistory('TASK', b.parent_task_id, req.ctx.userId, { action: 'SOUS_TACHE', commentaire: `Sous-tâche ${r.reference} attribuée à ${agent.nomComplet}` }, trx);
    return r;
  });
  await audit(req, { action: 'CREATION', module: 'taches', entite: 'task', entiteId: row.id, apres: row });
  await notify(agent.userId, { type: 'TACHE', titre: `Nouvelle tâche : ${row.titre}`, message: `Réf. ${row.reference}`, lien: `/taches/${row.id}`, expediteur: req.ctx.userId });
  return row;
}

router.post('/', requirePerm('taches.attribuer'), validate({ body: z.object({
  agent_user_id: z.coerce.number().int().positive(),
  titre: z.string().trim().min(3).max(300),
  description: z.string().trim().max(10000).optional().nullable(),
  priorite: z.enum(PRIORITES).default('NORMALE'),
  date_debut: z.string().date().optional().nullable(),
  echeance: z.string().date().optional().nullable(),
  instruction_id: z.coerce.number().int().positive().optional().nullable(),
  parent_task_id: z.coerce.number().int().positive().optional().nullable(),
  depend_de: z.array(z.coerce.number().int().positive()).max(20).optional().default([]),
}) }), async (req, res) => {
  res.status(201).json(await creerTache(req, req.valid.body));
});

async function loadOwn(req, role) {
  const row = await loadEntity(req.ctx, 'TASK', req.valid.params.id);
  if (role === 'agent' && row.agent_user_id !== req.ctx.userId) throw forbidden('Seul l’Agent chargé de la tâche peut effectuer cette opération. Un Agent ne peut modifier le travail d’un autre Agent.');
  if (role === 'chef' && row.assigne_par_user_id !== req.ctx.userId) throw forbidden('Seul le Chef de Bureau ayant attribué la tâche peut effectuer cette opération.');
  return row;
}

function assertStatut(row, allowed) {
  if (!allowed.includes(row.statut)) throw badRequest(`Opération impossible au statut « ${STATUT_LIBELLES[row.statut]} ».`);
}

async function transition(req, row, patch, action, commentaire, notifyTo, titre) {
  const [u] = await db('tasks').where({ id: row.id }).update({ ...patch, updated_at: db.fn.now() }).returning('*');
  await addHistory('TASK', row.id, req.ctx.userId, { action, ancien: row.statut, nouveau: u.statut, avancement: u.avancement, commentaire });
  await audit(req, { action: action === 'VALIDATION' ? 'VALIDATION' : action === 'COMPTE_RENDU' ? 'TRANSMISSION' : 'MODIFICATION', module: 'taches', entite: 'task', entiteId: row.id, avant: { statut: row.statut, avancement: row.avancement }, apres: { statut: u.statut, avancement: u.avancement }, message: action });
  if (notifyTo) await notify(notifyTo, { type: 'TACHE', titre: `${titre} — ${row.reference}`, message: commentaire || row.titre, lien: `/taches/${row.id}`, expediteur: req.ctx.userId });
  return u;
}

const ACTIVE = traitement.ACTIFS;

router.post('/:id/accuser-reception', requirePerm('taches.executer'), validate({ params: idParam }), async (req, res) => {
  const row = await loadOwn(req, 'agent');
  assertStatut(row, ['TRANSMISE']);
  res.json(await transition(req, row, { statut: 'RECUE' }, 'RECEPTION', 'Accusé de réception', row.assigne_par_user_id, 'Tâche reçue'));
});

router.post('/:id/avancement', requirePerm('taches.executer'), validate({ params: idParam, body: z.object({ avancement: z.coerce.number().int().min(0).max(99), observations: z.string().trim().max(5000).optional() }) }), async (req, res) => {
  const row = await loadOwn(req, 'agent');
  assertStatut(row, ACTIVE);
  await assertDependancesLevees(row);
  const late = row.echeance && new Date(row.echeance) < new Date(new Date().toISOString().slice(0, 10));
  res.json(await transition(req, row, { statut: late ? 'EN_RETARD' : 'EN_COURS', avancement: req.valid.body.avancement, observations: req.valid.body.observations ?? row.observations }, 'AVANCEMENT', req.valid.body.observations || `Avancement : ${req.valid.body.avancement} %`, null));
});

router.post('/:id/rendre-compte', requirePerm('taches.executer'), validate({ params: idParam, body: z.object({ rapport_execution: z.string().trim().min(3).max(20000) }) }), async (req, res) => {
  const row = await loadOwn(req, 'agent');
  assertStatut(row, ACTIVE);
  await assertDependancesLevees(row);
  const enCours = await db('tasks').where({ parent_task_id: row.id }).whereNotIn('statut', RESOLUS).pluck('reference');
  if (enCours.length) throw badRequest(`Sous-tâches non encore exécutées : ${enCours.join(', ')}.`);
  res.json(await transition(req, row, { statut: 'EXECUTEE', avancement: 100, rapport_execution: req.valid.body.rapport_execution }, 'COMPTE_RENDU', req.valid.body.rapport_execution.slice(0, 300), row.assigne_par_user_id, 'Tâche exécutée'));
});

router.post('/:id/valider', requirePerm('taches.attribuer'), validate({ params: idParam, body: z.object({ observations: z.string().trim().max(5000).optional() }) }), async (req, res) => {
  const row = await loadOwn(req, 'chef');
  assertStatut(row, ['EXECUTEE']);
  res.json(await transition(req, row, { statut: 'VALIDEE', observations: req.valid.body.observations ?? row.observations }, 'VALIDATION', req.valid.body.observations || 'Tâche validée', row.agent_user_id, 'Tâche validée'));
});

router.post('/:id/retourner', requirePerm('taches.attribuer'), validate({ params: idParam, body: z.object({ observations: z.string().trim().min(3).max(5000) }) }), async (req, res) => {
  const row = await loadOwn(req, 'chef');
  assertStatut(row, ['EXECUTEE']);
  res.json(await transition(req, row, { statut: 'A_CORRIGER', avancement: 90, observations: req.valid.body.observations }, 'RETOUR_CORRECTION', req.valid.body.observations, row.agent_user_id, 'Tâche à corriger'));
});

router.post('/:id/cloturer', requirePerm('taches.attribuer'), validate({ params: idParam }), async (req, res) => {
  const row = await loadOwn(req, 'chef');
  assertStatut(row, ['VALIDEE']);
  res.json(await transition(req, row, { statut: 'CLOTUREE', date_cloture: db.fn.now() }, 'CLOTURE', 'Tâche clôturée', row.agent_user_id, 'Tâche clôturée'));
});

// ─── Dépendances ────────────────────────────────────────────────────────────
router.post('/:id/dependances', requirePerm('taches.attribuer'), validate({ params: idParam, body: z.object({ depend_de_task_id: z.coerce.number().int().positive() }) }), async (req, res) => {
  const row = await loadOwn(req, 'chef');
  if (traitement.TERMINES.includes(row.statut)) throw badRequest('Tâche terminée ou annulée.');
  const depId = req.valid.body.depend_de_task_id;
  const [dep] = await tachesDuChef(req.ctx, [depId]);
  if (await creeraitUnCycle(row.id, depId)) throw badRequest('Dépendance circulaire : cette tâche dépend déjà, directement ou non, de celle-ci.');
  await db('task_dependances').insert({ task_id: row.id, depend_de_task_id: depId }).onConflict(['task_id', 'depend_de_task_id']).ignore();
  await addHistory('TASK', row.id, req.ctx.userId, { action: 'DEPENDANCE', commentaire: `Dépend de ${dep.reference} — ${dep.titre}` });
  await audit(req, { action: 'MODIFICATION', module: 'taches', entite: 'task', entiteId: row.id, message: `Dépendance ajoutée : ${dep.reference}` });
  res.status(201).json({ message: 'Dépendance ajoutée.' });
});

router.delete('/:id/dependances/:dep', requirePerm('taches.attribuer'), validate({ params: z.object({ id: z.coerce.number().int().positive(), dep: z.coerce.number().int().positive() }) }), async (req, res) => {
  const row = await loadOwn(req, 'chef');
  const n = await db('task_dependances').where({ task_id: row.id, depend_de_task_id: req.valid.params.dep }).del();
  if (!n) throw badRequest('Dépendance introuvable.');
  await addHistory('TASK', row.id, req.ctx.userId, { action: 'DEPENDANCE_RETIREE', commentaire: `Dépendance retirée (tâche n° ${req.valid.params.dep})` });
  await audit(req, { action: 'MODIFICATION', module: 'taches', entite: 'task', entiteId: row.id, message: `Dépendance retirée : n° ${req.valid.params.dep}` });
  res.json({ message: 'Dépendance retirée.' });
});

// ─── Blocage, rapport intermédiaire, annulation, prolongations ──────────────
const motifSchema = z.object({ motif: z.string().trim().min(3).max(5000) });
const dateSchema = z.object({ echeance: z.string().date(), motif: z.string().trim().min(3).max(5000) });

router.post('/:id/bloquer', requirePerm('taches.executer'), validate({ params: idParam, body: motifSchema }), async (req, res) => {
  res.json(await traitement.bloquer(req, 'TASK', await loadOwn(req, 'agent'), req.valid.body.motif));
});
router.post('/:id/debloquer', requirePerm('taches.consulter'), validate({ params: idParam, body: z.object({ commentaire: z.string().trim().max(5000).optional() }) }), async (req, res) => {
  res.json(await traitement.debloquer(req, 'TASK', await loadOwn(req), req.valid.body.commentaire));
});
router.post('/:id/rapport-intermediaire', requirePerm('taches.executer'), validate({ params: idParam, body: z.object({ texte: z.string().trim().min(3).max(20000), avancement: z.coerce.number().int().min(0).max(99).optional() }) }), async (req, res) => {
  const row = await loadOwn(req, 'agent');
  await assertDependancesLevees(row);
  res.json(await traitement.rapportIntermediaire(req, 'TASK', row, req.valid.body));
});
router.post('/:id/annuler', requirePerm('taches.attribuer'), validate({ params: idParam, body: motifSchema }), async (req, res) => {
  res.json(await traitement.annuler(req, 'TASK', await loadOwn(req, 'chef'), req.valid.body.motif));
});
router.post('/:id/prolongation', requirePerm('taches.executer'), validate({ params: idParam, body: dateSchema }), async (req, res) => {
  res.status(201).json(await traitement.demanderProlongation(req, 'TASK', await loadOwn(req, 'agent'), req.valid.body));
});
router.post('/:id/prolongation/decision', requirePerm('taches.attribuer'), validate({ params: idParam, body: z.object({ accorder: z.boolean(), echeance: z.string().date().optional(), commentaire: z.string().trim().max(5000).optional() }) }), async (req, res) => {
  res.json(await traitement.deciderProlongation(req, 'TASK', await loadOwn(req, 'chef'), req.valid.body));
});
router.post('/:id/prolonger', requirePerm('taches.attribuer'), validate({ params: idParam, body: dateSchema }), async (req, res) => {
  res.json(await traitement.prolonger(req, 'TASK', await loadOwn(req, 'chef'), req.valid.body));
});

module.exports = router;
module.exports.creerTache = creerTache;

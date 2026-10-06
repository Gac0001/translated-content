'use strict';
/**
 * Demandes d’information du Secrétaire Général au Directeur (cahier des charges, § 13, étape 7).
 * Une demande légère — question, échéance, réponse avec pièces jointes — qui ne crée aucune
 * tâche interne : le SG reçoit la réponse du Directeur, jamais les brouillons de la DEP.
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
const { directeursActifs } = require('../../services/alertes');
const { loadEntity } = require('../../services/access');
const { badRequest, forbidden } = require('../../utils/errors');
const { aujourdhui } = require('../../services/interims');

const router = express.Router();
const idParam = z.object({ id: z.coerce.number().int().positive() });
const STATUTS = { ENVOYEE: 'En attente de réponse', REPONDUE: 'Répondue', CLOSE: 'Close' };

function baseQuery() {
  return db('demandes_information as x')
    .join('users as ue', 'ue.id', 'x.emetteur_user_id').leftJoin('agents as ae', 'ae.id', 'ue.agent_id')
    .leftJoin('users as ur', 'ur.id', 'x.repondu_par').leftJoin('agents as ar', 'ar.id', 'ur.agent_id')
    .select('x.*', db.raw(`coalesce(nullif(concat_ws(' ', ae.prenom, ae.nom), ''), ue.username) as emetteur_nom`),
      db.raw(`nullif(concat_ws(' ', ar.prenom, ar.nom), '') as repondu_par_nom`));
}

/** Le SG voit ses demandes ; le Directeur (titulaire ou intérimaire) voit toutes les demandes. */
function scopeDemandes(qb, ctx) {
  if (ctx.can('demandes_info.repondre')) return qb;
  if (ctx.can('demandes_info.emettre')) return qb.where('x.emetteur_user_id', ctx.userId);
  return qb.whereRaw('false');
}

router.get('/', validate({ query: z.object({ statut: z.enum(Object.keys(STATUTS)).optional() }) }), async (req, res) => {
  if (!req.ctx.can('demandes_info.emettre') && !req.ctx.can('demandes_info.repondre')) throw forbidden();
  const q = scopeDemandes(baseQuery(), req.ctx).orderBy('x.created_at', 'desc');
  if (req.valid.query.statut) q.where('x.statut', req.valid.query.statut);
  const rows = await q.limit(500);
  const today = aujourdhui();
  res.json({ data: rows.map((r) => ({ ...r, en_retard: r.statut === 'ENVOYEE' && !!r.echeance && String(r.echeance) < today })) });
});

router.get('/:id', validate({ params: idParam }), async (req, res) => {
  await loadEntity(req.ctx, 'DEMANDE_INFO', req.valid.params.id);
  const d = await baseQuery().where('x.id', req.valid.params.id).first();
  const [historique, pieces] = await Promise.all([
    getHistory('DEMANDE_INFO', d.id),
    db('attachments').where({ entity_type: 'DEMANDE_INFO', entity_id: d.id }).whereNull('deleted_at'),
  ]);
  const estEmetteur = d.emetteur_user_id === req.ctx.userId;
  res.json({
    ...d, historique, pieces,
    actions: {
      repondre: req.ctx.can('demandes_info.repondre') && d.statut !== 'CLOSE',
      cloturer: estEmetteur && d.statut === 'REPONDUE',
      relancer: estEmetteur && d.statut === 'ENVOYEE',
    },
  });
});

router.post('/', requirePerm('demandes_info.emettre'), validate({ body: z.object({
  objet: z.string().trim().min(3).max(300),
  question: z.string().trim().min(3).max(20000),
  priorite: z.enum(['BASSE', 'NORMALE', 'HAUTE', 'URGENTE']).default('NORMALE'),
  echeance: z.string().date().optional().nullable(),
}) }), async (req, res) => {
  const b = req.valid.body;
  if (b.echeance && b.echeance < aujourdhui()) throw badRequest('L’échéance ne peut pas être antérieure à aujourd’hui.');
  const directeurs = await directeursActifs();
  if (!directeurs.length) throw badRequest('Aucun Directeur en fonction : la demande ne peut pas être adressée.');
  const row = await db.transaction(async (trx) => {
    const reference = await nextReference('DIN', 'DEP/DIN', trx);
    const [r] = await trx('demandes_information').insert({ ...b, echeance: b.echeance || null, reference, emetteur_user_id: req.ctx.userId }).returning('*');
    await addHistory('DEMANDE_INFO', r.id, req.ctx.userId, { action: 'ENVOI', nouveau: 'ENVOYEE', commentaire: 'Demande adressée au Directeur' }, trx);
    return r;
  });
  await audit(req, { action: 'CREATION', module: 'demandes_info', entite: 'demande_information', entiteId: row.id, apres: { reference: row.reference, objet: row.objet } });
  await notify(directeurs, { type: 'DEMANDE_INFO', titre: `Demande d’information du Secrétaire Général : ${row.objet}`, message: `Réf. ${row.reference}`, lien: `/demandes-information/${row.id}`, expediteur: req.ctx.userId });
  res.status(201).json(row);
});

router.post('/:id/repondre', requirePerm('demandes_info.repondre'), validate({ params: idParam, body: z.object({ reponse: z.string().trim().min(3).max(20000) }) }), async (req, res) => {
  const d = await loadEntity(req.ctx, 'DEMANDE_INFO', req.valid.params.id);
  if (d.statut === 'CLOSE') throw badRequest('Demande close.');
  const [u] = await db('demandes_information').where({ id: d.id })
    .update({ statut: 'REPONDUE', reponse: req.valid.body.reponse, repondu_par: req.ctx.userId, repondu_at: db.fn.now(), updated_at: db.fn.now() }).returning('*');
  await addHistory('DEMANDE_INFO', d.id, req.ctx.userId, { action: d.statut === 'REPONDUE' ? 'COMPLEMENT_REPONSE' : 'REPONSE', ancien: d.statut, nouveau: 'REPONDUE', commentaire: req.valid.body.reponse.slice(0, 300) });
  await audit(req, { action: 'TRANSMISSION', module: 'demandes_info', entite: 'demande_information', entiteId: d.id, message: 'Réponse du Directeur' });
  await notify(d.emetteur_user_id, { type: 'DEMANDE_INFO', titre: `Réponse du Directeur : ${d.objet}`, message: `Réf. ${d.reference}`, lien: `/demandes-information/${d.id}`, expediteur: req.ctx.userId });
  res.json(u);
});

router.post('/:id/relancer', requirePerm('demandes_info.emettre'), validate({ params: idParam }), async (req, res) => {
  const d = await loadEntity(req.ctx, 'DEMANDE_INFO', req.valid.params.id);
  if (d.emetteur_user_id !== req.ctx.userId || d.statut !== 'ENVOYEE') throw badRequest('Seule une demande en attente de réponse peut être relancée, par son auteur.');
  await addHistory('DEMANDE_INFO', d.id, req.ctx.userId, { action: 'RELANCE', commentaire: 'Relance du Secrétaire Général' });
  await notify(await directeursActifs(), { type: 'DEMANDE_INFO', titre: `Relance du Secrétaire Général : ${d.objet}`, message: `Réf. ${d.reference}`, lien: `/demandes-information/${d.id}`, expediteur: req.ctx.userId });
  res.json({ message: 'Relance envoyée au Directeur.' });
});

router.post('/:id/cloturer', requirePerm('demandes_info.emettre'), validate({ params: idParam }), async (req, res) => {
  const d = await loadEntity(req.ctx, 'DEMANDE_INFO', req.valid.params.id);
  if (d.emetteur_user_id !== req.ctx.userId || d.statut !== 'REPONDUE') throw badRequest('Seule une demande répondue peut être close, par son auteur.');
  const [u] = await db('demandes_information').where({ id: d.id }).update({ statut: 'CLOSE', cloture_at: db.fn.now(), updated_at: db.fn.now() }).returning('*');
  await addHistory('DEMANDE_INFO', d.id, req.ctx.userId, { action: 'CLOTURE', ancien: d.statut, nouveau: 'CLOSE', commentaire: 'Réponse acceptée' });
  await audit(req, { action: 'MODIFICATION', module: 'demandes_info', entite: 'demande_information', entiteId: d.id, message: 'Demande close' });
  res.json(u);
});

module.exports = router;
module.exports.scopeDemandes = scopeDemandes;

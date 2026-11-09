'use strict';
/**
 * Agenda du Directeur (cahier des charges, § 16, étape 5) : audiences, réunions, déplacements,
 * tenus par le Bureau Secrétariat de Direction ; rappels la veille et une heure avant.
 * Les réunions présidées par le Directeur y figurent automatiquement dès leur convocation.
 */
const express = require('express');
const { z } = require('zod');
const db = require('../../db/knex');
const validate = require('../../middleware/validate');
const { requirePerm } = require('../../middleware/auth');
const { audit } = require('../../services/audit');
const { notify } = require('../../services/notifications');
const { directeursActifs } = require('../../services/alertes');
const { badRequest, notFound } = require('../../utils/errors');

const router = express.Router();
const idParam = z.object({ id: z.coerce.number().int().positive() });
const TYPES = { AUDIENCE: 'Audience', REUNION: 'Réunion', DEPLACEMENT: 'Déplacement', CEREMONIE: 'Cérémonie', AUTRE: 'Autre' };
const STATUTS = { PREVU: 'Prévu', CONFIRME: 'Confirmé', TENU: 'Tenu', ANNULE: 'Annulé' };
const dateHeure = z.string().datetime({ offset: true }).or(z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/));

router.get('/', requirePerm('agenda.consulter'), validate({ query: z.object({ du: z.string().date(), au: z.string().date() }) }), async (req, res) => {
  const { du, au } = req.valid.query;
  if (au < du) throw badRequest('Période invalide.');
  const rows = await db('agenda_evenements as e').leftJoin('users as u', 'u.id', 'e.created_by').leftJoin('agents as a', 'a.id', 'u.agent_id')
    .leftJoin('reunions as r', 'r.id', 'e.reunion_id')
    .where('e.debut', '>=', `${du}T00:00:00+01:00`).where('e.debut', '<=', `${au}T23:59:59+01:00`)
    .orderBy('e.debut')
    .select('e.*', 'r.reference as reunion_reference', db.raw(`coalesce(nullif(concat_ws(' ', a.prenom, a.nom), ''), u.username) as auteur`));
  res.json({ data: rows, droits: { gerer: req.ctx.can('agenda.gerer') } });
});

const evenementSchema = z.object({
  type: z.enum(Object.keys(TYPES).filter((t) => t !== 'REUNION')),
  titre: z.string().trim().min(3).max(300),
  debut: dateHeure,
  fin: dateHeure.optional().nullable(),
  lieu: z.string().trim().max(200).optional().nullable(),
  interlocuteur: z.string().trim().max(300).optional().nullable(),
  notes: z.string().trim().max(5000).optional().nullable(),
  confidentiel: z.boolean().optional().default(false),
  statut: z.enum(['PREVU', 'CONFIRME']).optional().default('PREVU'),
});

function controler(b) {
  if (b.fin && new Date(b.fin) <= new Date(b.debut)) throw badRequest('La fin doit suivre le début.');
}

async function prevenirDirecteur(req, titre, ev) {
  const dirs = (await directeursActifs()).filter((x) => x !== req.ctx.userId);
  if (dirs.length) await notify(dirs, { type: 'AGENDA', titre: `${titre} : ${ev.titre}`, message: new Date(ev.debut).toLocaleString('fr-FR', { timeZone: 'Africa/Kinshasa', dateStyle: 'full', timeStyle: 'short' }), lien: '/agenda', expediteur: req.ctx.userId });
}

router.post('/', requirePerm('agenda.gerer'), validate({ body: evenementSchema }), async (req, res) => {
  const b = req.valid.body;
  controler(b);
  const [ev] = await db('agenda_evenements').insert({ ...b, fin: b.fin || null, created_by: req.ctx.userId }).returning('*');
  await audit(req, { action: 'CREATION', module: 'agenda', entite: 'agenda_evenement', entiteId: ev.id, apres: { type: ev.type, titre: ev.titre, debut: ev.debut } });
  await prevenirDirecteur(req, 'Ajouté à votre agenda', ev);
  res.status(201).json(ev);
});

router.put('/:id', requirePerm('agenda.gerer'), validate({ params: idParam, body: evenementSchema }), async (req, res) => {
  const ev = await db('agenda_evenements').where({ id: req.valid.params.id }).first();
  if (!ev) throw notFound();
  if (ev.reunion_id) throw badRequest('Une réunion se modifie depuis sa fiche : l’agenda suit automatiquement.');
  const b = req.valid.body;
  controler(b);
  const deplace = new Date(b.debut).getTime() !== new Date(ev.debut).getTime();
  const [u] = await db('agenda_evenements').where({ id: ev.id }).update({ ...b, fin: b.fin || null, updated_at: db.fn.now(), ...(deplace ? { rappel_veille_envoye: false, rappel_heure_envoye: false } : {}) }).returning('*');
  await audit(req, { action: 'MODIFICATION', module: 'agenda', entite: 'agenda_evenement', entiteId: ev.id, avant: { debut: ev.debut, statut: ev.statut }, apres: { debut: u.debut, statut: u.statut } });
  if (deplace) await prevenirDirecteur(req, 'Rendez-vous déplacé', u);
  res.json(u);
});

router.post('/:id/statut', requirePerm('agenda.gerer'), validate({ params: idParam, body: z.object({ statut: z.enum(Object.keys(STATUTS)) }) }), async (req, res) => {
  const ev = await db('agenda_evenements').where({ id: req.valid.params.id }).first();
  if (!ev) throw notFound();
  if (ev.reunion_id) throw badRequest('Une réunion se convoque, se tient ou s’annule depuis sa fiche.');
  const [u] = await db('agenda_evenements').where({ id: ev.id }).update({ statut: req.valid.body.statut, updated_at: db.fn.now() }).returning('*');
  await audit(req, { action: 'MODIFICATION', module: 'agenda', entite: 'agenda_evenement', entiteId: ev.id, avant: { statut: ev.statut }, apres: { statut: u.statut } });
  if (u.statut === 'ANNULE') await prevenirDirecteur(req, 'Rendez-vous annulé', u);
  res.json(u);
});

module.exports = router;
module.exports.TYPES = TYPES;

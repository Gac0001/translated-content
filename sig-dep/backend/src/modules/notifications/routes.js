'use strict';
const express = require('express');
const { z } = require('zod');
const db = require('../../db/knex');
const validate = require('../../middleware/validate');
const config = require('../../config/env');
const { EMAIL_TYPES } = require('../../services/mailer');
const { audit } = require('../../services/audit');

const router = express.Router();

router.get('/', validate({ query: z.object({ non_lues: z.enum(['true', 'false']).optional(), limit: z.coerce.number().int().min(1).max(200).default(50) }) }), async (req, res) => {
  const q = db('notifications as n').leftJoin('users as u', 'u.id', 'n.expediteur_user_id').leftJoin('agents as a', 'a.id', 'u.agent_id')
    .where('n.user_id', req.ctx.userId).orderBy('n.created_at', 'desc').limit(req.valid.query.limit)
    .select('n.*', db.raw(`COALESCE(NULLIF(concat_ws(' ', a.prenom, a.nom), ''), u.username) as expediteur`));
  if (req.valid.query.non_lues === 'true') q.where('n.lu', false);
  const nonLues = await db('notifications').where({ user_id: req.ctx.userId, lu: false }).count('* as n').first();
  res.json({ data: await q, nonLues: Number(nonLues.n) });
});

router.get('/compteur', async (req, res) => {
  const r = await db('notifications').where({ user_id: req.ctx.userId, lu: false }).count('* as n').first();
  res.json({ nonLues: Number(r.n) });
});

router.post('/:id/lue', validate({ params: z.object({ id: z.coerce.number().int().positive() }) }), async (req, res) => {
  await db('notifications').where({ id: req.valid.params.id, user_id: req.ctx.userId }).update({ lu: true, lu_at: db.fn.now() });
  res.json({ message: 'Notification marquée comme lue.' });
});

router.post('/tout-lire', async (req, res) => {
  await db('notifications').where({ user_id: req.ctx.userId, lu: false }).update({ lu: true, lu_at: db.fn.now() });
  res.json({ message: 'Toutes les notifications sont marquées comme lues.' });
});

// ─── Préférences de notification par e-mail ────────────────────────────────
router.get('/preferences', async (req, res) => {
  const p = await db('notification_preferences').where({ user_id: req.ctx.userId }).first();
  res.json({
    messagerieActive: config.mail.enabled,
    email: req.ctx.agent ? req.ctx.agent.email : null,
    emailActif: p ? p.email_actif : true,
    typesDesactives: p ? p.types_desactives : [],
    types: Object.entries(EMAIL_TYPES).map(([code, libelle]) => ({ code, libelle })),
  });
});

router.put('/preferences', validate({ body: z.object({
  emailActif: z.boolean(),
  typesDesactives: z.array(z.enum(Object.keys(EMAIL_TYPES))).max(50),
}) }), async (req, res) => {
  const { emailActif, typesDesactives } = req.valid.body;
  await db('notification_preferences').insert({ user_id: req.ctx.userId, email_actif: emailActif, types_desactives: JSON.stringify([...new Set(typesDesactives)]), updated_at: db.fn.now() })
    .onConflict('user_id').merge();
  await audit(req, { action: 'MODIFICATION', module: 'notifications', entite: 'preferences', entiteId: req.ctx.userId, apres: req.valid.body });
  res.json({ message: 'Préférences de notification enregistrées.' });
});

module.exports = router;

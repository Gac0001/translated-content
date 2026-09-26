'use strict';
const express = require('express');
const { z } = require('zod');
const db = require('../../db/knex');
const validate = require('../../middleware/validate');

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

module.exports = router;

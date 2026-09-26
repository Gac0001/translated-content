'use strict';
/** Journal d’audit : consultation en lecture seule (aucune route de modification). */
const express = require('express');
const { z } = require('zod');
const db = require('../../db/knex');
const validate = require('../../middleware/validate');
const { requirePerm } = require('../../middleware/auth');
const { audit } = require('../../services/audit');
const { sendWorkbook } = require('../../services/excel');

const router = express.Router();
const query = z.object({
  q: z.string().trim().max(100).optional(), module: z.string().max(40).optional(), action: z.string().max(40).optional(),
  resultat: z.enum(['SUCCES', 'ECHEC']).optional(), du: z.string().date().optional(), au: z.string().date().optional(),
  page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(200).default(50),
});

function filtered(f) {
  const q = db('audit_logs');
  if (f.q) q.where((w) => w.whereILike('username', `%${f.q}%`).orWhereILike('message', `%${f.q}%`).orWhereILike('entite_id', `%${f.q}%`).orWhereILike('ip', `%${f.q}%`));
  if (f.module) q.where('module', f.module);
  if (f.action) q.where('action', f.action);
  if (f.resultat) q.where('resultat', f.resultat);
  if (f.du) q.where('created_at', '>=', f.du);
  if (f.au) q.where('created_at', '<', db.raw(`?::date + 1`, [f.au]));
  return q;
}

router.get('/', requirePerm('audit.consulter'), validate({ query }), async (req, res) => {
  const f = req.valid.query;
  const total = await filtered(f).count('* as n').first();
  const data = await filtered(f).orderBy('created_at', 'desc').orderBy('id', 'desc').limit(f.limit).offset((f.page - 1) * f.limit);
  const [modules, actions] = await Promise.all([db('audit_logs').distinct('module').orderBy('module').pluck('module'), db('audit_logs').distinct('action').orderBy('action').pluck('action')]);
  res.json({ data, total: Number(total.n), page: f.page, limit: f.limit, modules, actions });
});

router.get('/export/xlsx', requirePerm('audit.consulter'), validate({ query }), async (req, res) => {
  const rows = await filtered(req.valid.query).orderBy('created_at', 'desc').limit(20000);
  await audit(req, { action: 'EXPORT', module: 'audit', message: `Export du journal d’audit (${rows.length} lignes)` });
  return sendWorkbook(res, 'journal-audit-SIG-DEP.xlsx', [{
    name: 'Journal d’audit', titre: 'Journal d’audit',
    columns: [
      { header: 'Date et heure', value: (r) => new Date(r.created_at).toLocaleString('fr-FR', { timeZone: 'Africa/Kinshasa' }), width: 20 },
      { header: 'Utilisateur', key: 'username', width: 18 }, { header: 'Rôle', key: 'role', width: 18 }, { header: 'Adresse IP', key: 'ip', width: 16 },
      { header: 'Action', key: 'action', width: 20 }, { header: 'Module', key: 'module', width: 14 }, { header: 'Élément', value: (r) => [r.entite, r.entite_id].filter(Boolean).join(' #'), width: 18 },
      { header: 'Ancienne valeur', value: (r) => (r.ancienne_valeur ? JSON.stringify(r.ancienne_valeur) : ''), width: 40 },
      { header: 'Nouvelle valeur', value: (r) => (r.nouvelle_valeur ? JSON.stringify(r.nouvelle_valeur) : ''), width: 40 },
      { header: 'Résultat', key: 'resultat', width: 10 }, { header: 'Message', key: 'message', width: 40 },
    ],
    rows,
  }]);
});

module.exports = router;

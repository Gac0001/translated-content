'use strict';
/**
 * Référentiel de la planification : exercices budgétaires, maquette programmatique (programmes
 * et actions) et services du Ministère, structures responsables des PTBA.
 * Tenu par le Bureau Programme, la Division Programme et Suivi et le Directeur.
 */
const express = require('express');
const { z } = require('zod');
const db = require('../../db/knex');
const validate = require('../../middleware/validate');
const { requirePerm } = require('../../middleware/auth');
const { audit } = require('../../services/audit');
const { badRequest, conflict, notFound } = require('../../utils/errors');

const router = express.Router();
const idParam = z.object({ id: z.coerce.number().int().positive() });

router.get('/referentiel', requirePerm('planification.consulter'), async (req, res) => {
  const [exercices, programmes, actions, services] = await Promise.all([
    db('exercices').orderBy('annee', 'desc'),
    db('plan_programmes').orderBy(['ordre', 'code']),
    db('plan_actions').orderBy(['programme_id', 'code']),
    db('plan_services').orderBy('sigle'),
  ]);
  res.json({
    exercices, services,
    programmes: programmes.map((p) => ({ ...p, actions: actions.filter((a) => a.programme_id === p.id) })),
    droits: { gerer: req.ctx.can('planification.referentiel') },
  });
});

async function enregistrer(req, res, table, entite, b, unique) {
  const id = req.valid.params?.id;
  try {
    let row;
    if (id) {
      const avant = await db(table).where({ id }).first();
      if (!avant) throw notFound();
      [row] = await db(table).where({ id }).update({ ...b, updated_at: db.fn.now() }).returning('*');
      await audit(req, { action: 'MODIFICATION', module: 'planification', entite, entiteId: id, avant, apres: row });
    } else {
      [row] = await db(table).insert(b).returning('*');
      await audit(req, { action: 'CREATION', module: 'planification', entite, entiteId: row.id, apres: row });
    }
    res.status(id ? 200 : 201).json(row);
  } catch (e) {
    if (e.code === '23505') throw conflict(unique);
    throw e;
  }
}

const exerciceSchema = z.object({ annee: z.coerce.number().int().min(2000).max(2100), statut: z.enum(['PREPARATION', 'EXECUTION', 'CLOTURE']).default('PREPARATION') });
router.post('/exercices', requirePerm('planification.referentiel'), validate({ body: exerciceSchema }), (req, res) => enregistrer(req, res, 'exercices', 'exercice', req.valid.body, 'Cet exercice existe déjà.'));
router.put('/exercices/:id', requirePerm('planification.referentiel'), validate({ params: idParam, body: exerciceSchema }), (req, res) => enregistrer(req, res, 'exercices', 'exercice', req.valid.body, 'Cet exercice existe déjà.'));

const programmeSchema = z.object({
  code: z.string().trim().min(1).max(20), libelle: z.string().trim().min(3).max(300),
  objectif_global: z.string().trim().max(2000).optional().nullable(), ordre: z.coerce.number().int().min(0).default(0), actif: z.boolean().default(true),
});
router.post('/programmes', requirePerm('planification.referentiel'), validate({ body: programmeSchema }), (req, res) => enregistrer(req, res, 'plan_programmes', 'programme', req.valid.body, 'Ce code de programme existe déjà.'));
router.put('/programmes/:id', requirePerm('planification.referentiel'), validate({ params: idParam, body: programmeSchema }), (req, res) => enregistrer(req, res, 'plan_programmes', 'programme', req.valid.body, 'Ce code de programme existe déjà.'));

const actionSchema = z.object({
  programme_id: z.coerce.number().int().positive(), code: z.string().trim().min(1).max(20), libelle: z.string().trim().min(3).max(400),
  services_normatifs: z.string().trim().max(2000).optional().nullable(), operateurs: z.string().trim().max(2000).optional().nullable(), actif: z.boolean().default(true),
});
async function controlerProgramme(req, res, next) {
  if (!(await db('plan_programmes').where({ id: req.valid.body.programme_id }).first())) return next(badRequest('Programme inconnu.'));
  return next();
}
router.post('/actions', requirePerm('planification.referentiel'), validate({ body: actionSchema }), controlerProgramme, (req, res) => enregistrer(req, res, 'plan_actions', 'action', req.valid.body, 'Ce code d’action existe déjà dans le programme.'));
router.put('/actions/:id', requirePerm('planification.referentiel'), validate({ params: idParam, body: actionSchema }), controlerProgramme, (req, res) => enregistrer(req, res, 'plan_actions', 'action', req.valid.body, 'Ce code d’action existe déjà dans le programme.'));

const serviceSchema = z.object({ sigle: z.string().trim().min(2).max(30).transform((s) => s.toUpperCase()), libelle: z.string().trim().min(2).max(300), actif: z.boolean().default(true) });
router.post('/services', requirePerm('planification.referentiel'), validate({ body: serviceSchema }), (req, res) => enregistrer(req, res, 'plan_services', 'service', req.valid.body, 'Ce sigle de service existe déjà.'));
router.put('/services/:id', requirePerm('planification.referentiel'), validate({ params: idParam, body: serviceSchema }), (req, res) => enregistrer(req, res, 'plan_services', 'service', req.valid.body, 'Ce sigle de service existe déjà.'));

module.exports = router;

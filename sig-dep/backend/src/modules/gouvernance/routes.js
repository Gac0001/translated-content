'use strict';
/**
 * Gouvernance du compte Admin Système : confirmations des opérations critiques,
 * accès de support temporaires, compte d’urgence. Voir services/gouvernance.js.
 */
const express = require('express');
const { z } = require('zod');
const db = require('../../db/knex');
const validate = require('../../middleware/validate');
const { requirePerm } = require('../../middleware/auth');
const { audit } = require('../../services/audit');
const g = require('../../services/gouvernance');

const router = express.Router();
const idParam = z.object({ id: z.coerce.number().int().positive() });
const decision = (valeurs) => z.object({
  decision: z.enum(valeurs), motDePasse: z.string().min(1, 'mot de passe requis'), commentaire: z.string().trim().max(1000).optional(),
});

// ─── Opérations critiques ───────────────────────────────────────────────────
router.get('/confirmations', requirePerm('systeme.maintenir', 'systeme.configurer', 'role.attribuer', 'operations.confirmer'), async (req, res) => {
  await g.expirerConfirmations();
  const q = db('demandes_confirmation').orderBy('id', 'desc').limit(200);
  if (!req.ctx.can('operations.confirmer')) q.where('demandeur_id', req.ctx.userId);
  const rows = await q;
  res.json({ data: rows.map((d) => ({ ...d, typeLibelle: g.OPERATIONS[d.type] })), validiteHeures: g.VALIDITE_HEURES });
});

router.post('/confirmations/:id/decision', requirePerm('operations.confirmer'), validate({ params: idParam, body: decision(['CONFIRMER', 'REFUSER']) }), async (req, res) => {
  const d = await g.deciderConfirmation(req.ctx, req.valid.params.id, req.valid.body);
  await audit(req, { action: req.valid.body.decision === 'CONFIRMER' ? 'CONFIRMATION_OPERATION' : 'REFUS_OPERATION', module: 'gouvernance', entite: 'demande_confirmation', entiteId: d.id, message: `${g.OPERATIONS[d.type]} — ${d.resume}${req.valid.body.commentaire ? ` — ${req.valid.body.commentaire}` : ''}` });
  res.json(d);
});

router.post('/confirmations/:id/annuler', validate({ params: idParam }), async (req, res) => {
  await g.annulerConfirmation(req.ctx, req.valid.params.id);
  await audit(req, { action: 'ANNULATION', module: 'gouvernance', entite: 'demande_confirmation', entiteId: req.valid.params.id });
  res.json({ message: 'Demande annulée.' });
});

// ─── Accès de support ───────────────────────────────────────────────────────
router.get('/support', requirePerm('acces_support.demander', 'acces_support.valider'), async (req, res) => {
  await g.expirerSupport();
  const q = db('acces_support').orderBy('id', 'desc').limit(200);
  if (!req.ctx.can('acces_support.valider')) q.where('demandeur_id', req.ctx.userId);
  const rows = await q;
  res.json({ data: rows.map((a) => ({ ...a, portee: g.porteeSupport(a) })), types: g.TYPES_SUPPORT });
});

router.post('/support', requirePerm('acces_support.demander'), validate({ body: z.object({
  motif: z.string().trim().min(10, 'motif requis (10 caractères au moins)').max(1000),
  entity_type: z.union([z.enum(Object.keys(g.TYPES_SUPPORT)), z.literal('').transform(() => null), z.null()]).optional(),
  entity_id: z.union([z.coerce.number().int().positive(), z.literal('').transform(() => null), z.null()]).optional(),
  duree_minutes: z.coerce.number().int().min(15, '15 minutes au moins').max(240, '4 heures au plus'),
}) }), async (req, res) => {
  const b = req.valid.body;
  if (b.entity_id && !b.entity_type) b.entity_type = null;
  const a = await g.demanderSupport(req.ctx, b);
  await audit(req, { action: 'DEMANDE_ACCES_SUPPORT', module: 'gouvernance', entite: 'acces_support', entiteId: a.id, apres: { portee: g.porteeSupport(a), duree: a.duree_minutes }, message: a.motif });
  res.status(201).json(a);
});

router.post('/support/:id/decision', requirePerm('acces_support.valider'), validate({ params: idParam, body: decision(['VALIDER', 'REFUSER', 'REVOQUER']) }), async (req, res) => {
  const a = await g.deciderSupport(req.ctx, req.valid.params.id, req.valid.body);
  await audit(req, { action: `ACCES_SUPPORT_${req.valid.body.decision}`, module: 'gouvernance', entite: 'acces_support', entiteId: a.id, message: `${g.porteeSupport(a)}${req.valid.body.commentaire ? ` — ${req.valid.body.commentaire}` : ''}` });
  res.json(a);
});

router.post('/support/:id/terminer', requirePerm('acces_support.demander'), validate({ params: idParam }), async (req, res) => {
  await g.terminerSupport(req.ctx, req.valid.params.id);
  await audit(req, { action: 'FIN_ACCES_SUPPORT', module: 'gouvernance', entite: 'acces_support', entiteId: req.valid.params.id });
  res.json({ message: 'Accès de support terminé.' });
});

// ─── Compte d’urgence ───────────────────────────────────────────────────────
router.get('/urgence', requirePerm('urgence.activer', 'urgence.desactiver'), async (req, res) => {
  res.json({ ...(await g.etatUrgence()), dureeMaxHeures: g.URGENCE_MAX_HEURES });
});

router.post('/urgence/activer', requirePerm('urgence.activer'), validate({ body: z.object({
  motif: z.string().trim().min(10, 'motif requis (10 caractères au moins)').max(1000),
  heures: z.coerce.number().int().min(1).max(g.URGENCE_MAX_HEURES),
  motDePasse: z.string().min(1, 'mot de passe requis'),
}) }), async (req, res) => {
  await g.verifierMotDePasse(req.ctx.userId, req.valid.body.motDePasse);
  const r = await g.activerUrgence({ par: req.ctx.username, parId: req.ctx.userId, motif: req.valid.body.motif, heures: req.valid.body.heures });
  await audit(req, { action: 'ACTIVATION_URGENCE', module: 'gouvernance', entite: 'user', entiteId: null, apres: { jusqua: r.jusqua }, message: req.valid.body.motif });
  res.json({ ...r, message: 'Compte d’urgence activé. Remettez ce mot de passe temporaire de façon sécurisée : il ne sera plus affiché.' });
});

router.post('/urgence/fermer', requirePerm('urgence.desactiver'), validate({ body: z.object({ motif: z.string().trim().max(200).optional() }) }), async (req, res) => {
  const ferme = await g.fermerUrgence({ par: req.ctx.username, motif: req.valid.body.motif || 'Fin de l’intervention' });
  if (ferme) await audit(req, { action: 'FERMETURE_URGENCE', module: 'gouvernance', entite: 'user', message: req.valid.body.motif || 'Fin de l’intervention' });
  res.json({ message: ferme ? 'Compte d’urgence refermé et scellé.' : 'Le compte d’urgence était déjà scellé.' });
});

module.exports = router;

'use strict';
/**
 * Registre des actes administratifs : nominations, affectations, intérims, désignations,
 * fins de fonction. Voir services/actes.js pour le circuit et les effets.
 */
const express = require('express');
const { z } = require('zod');
const db = require('../../db/knex');
const validate = require('../../middleware/validate');
const { requirePerm } = require('../../middleware/auth');
const { audit } = require('../../services/audit');
const { addHistory, getHistory } = require('../../services/history');
const actes = require('../../services/actes');
const { interimsEnVigueur, aujourdhui, ROLES_COMMANDEMENT, LIBELLES_INTERIM } = require('../../services/interims');
const { forbidden } = require('../../utils/errors');

const router = express.Router();
const idParam = z.object({ id: z.coerce.number().int().positive() });
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date attendue au format AAAA-MM-JJ');
const dateOpt = z.union([date, z.literal('').transform(() => null), z.null()]).optional();

const acteSchema = z.object({
  type: z.enum(Object.keys(actes.TYPES)),
  reference: z.string().trim().min(3, 'référence officielle requise').max(150),
  date_acte: date,
  autorite: z.string().trim().min(3, 'autorité signataire requise').max(150),
  objet: z.string().trim().min(5, 'objet requis').max(300),
  motif: z.string().trim().max(3000).optional().nullable(),
  agent_id: z.coerce.number().int().positive().optional().nullable(),
  poste_id: z.coerce.number().int().positive().optional().nullable(),
  permissions: z.array(z.string().max(60)).max(20).optional(),
  date_debut: dateOpt,
  date_fin: dateOpt,
});

const peutVoirRegistre = (ctx) => ['actes.consulter', 'actes.preparer', 'actes.enregistrer_direction'].some((p) => ctx.can(p));

// ─── Consultation ───────────────────────────────────────────────────────────
router.get('/', validate({ query: z.object({
  type: z.enum(Object.keys(actes.TYPES)).optional(), statut: z.enum(actes.STATUTS).optional(),
  q: z.string().trim().max(80).optional(), en_vigueur: z.enum(['1', 'true']).optional(),
}) }), async (req, res) => {
  const { type, statut, q, en_vigueur: enVigueur } = req.valid.query;
  const query = actes.scopeActes(actes.baseQuery(), req.ctx).orderBy('x.created_at', 'desc').limit(500);
  if (type) query.where('x.type', type);
  if (statut) query.where('x.statut', statut);
  if (enVigueur) {
    const jour = aujourdhui();
    query.where('x.statut', 'VALIDE').whereIn('x.type', ['INTERIM', 'DESIGNATION']).where('x.date_debut', '<=', jour).where('x.date_fin', '>=', jour);
  }
  if (q) query.where((w) => w.whereILike('x.numero', `%${q}%`).orWhereILike('x.reference', `%${q}%`).orWhereILike('x.objet', `%${q}%`).orWhereILike('ag.nom', `%${q}%`));
  const rows = (await query).map(actes.vue);
  res.json({
    data: rows,
    droits: {
      registre: peutVoirRegistre(req.ctx),
      preparer: req.ctx.can('actes.preparer') || req.ctx.can('actes.enregistrer_direction'),
      valider: req.ctx.can('actes.valider') || req.ctx.can('actes.valider_direction'),
    },
  });
});

/** Intérims en vigueur (organigramme, tableaux de bord). */
router.get('/interims', requirePerm('organisation.consulter'), async (req, res) => {
  const list = await interimsEnVigueur();
  res.json({
    data: list.map((i) => ({
      acteId: i.acte_id, numero: i.numero, poste: i.poste_libelle, posteId: i.poste_id, role: i.role_associe,
      titre: LIBELLES_INTERIM[i.role_associe], interimaire: i.interimaire, dateDebut: i.date_debut, dateFin: i.date_fin,
      bureauId: i.bureau_id, divisionId: i.division_id, niveau: i.niveau,
    })),
  });
});

/** Référentiels du formulaire : postes de commandement, personnes, opérations désignables. */
router.get('/referentiels', async (req, res) => {
  const direction = req.ctx.can('actes.enregistrer_direction');
  if (!req.ctx.can('actes.preparer') && !direction) throw forbidden('Vous ne préparez pas d’actes administratifs.');
  const postes = await db('postes_organiques as p')
    .leftJoin('bureaux as b', 'b.id', 'p.bureau_id').leftJoin('divisions as d', 'd.id', 'p.division_id')
    .leftJoin('affectations as a', function j() { this.on('a.poste_id', 'p.id').andOn('a.est_active', db.raw('true')); })
    .leftJoin('agents as ag', 'ag.id', 'a.agent_id')
    .where('p.actif', true).whereIn('p.role_associe', ROLES_COMMANDEMENT)
    .modify((q) => { if (!req.ctx.can('actes.preparer')) q.where('p.role_associe', 'DIRECTEUR'); })
    .select('p.id', 'p.libelle', 'p.role_associe', db.raw('COALESCE(b.code_organique, d.code_organique) as code_organique'),
      db.raw(`concat_ws(' ', ag.prenom, ag.nom, ag.postnom) as titulaire`))
    .orderByRaw("CASE p.role_associe WHEN 'DIRECTEUR' THEN 0 WHEN 'CHEF_DIVISION' THEN 1 ELSE 2 END, code_organique NULLS LAST");
  const personnes = await db('agents as ag').join('users as u', 'u.agent_id', 'ag.id')
    .leftJoin('affectations as a', function j() { this.on('a.agent_id', 'ag.id').andOn('a.est_active', db.raw('true')); })
    .leftJoin('bureaux as b', 'b.id', 'a.bureau_id').leftJoin('divisions as d', 'd.id', 'a.division_id')
    .leftJoin('grades as g', 'g.id', 'ag.grade_id')
    .whereNot('u.statut', 'DESACTIVE').where('ag.est_autorite', false).whereNull('ag.archived_at')
    .select('ag.id', 'ag.matricule', db.raw(`concat_ws(' ', ag.prenom, ag.nom, ag.postnom) as nom`), 'g.libelle as grade',
      db.raw(`COALESCE(b.nom, d.nom, CASE WHEN a.niveau = 'DIRECTION' THEN 'Direction' END) as structure`))
    .orderBy('ag.nom');
  res.json({
    types: actes.TYPES,
    postes: postes.map((p) => ({ ...p, titulaire: p.titulaire || null })),
    personnes,
    designables: await db('permissions').where({ delegable: true }).select('code', 'libelle').orderBy('libelle'),
    autoritePreparation: req.ctx.can('actes.preparer') ? 'DIRECTEUR' : 'SECRETAIRE_GENERAL',
  });
});

/** Actes validés pouvant fonder l’attribution ou le retrait d’un rôle d’autorité (Admin Système). */
router.get('/fondements', requirePerm('role.attribuer'), validate({ query: z.object({ agent_id: z.coerce.number().int().positive() }) }), async (req, res) => {
  const rows = await db('actes_administratifs').where({ agent_id: req.valid.query.agent_id, statut: 'VALIDE' })
    .whereIn('type', ['NOMINATION', 'AFFECTATION', 'FIN_FONCTION']).orderBy('date_acte', 'desc')
    .select('id', 'numero', 'type', 'reference', 'date_acte', 'objet');
  res.json({ data: rows.map((r) => ({ ...r, typeLibelle: actes.TYPES[r.type] })) });
});

router.get('/:id', validate({ params: idParam }), async (req, res) => {
  const a = actes.vue(await actes.charger(req.ctx, req.valid.params.id));
  const designations = a.type === 'DESIGNATION' ? await db('user_permissions as up').join('permissions as p', 'p.id', 'up.permission_id')
    .where('up.acte_id', a.id).select('up.id', 'p.code', 'p.libelle', 'up.date_debut', 'up.date_fin', 'up.revoked_at', 'up.motif_revocation') : [];
  const libelles = await db('permissions').whereIn('code', a.permissions || []).select('code', 'libelle');
  res.json({
    ...a, designations, permissionsLibelles: libelles,
    historique: await getHistory('ACTE', a.id),
    rectificatifs: await db('actes_administratifs').where({ rectifie_acte_id: a.id }).select('id', 'numero', 'statut'),
    droits: {
      modifier: a.statut === 'BROUILLON' && a.prepare_par === req.ctx.userId,
      decider: a.statut === 'SOUMIS' && (a.validation_par === 'SECRETAIRE_GENERAL' ? req.ctx.can('actes.valider_direction') : req.ctx.can('actes.valider'))
        && !(req.ctx.agentId && [a.agent_id, a.titulaire_agent_id].includes(req.ctx.agentId)),
      revoquer: a.statut === 'VALIDE' && (a.validation_par === 'SECRETAIRE_GENERAL' ? req.ctx.can('actes.valider_direction') : req.ctx.can('actes.valider')),
      rectifier: ['VALIDE', 'REFUSE'].includes(a.statut) && (a.validation_par === 'SECRETAIRE_GENERAL' ? req.ctx.can('actes.enregistrer_direction') : req.ctx.can('actes.preparer')),
    },
  });
});

// ─── Préparation ────────────────────────────────────────────────────────────
router.post('/', validate({ body: acteSchema }), async (req, res) => {
  const a = await actes.creer(req.ctx, req.valid.body);
  await addHistory('ACTE', a.id, req.ctx.userId, { action: 'PREPARATION', nouveau: 'BROUILLON' });
  await audit(req, { action: 'CREATION', module: 'actes', entite: 'acte', entiteId: a.id, apres: a, message: `${a.numero} — ${actes.TYPES[a.type]}` });
  res.status(201).json(actes.vue(a));
});

router.put('/:id', validate({ params: idParam, body: acteSchema.partial() }), async (req, res) => {
  const avant = await db('actes_administratifs').where({ id: req.valid.params.id }).first();
  const a = await actes.modifier(req.ctx, req.valid.params.id, req.valid.body);
  await audit(req, { action: 'MODIFICATION', module: 'actes', entite: 'acte', entiteId: a.id, avant, apres: a });
  res.json(actes.vue(a));
});

router.delete('/:id', validate({ params: idParam }), async (req, res) => {
  const a = await actes.supprimer(req.ctx, req.valid.params.id);
  await audit(req, { action: 'SUPPRESSION', module: 'actes', entite: 'acte', entiteId: a.id, avant: a, message: `Brouillon ${a.numero} supprimé` });
  res.json({ message: 'Brouillon supprimé.' });
});

router.post('/:id/soumettre', validate({ params: idParam }), async (req, res) => {
  const a = await actes.soumettre(req.ctx, req.valid.params.id);
  await addHistory('ACTE', a.id, req.ctx.userId, { action: 'SOUMISSION', ancien: 'BROUILLON', nouveau: 'SOUMIS' });
  await audit(req, { action: 'TRANSMISSION', module: 'actes', entite: 'acte', entiteId: a.id, message: `${a.numero} soumis à validation` });
  res.json(actes.vue(a));
});

router.post('/:id/rectifier', validate({ params: idParam }), async (req, res) => {
  const a = await actes.rectifier(req.ctx, req.valid.params.id);
  await addHistory('ACTE', a.id, req.ctx.userId, { action: a.rectifie_acte_id ? 'RECTIFICATIF' : 'REPRISE', nouveau: 'BROUILLON', commentaire: `D’après l’acte n° ${req.valid.params.id}` });
  await audit(req, { action: 'CREATION', module: 'actes', entite: 'acte', entiteId: a.id, apres: a, message: `${a.numero} : ${a.rectifie_acte_id ? 'rectificatif' : 'reprise'} de l’acte ${req.valid.params.id}` });
  res.status(201).json(actes.vue(a));
});

// ─── Décision ───────────────────────────────────────────────────────────────
router.post('/:id/decision', validate({ params: idParam, body: z.object({ decision: z.enum(['VALIDE', 'REFUSE']), commentaire: z.string().trim().max(2000).optional() }) }), async (req, res) => {
  const a = await actes.decider(req.ctx, req.valid.params.id, req.valid.body);
  await addHistory('ACTE', a.id, req.ctx.userId, { action: req.valid.body.decision === 'VALIDE' ? 'VALIDATION' : 'REFUS', ancien: 'SOUMIS', nouveau: a.statut, commentaire: req.valid.body.commentaire || null });
  await audit(req, { action: req.valid.body.decision === 'VALIDE' ? 'VALIDATION' : 'REJET', module: 'actes', entite: 'acte', entiteId: a.id, apres: { statut: a.statut, type: a.type, agent_id: a.agent_id, poste_id: a.poste_id, permissions: a.permissions, date_debut: a.date_debut, date_fin: a.date_fin }, message: `${a.numero} — ${a.reference}` });
  res.json(a);
});

router.post('/:id/revoquer', validate({ params: idParam, body: z.object({ motif: z.string().trim().min(5, 'motif requis').max(1000) }) }), async (req, res) => {
  const a = await actes.revoquer(req.ctx, req.valid.params.id, req.valid.body.motif);
  await addHistory('ACTE', a.id, req.ctx.userId, { action: 'REVOCATION', ancien: 'VALIDE', nouveau: 'REVOQUE', commentaire: req.valid.body.motif });
  await audit(req, { action: 'REVOCATION', module: 'actes', entite: 'acte', entiteId: a.id, message: `${a.numero} révoqué : ${req.valid.body.motif}` });
  res.json(actes.vue(a));
});

module.exports = router;

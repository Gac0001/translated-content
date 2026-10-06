'use strict';
/**
 * Supervision (Admin Système) : centre de santé du système, journal technique des erreurs,
 * rapports mensuels de sécurité (consultables aussi par le Directeur).
 */
const express = require('express');
const { z } = require('zod');
const db = require('../../db/knex');
const validate = require('../../middleware/validate');
const { requirePerm } = require('../../middleware/auth');
const { audit } = require('../../services/audit');
const sante = require('../../services/sante');
const rapports = require('../../services/rapportSecurite');
const { notFound, badRequest } = require('../../utils/errors');

const router = express.Router();
const idParam = z.object({ id: z.coerce.number().int().positive() });

// ─── Santé du système ────────────────────────────────────────────────────────
router.get('/sante', requirePerm('systeme.consulter'), async (req, res) => {
  const historique = await db('sante_controles').where('created_at', '>', db.raw(`now() - interval '48 hours'`)).orderBy('id', 'desc').limit(200)
    .select('id', 'global', 'created_at', 'origine', 'composants');
  res.json({
    dernier: await sante.dernierControle(), version: sante.versionApplication(),
    historique: historique.map((h) => ({ id: h.id, global: h.global, date: h.created_at, origine: h.origine, statuts: Object.fromEntries(Object.entries(h.composants).map(([k, c]) => [k, c.statut])) })),
    libelles: sante.LIBELLES,
  });
});

router.post('/sante/verifier', requirePerm('systeme.consulter'), async (req, res) => {
  const r = await sante.controler('MANUEL');
  await audit(req, { action: 'CONTROLE_SANTE', module: 'systeme', resultat: r.global === 'PANNE' ? 'ECHEC' : 'SUCCES', message: `Contrôle de santé : ${r.global}` });
  res.json(r);
});

// ─── Journal technique ──────────────────────────────────────────────────────
router.get('/erreurs', requirePerm('systeme.consulter'), validate({ query: z.object({ statut: z.enum(['ouvertes', 'resolues', 'toutes']).default('ouvertes') }) }), async (req, res) => {
  const q = db('erreurs_techniques as e').leftJoin('users as u', 'u.id', 'e.resolue_par')
    .select('e.id', 'e.methode', 'e.route', 'e.code', 'e.message', 'e.occurrences', 'e.premiere_at', 'e.derniere_at', 'e.derniere_username', 'e.derniere_ip', 'e.resolue_at', 'e.commentaire', 'u.username as resolue_par_username')
    .orderBy('e.derniere_at', 'desc').limit(500);
  if (req.valid.query.statut === 'ouvertes') q.whereNull('e.resolue_at');
  if (req.valid.query.statut === 'resolues') q.whereNotNull('e.resolue_at');
  const [ouvertes, dernieres24h] = await Promise.all([
    db('erreurs_techniques').whereNull('resolue_at').count('* as n').first(),
    db('erreurs_techniques').where('derniere_at', '>', db.raw(`now() - interval '24 hours'`)).sum('occurrences as n').first(),
  ]);
  res.json({ data: await q, resume: { ouvertes: Number(ouvertes.n), occurrences24h: Number(dernieres24h.n || 0) } });
});

router.get('/erreurs/:id', requirePerm('systeme.consulter'), validate({ params: idParam }), async (req, res) => {
  const e = await db('erreurs_techniques').where({ id: req.valid.params.id }).first();
  if (!e) throw notFound('Erreur introuvable.');
  res.json(e);
});

router.post('/erreurs/:id/resoudre', requirePerm('systeme.maintenir'), validate({ params: idParam, body: z.object({ commentaire: z.string().trim().max(1000).optional() }) }), async (req, res) => {
  const e = await db('erreurs_techniques').where({ id: req.valid.params.id }).first();
  if (!e) throw notFound('Erreur introuvable.');
  if (e.resolue_at) throw badRequest('Erreur déjà marquée comme résolue.');
  await db('erreurs_techniques').where({ id: e.id }).update({ resolue_at: db.fn.now(), resolue_par: req.ctx.userId, commentaire: req.valid.body.commentaire || null });
  await audit(req, { action: 'RESOLUTION_ERREUR', module: 'systeme', entite: 'erreur', entiteId: e.id, message: `${e.methode} ${e.route} — ${e.message.slice(0, 120)}` });
  res.json({ message: 'Erreur marquée comme résolue. Une nouvelle occurrence ouvrira un nouveau groupe.' });
});

// ─── Rapports mensuels de sécurité (Admin Système et Directeur) ─────────────
const periodeParam = z.object({ periode: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'période AAAA-MM attendue') });

router.get('/rapports', requirePerm('rapport_securite.consulter'), async (req, res) => {
  const rows = await db('rapports_securite').orderBy('periode', 'desc').limit(36);
  res.json({
    data: rows.map((r) => ({
      periode: r.periode, libelle: r.donnees.libelle, genere_at: r.genere_at, genere_par: r.genere_par_username,
      resume: { critiques: r.donnees.incidents.critiques, echecs: r.donnees.connexions.echecs, reussies: r.donnees.connexions.reussies, integre: r.donnees.integriteAudit.integre, sauvegardesEchouees: r.donnees.sauvegardes.echecs },
    })),
    moisPrecedent: rapports.moisPrecedent(),
    peutGenerer: req.ctx.can('securite.superviser'),
  });
});

router.post('/rapports', requirePerm('securite.superviser'), validate({ body: periodeParam }), async (req, res) => {
  const { periode } = req.valid.body;
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Africa/Kinshasa' }));
  const courant = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  if (periode > courant) throw badRequest('Impossible de produire le rapport d’un mois futur.');
  const d = await rapports.generer(periode, req);
  res.status(201).json({ message: `Rapport de ${d.libelle} généré${periode === courant ? ' (mois en cours : données partielles)' : ''}.`, donnees: d });
});

router.get('/rapports/:periode', requirePerm('rapport_securite.consulter'), validate({ params: periodeParam }), async (req, res) => {
  const r = await db('rapports_securite').where({ periode: req.valid.params.periode }).first();
  if (!r) throw notFound('Rapport introuvable.');
  res.json(r);
});

router.get('/rapports/:periode/pdf', requirePerm('rapport_securite.consulter'), validate({ params: periodeParam }), async (req, res) => {
  const r = await db('rapports_securite').where({ periode: req.valid.params.periode }).first();
  if (!r) throw notFound('Rapport introuvable.');
  await audit(req, { action: 'EXPORT', module: 'securite', entite: 'rapport', entiteId: r.periode, message: `Téléchargement du rapport de sécurité ${r.periode}` });
  return rapports.ecrirePdf(res, r);
});

module.exports = router;

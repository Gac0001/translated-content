'use strict';
/**
 * Identité du Ministère (cahier des charges, section 7) : en-tête et pied de page de tous les documents.
 * Consultation par l’Admin Système et le Directeur ; nouvelle version proposée par l’Admin et confirmée
 * par le Directeur (opération critique « IDENTITE ») ; versions datées en ajout seul.
 */
const express = require('express');
const crypto = require('crypto');
const { z } = require('zod');
const db = require('../../db/knex');
const validate = require('../../middleware/validate');
const { requirePerm } = require('../../middleware/auth');
const { audit } = require('../../services/audit');
const identite = require('../../services/identite');
const gouvernance = require('../../services/gouvernance');
const { notify } = require('../../services/notifications');
const { badRequest, forbidden, notFound } = require('../../utils/errors');

const router = express.Router();
const lecture = (req, res, next) => (req.ctx.can('systeme.configurer') || req.ctx.can('operations.confirmer') ? next() : next(forbidden()));

router.get('/', lecture, async (req, res) => {
  const versions = await identite.versions();
  res.json({ courante: identite.sansSceau(identite.courante()), versions: versions.map(identite.sansSceau).reverse() });
});

router.get('/:version/sceau', lecture, validate({ params: z.object({ version: z.coerce.number().int().positive() }) }), async (req, res) => {
  const v = (await identite.versions()).find((x) => x.version === req.valid.params.version);
  if (!v || !v.sceau) throw notFound('Aucun sceau pour cette version.');
  res.setHeader('Content-Type', v.sceau_type || 'image/png');
  res.setHeader('Cache-Control', 'private, max-age=3600');
  res.send(v.sceau);
});

/** Aperçu de l’en-tête et du pied de page (PDF de deux pages), variante Direction ou Secrétaire Général. */
router.get('/apercu.pdf', lecture, validate({ query: z.object({ variante: z.enum(['DEP', 'SG']).default('DEP') }) }), async (req, res) => {
  const pdf = require('../../services/pdf');
  const { doc, finish } = pdf.createPdf(res, { filename: `apercu-entete-${req.valid.query.variante}.pdf`, titre: 'APERÇU DE L’EN-TÊTE ET DU PIED DE PAGE', sousTitre: `Variante ${req.valid.query.variante === 'SG' ? 'du Secrétaire Général' : 'de la Direction'} — version ${identite.courante().version}`, reference: 'APERÇU', variante: req.valid.query.variante });
  pdf.section(doc, 'Première page', 'L’en-tête officiel figure en haut de la première page de chaque document ; le pied de page officiel figure sur chaque page.');
  doc.addPage();
  pdf.section(doc, 'Pages suivantes', 'Les pages suivantes portent un rappel discret (Direction et référence du document) et le pied de page officiel, avec le numéro de page.');
  finish();
});

const schema = z.object({
  date_application: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date au format AAAA-MM-JJ.'),
  ministere: z.string().trim().min(3).max(200),
  sigle: z.string().trim().min(2).max(30),
  secretariat_general: z.string().trim().min(3).max(200),
  direction: z.string().trim().min(3).max(200),
  secretaire_general_titre: z.string().trim().min(3).max(200),
  adresse: z.string().trim().min(5).max(300),
  courriel: z.string().trim().email().max(150),
  site_web: z.string().trim().min(4).max(150),
  qr_contenu: z.string().trim().min(4).max(500),
  format_reference: z.string().trim().max(200).refine((f) => f.includes('{seq}') && f.includes('{annee}'), 'Le format doit contenir {seq} et {annee}.'),
  format_reference_sg: z.string().trim().max(200).refine((f) => f.includes('{seq}') && f.includes('{annee}'), 'Le format doit contenir {seq} et {annee}.'),
  sceau_base64: z.string().max(2_000_000).optional().nullable(), // nouveau sceau ; absent : celui de la version précédente
  motif: z.string().trim().min(10, 'Motif de 10 caractères au moins (acte ou décision).').max(1000),
});

router.post('/', requirePerm('systeme.configurer'), validate({ body: schema }), async (req, res) => {
  const b = req.valid.body;
  const derniere = (await identite.versions()).slice(-1)[0];
  let sceau = derniere?.sceau || null; let sceauType = derniere?.sceau_type || null;
  if (b.sceau_base64) {
    sceau = Buffer.from(b.sceau_base64.replace(/^data:[^,]+,/, ''), 'base64');
    if (sceau.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) sceauType = 'image/png';
    else if (sceau[0] === 0xff && sceau[1] === 0xd8) sceauType = 'image/jpeg';
    else throw badRequest('Le sceau doit être une image PNG ou JPEG.');
    if (sceau.length > 1_500_000) throw badRequest('Image du sceau trop lourde (1,5 Mo au plus).');
  }
  const { sceau_base64: _s, ...champs } = b;
  const parametres = { ...champs, sceau: sceau ? crypto.createHash('sha256').update(sceau).digest('hex').slice(0, 16) : null };
  // Opération critique : autorisation préalable du Directeur (cahier des charges, section 17, étape 4)
  const conf = await gouvernance.exigerConfirmation(req, 'IDENTITE', parametres,
    `Nouvelle identité du Ministère applicable le ${b.date_application} : ${b.ministere} (${b.sigle})${b.sceau_base64 ? ', nouveau sceau' : ''} — ${b.motif}`);
  if (conf.reponse) return res.status(202).json(conf.reponse);
  await gouvernance.consommer(conf.demande);
  const [v] = await db('identite_versions').insert({
    ...champs, version: (derniere?.version || 0) + 1, sceau, sceau_type: sceauType,
    created_by: req.ctx.userId, created_by_nom: req.ctx.username,
  }).returning('*');
  identite.invalider();
  await identite.pret();
  await audit(req, { action: 'IDENTITE_MINISTERE', module: 'systeme', entite: 'identite_version', entiteId: v.id, apres: { version: v.version, date_application: b.date_application, sigle: b.sigle }, message: b.motif });
  const directeurs = await db('users as u').join('user_roles as ur', 'ur.user_id', 'u.id').join('roles as r', 'r.id', 'ur.role_id').where({ 'r.code': 'DIRECTEUR', 'u.statut': 'ACTIF' }).pluck('u.id');
  await notify(directeurs, { type: 'SECURITE', titre: `Identité du Ministère : version ${v.version} enregistrée`, message: `Applicable le ${b.date_application}. ${b.motif}`, lien: '/systeme/identite' });
  res.status(201).json(identite.sansSceau(v));
});

module.exports = router;

'use strict';
/**
 * Cartes de service : registre, préparation, validation, impression, remise et suivi ;
 * modèle graphique (Admin Système) ; spécimen de signature (Directeur).
 */
const fs = require('fs');
const express = require('express');
const bcrypt = require('bcrypt');
const { z } = require('zod');
const db = require('../../db/knex');
const validate = require('../../middleware/validate');
const { requirePerm } = require('../../middleware/auth');
const { audit } = require('../../services/audit');
const cartes = require('../../services/cartes');
const { pdfCartes, pdfPlanche, urlVerification } = require('../../services/cartePdf');
const { directeursActifs } = require('../../services/alertes');
const { makeUpload, sha256File, safePath, removeQuiet } = require('../../services/files');
const { badRequest, notFound } = require('../../utils/errors');

const router = express.Router();
const idParam = z.object({ id: z.coerce.number().int().positive() });
const imageUpload = makeUpload({ imagesOnly: true });
const PNG_JPEG = ['image/png', 'image/jpeg'];

async function envoyerImage(res, nom) {
  const p = nom && safePath(nom);
  if (!p || !fs.existsSync(p)) throw notFound('Image absente.');
  res.setHeader('Content-Type', /\.png$/i.test(nom) ? 'image/png' : 'image/jpeg');
  res.setHeader('Cache-Control', 'private, no-store');
  fs.createReadStream(p).pipe(res);
}

/** Spécimens et modèles nécessaires au rendu d’une liste de cartes. */
async function contexteRendu(liste) {
  const modeles = Object.fromEntries((await db('modeles_carte').whereIn('id', [...new Set(liste.map((c) => c.modele_id))])).map((m) => [m.id, m]));
  const specimens = {};
  for (const c of liste) {
    let s = c.specimen_id ? await db('specimens_signature').where({ id: c.specimen_id }).first() : null;
    // Carte validée avant le dépôt du spécimen : spécimen actuel du Directeur qui l’a validée.
    if (!s && c.valide_par) s = await db('specimens_signature').where({ user_id: c.valide_par, actif: true }).first();
    // Aperçu d’une carte non validée : spécimen du Directeur en exercice.
    if (!s && !c.numero) s = await db('specimens_signature').whereIn('user_id', await directeursActifs()).where({ actif: true }).first();
    if (s && c.numero && !c.specimen_id) await db('cartes_service').where({ id: c.id }).update({ specimen_id: s.id });
    specimens[c.id] = s || null;
  }
  return { modeles, specimens };
}

// ─── Modèle de carte (Admin Système) ────────────────────────────────────────
router.get('/modele', requirePerm('modele_carte.configurer', 'cartes.consulter'), async (req, res) => {
  const versions = await db('modeles_carte as m').leftJoin('users as u', 'u.id', 'm.created_by').select('m.*', 'u.username as auteur').orderBy('m.version', 'desc');
  res.json({ actif: versions.find((m) => m.actif) || null, versions });
});

const modeleSchema = z.object({
  intitule: z.array(z.string().trim().min(2).max(60)).min(1).max(4),
  adresse: z.string().trim().max(300).optional().nullable(),
  site_web: z.string().trim().max(120).optional().nullable(),
  couleur_bandeau: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  couleur_accent: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  titre_verso: z.string().trim().min(3).max(60),
  mention_verso: z.string().trim().min(10).max(300),
  validite_annees: z.coerce.number().int().min(1).max(10),
  verification_matricule: z.boolean(),
  note: z.string().trim().max(500).optional().nullable(),
});

/** Chaque modification crée une nouvelle version ; les cartes déjà validées gardent leur version. */
async function nouvelleVersion(req, changements) {
  const actif = await cartes.modeleActif();
  return db.transaction(async (trx) => {
    const version = Number((await trx('modeles_carte').max('version as v').first()).v || 0) + 1;
    await trx('modeles_carte').where({ actif: true }).update({ actif: false });
    const { id, created_at: c, created_by: cb, version: v, ...base } = actif || {};
    const [m] = await trx('modeles_carte').insert({
      ...base, ...changements, note: changements.note || null, intitule: JSON.stringify(changements.intitule || base.intitule), version, actif: true, created_by: req.ctx.userId,
    }).returning('*');
    return m;
  });
}

router.put('/modele', requirePerm('modele_carte.configurer'), validate({ body: modeleSchema }), async (req, res) => {
  const m = await nouvelleVersion(req, req.valid.body);
  await audit(req, { action: 'MODIFICATION', module: 'cartes', entite: 'modele_carte', entiteId: m.id, apres: m, message: `Modèle de carte, version ${m.version}` });
  res.json(m);
});

router.post('/modele/armoirie', requirePerm('modele_carte.configurer'), imageUpload.single('armoirie'), async (req, res) => {
  if (!req.file) throw badRequest('Aucune image transmise.');
  if (!PNG_JPEG.includes(req.file.mimetype)) { removeQuiet(req.file.filename); throw badRequest('L’armoirie doit être une image PNG ou JPEG.'); }
  const m = await nouvelleVersion(req, { armoirie_path: req.file.filename, note: 'Dépôt du Bloc-armoirie' });
  await audit(req, { action: 'MODIFICATION', module: 'cartes', entite: 'modele_carte', entiteId: m.id, message: `Bloc-armoirie du modèle de carte (version ${m.version})` });
  res.json(m);
});

router.get('/modele/armoirie', async (req, res) => {
  const m = await cartes.modeleActif();
  await envoyerImage(res, m && m.armoirie_path);
});

// ─── Spécimen de signature (Directeur) ──────────────────────────────────────
router.get('/specimen', requirePerm('cartes.valider'), async (req, res) => {
  res.json({ specimen: await db('specimens_signature').where({ user_id: req.ctx.userId, actif: true }).first() || null });
});

router.get('/specimen/image', requirePerm('cartes.valider'), async (req, res) => {
  const s = await db('specimens_signature').where({ user_id: req.ctx.userId, actif: true }).first();
  await envoyerImage(res, s && s.fichier);
});

router.post('/specimen', requirePerm('cartes.valider'), imageUpload.single('signature'), async (req, res) => {
  const supprimer = () => req.file && removeQuiet(req.file.filename);
  if (!req.file) throw badRequest('Aucune image transmise.');
  if (!PNG_JPEG.includes(req.file.mimetype)) { supprimer(); throw badRequest('Le spécimen doit être une image PNG (fond transparent de préférence) ou JPEG.'); }
  const b = z.object({ motDePasse: z.string().min(1), signataire: z.string().trim().min(3).max(150), qualite: z.string().trim().min(3).max(100).default('Le Directeur') }).safeParse(req.body);
  if (!b.success) { supprimer(); throw badRequest('Mot de passe, nom du signataire et qualité requis.'); }
  const u = await db('users').where({ id: req.ctx.userId }).first();
  if (!(await bcrypt.compare(b.data.motDePasse, u.password_hash))) { supprimer(); throw badRequest('Mot de passe incorrect.'); }
  const s = await db.transaction(async (trx) => {
    await trx('specimens_signature').where({ user_id: u.id, actif: true }).update({ actif: false, retire_at: trx.fn.now() });
    const [row] = await trx('specimens_signature').insert({ user_id: u.id, signataire: b.data.signataire, qualite: b.data.qualite, fichier: req.file.filename, sha256: await sha256File(req.file.path) }).returning('*');
    return row;
  });
  await audit(req, { action: 'CREATION', module: 'cartes', entite: 'specimen_signature', entiteId: s.id, message: `Spécimen de signature de ${s.signataire}` });
  res.status(201).json({ specimen: s });
});

router.delete('/specimen', requirePerm('cartes.valider'), async (req, res) => {
  await db('specimens_signature').where({ user_id: req.ctx.userId, actif: true }).update({ actif: false, retire_at: db.fn.now() });
  await audit(req, { action: 'SUPPRESSION', module: 'cartes', entite: 'specimen_signature', message: 'Spécimen de signature retiré' });
  res.json({ message: 'Spécimen retiré : les cartes déjà imprimées ne sont pas modifiées.' });
});

// ─── Carte de l’agent connecté ──────────────────────────────────────────────
router.get('/mienne', async (req, res) => {
  const rows = req.ctx.agentId ? await cartes.baseQuery().where('c.agent_id', req.ctx.agentId).whereNotNull('c.numero').orderBy('c.valide_at', 'desc') : [];
  res.json({ data: rows.map(cartes.vue) });
});

router.post('/mienne/accuser', async (req, res) => {
  const c = await cartes.accuserReception(req.ctx);
  await audit(req, { action: 'ACCUSE_RECEPTION', module: 'cartes', entite: 'carte', entiteId: c.id, message: `Réception de la carte ${c.numero}` });
  res.json({ message: 'Réception de votre carte de service confirmée.' });
});

// ─── Registre ───────────────────────────────────────────────────────────────
router.get('/', requirePerm('cartes.consulter'), validate({ query: z.object({ statut: z.string().max(20).optional() }) }), async (req, res) => {
  await cartes.expirer();
  const q = cartes.baseQuery().orderBy('c.updated_at', 'desc').limit(1000);
  if (req.valid.query.statut) q.where('c.statut', req.valid.query.statut);
  const rows = (await q).map(cartes.vue);
  const parStatut = (await db('cartes_service').select('statut').count('* as n').groupBy('statut')).reduce((o, r) => ({ ...o, [r.statut]: Number(r.n) }), {});
  res.json({ data: rows, parStatut });
});

/** Agents de la DEP et situation de leur carte (pour la préparation). */
router.get('/agents', requirePerm('cartes.preparer'), async (req, res) => {
  const agents = await db('agents as ag')
    .join('affectations as af', function j() { this.on('af.agent_id', 'ag.id').andOn('af.est_active', db.raw('true')); })
    .leftJoin('bureaux as b', 'b.id', 'af.bureau_id').leftJoin('divisions as d', 'd.id', 'af.division_id')
    .whereNull('ag.archived_at').where('ag.est_autorite', false)
    .select('ag.id', 'ag.matricule', 'ag.nom', 'ag.postnom', 'ag.prenom', 'ag.statut', db.raw('ag.photo_path IS NOT NULL as photo'),
      db.raw(`COALESCE(b.nom, d.nom, 'Direction') as structure`))
    .orderBy('ag.nom');
  const situations = await db('cartes_service').whereIn('statut', [...cartes.EN_PREPARATION, ...cartes.EN_CIRCULATION]).select('id', 'agent_id', 'statut', 'numero', 'date_expiration');
  res.json({ data: agents.map((a) => ({ ...a, cartes: situations.filter((c) => c.agent_id === a.id) })) });
});

router.get('/verifications', requirePerm('cartes.consulter'), async (req, res) => {
  const rows = await db('verifications_carte as v').leftJoin('cartes_service as c', 'c.id', 'v.carte_id')
    .where('v.created_at', '>', db.raw(`now() - interval '30 days'`)).orderBy('v.id', 'desc').limit(500)
    .select('v.id', 'v.mode', 'v.resultat', 'v.ip', 'v.created_at', 'c.numero');
  res.json({ data: rows });
});

router.post('/', requirePerm('cartes.preparer'), validate({ body: z.object({
  agent_id: z.coerce.number().int().positive(), motif_emission: z.enum(['PREMIERE', 'RENOUVELLEMENT', 'REMPLACEMENT']).default('PREMIERE'),
}) }), async (req, res) => {
  const c = await cartes.preparer(req.ctx, req.valid.body);
  await audit(req, { action: 'CREATION', module: 'cartes', entite: 'carte', entiteId: c.id, apres: { agent_id: c.agent_id, motif: c.motif_emission } });
  res.status(201).json(c);
});

router.get('/:id', validate({ params: idParam }), async (req, res) => {
  const c = await cartes.actualiser(await cartes.charger(req.ctx, req.valid.params.id));
  const dossier = await cartes.dossierAgent(c.agent_id);
  const detail = cartes.vue(await cartes.charger(req.ctx, c.id));
  res.json({
    ...detail,
    dossier: dossier.donnees,
    anomalies: cartes.EN_PREPARATION.includes(c.statut) ? cartes.anomalies(dossier) : [],
    urlVerification: detail.jeton && req.ctx.can('cartes.consulter') ? urlVerification(detail.jeton) : null,
    jeton: undefined,
    historiqueAgent: await db('cartes_service').where({ agent_id: c.agent_id }).whereNot('id', c.id).whereNotNull('numero').select('id', 'numero', 'statut', 'date_delivrance', 'date_expiration').orderBy('valide_at', 'desc'),
  });
});

const action = (nom, perm, fn, libelle) => router.post(`/:id/${nom}`, requirePerm(...[].concat(perm)), validate({ params: idParam, body: z.object({ motif: z.string().trim().max(300).optional(), commentaire: z.string().trim().max(1000).optional() }) }), async (req, res) => {
  const c = await fn(req);
  await audit(req, { action: libelle, module: 'cartes', entite: 'carte', entiteId: c.id, message: `${c.numero || `carte n° ${c.id}`} — ${c.statut}${req.valid.body.motif ? ` — ${req.valid.body.motif}` : ''}${req.valid.body.commentaire ? ` — ${req.valid.body.commentaire}` : ''}` });
  res.json(cartes.vue(c));
});
action('verifier', 'cartes.preparer', (req) => cartes.verifier(req.ctx, req.valid.params.id), 'VERIFICATION');
action('retourner', 'cartes.valider', (req) => {
  if (!req.valid.body.commentaire || req.valid.body.commentaire.length < 5) throw badRequest('Indiquez la correction attendue.');
  return cartes.retourner(req.ctx, req.valid.params.id, req.valid.body.commentaire);
}, 'RETOUR_CORRECTION');
action('valider', 'cartes.valider', (req) => cartes.valider(req.ctx, req.valid.params.id), 'VALIDATION');
action('remettre', 'cartes.preparer', (req) => cartes.remettre(req.ctx, req.valid.params.id), 'REMISE');
action('suspendre', 'cartes.valider', (req) => cartes.changerStatut(req.ctx, req.valid.params.id, 'suspendre', req.valid.body.motif), 'SUSPENSION');
action('reactiver', 'cartes.valider', (req) => cartes.changerStatut(req.ctx, req.valid.params.id, 'reactiver'), 'REACTIVATION');
action('annuler', 'cartes.valider', (req) => cartes.changerStatut(req.ctx, req.valid.params.id, 'annuler', req.valid.body.motif), 'ANNULATION');
// Déclaration de perte : Secrétariat ou titulaire lui-même (contrôlé dans le service).
router.post('/:id/perdue', validate({ params: idParam, body: z.object({ motif: z.string().trim().max(300).optional() }) }), async (req, res) => {
  const c = await cartes.changerStatut(req.ctx, req.valid.params.id, 'perdue', req.valid.body.motif);
  await audit(req, { action: 'DECLARATION_PERTE', module: 'cartes', entite: 'carte', entiteId: c.id, message: `${c.numero} — ${req.valid.body.motif}` });
  res.json(cartes.vue(c));
});

// ─── Rendu PDF ──────────────────────────────────────────────────────────────
/** Aperçu recto-verso (spécimen non valide tant que la carte n’est pas validée). */
router.get('/:id/apercu', validate({ params: idParam }), async (req, res) => {
  const c = await cartes.charger(req.ctx, req.valid.params.id);
  let rendu = c;
  if (!c.numero) {
    const dossier = await cartes.dossierAgent(c.agent_id);
    const photo = dossier.agent.photo_path && /\.(png|jpe?g)$/i.test(dossier.agent.photo_path) ? dossier.agent.photo_path : null;
    rendu = { ...c, donnees: dossier.donnees, photo, date_delivrance: null, date_expiration: null };
  }
  await pdfCartes(res, [rendu], { ...(await contexteRendu([rendu])), filename: `apercu-carte-${c.id}.pdf` });
});

router.get('/:id/pdf', requirePerm('cartes.preparer'), validate({ params: idParam }), async (req, res) => {
  const [c] = await cartes.marquerImpression(req.ctx, [req.valid.params.id]);
  await audit(req, { action: 'IMPRESSION', module: 'cartes', entite: 'carte', entiteId: c.id, message: `${c.numero} (impression n° ${c.nb_impressions})` });
  await pdfCartes(res, [c], { ...(await contexteRendu([c])), filename: `carte-${c.numero.replace(/\//g, '-')}.pdf` });
});

router.post('/planche', requirePerm('cartes.preparer'), validate({ body: z.object({ ids: z.array(z.coerce.number().int().positive()).min(1).max(100) }) }), async (req, res) => {
  const liste = await cartes.marquerImpression(req.ctx, [...new Set(req.valid.body.ids)]);
  await audit(req, { action: 'IMPRESSION', module: 'cartes', entite: 'carte', message: `Planche de ${liste.length} carte(s) : ${liste.map((c) => c.numero).join(', ')}` });
  await pdfPlanche(res, liste, { ...(await contexteRendu(liste)), filename: 'planche-cartes-de-service.pdf' });
});

module.exports = router;

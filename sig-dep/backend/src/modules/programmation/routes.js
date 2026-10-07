'use strict';
/**
 * Programmation et performance : cadre de performance (objectifs, indicateurs, réalisations et
 * cibles), crédits par programme, action, rubrique et titre, documents de programmation (PAP,
 * RAP, CDMT) avec leur circuit, banque des projets, jalons et registre des risques.
 *
 * Saisie : Bureau Programme et Division Programme et Suivi (référentiel, cibles, crédits,
 * documents) ; Bureau Suivi-Évaluation (réalisations, jalons, risques). Validation : Directeur.
 */
const express = require('express');
const { z } = require('zod');
const db = require('../../db/knex');
const validate = require('../../middleware/validate');
const { requirePerm } = require('../../middleware/auth');
const { audit } = require('../../services/audit');
const { notify } = require('../../services/notifications');
const { addHistory, getHistory } = require('../../services/history');
const { nextReference } = require('../../services/sequence');
const { directeursActifs } = require('../../services/alertes');
const { loadAllNodes } = require('../../services/hierarchy');
const prog = require('../../services/programmation');
const { badRequest, forbidden, notFound, conflict } = require('../../utils/errors');

const router = express.Router();
const idParam = z.object({ id: z.coerce.number().int().positive() });
const annee = z.coerce.number().int().min(2000).max(2100);

const peutSaisir = (ctx) => ctx.can('planification.referentiel');
const peutSuivre = (ctx) => ctx.can('planification.referentiel') || ctx.can('ptba.suivre');
function exiger(ok, message) { if (!ok) throw forbidden(message || 'Saisie réservée au Bureau Programme, à la Division Programme et Suivi et au Directeur.'); }

// ─── Cadre de performance ───────────────────────────────────────────────────
router.get('/cadre', requirePerm('planification.consulter'), validate({ query: z.object({ annee }) }), async (req, res) => {
  const A = req.valid.query.annee;
  res.json({ annee: A, ...(await prog.cadre([A - 4, A - 3, A - 2, A - 1, A, A + 1, A + 2])), droits: { saisir: peutSaisir(req.ctx), suivre: peutSuivre(req.ctx) } });
});

const objectifSchema = z.object({ programme_id: z.coerce.number().int().positive().nullable().optional(), libelle: z.string().trim().min(3).max(2000), ordre: z.coerce.number().int().min(0).default(0), actif: z.boolean().default(true) });
router.post('/objectifs', requirePerm('planification.consulter'), validate({ body: objectifSchema }), async (req, res) => {
  exiger(peutSaisir(req.ctx));
  const [o] = await db('plan_objectifs').insert({ ...req.valid.body, programme_id: req.valid.body.programme_id || null }).returning('*');
  await audit(req, { action: 'CREATION', module: 'planification', entite: 'objectif', entiteId: o.id, apres: o });
  res.status(201).json(o);
});
router.put('/objectifs/:id', requirePerm('planification.consulter'), validate({ params: idParam, body: objectifSchema }), async (req, res) => {
  exiger(peutSaisir(req.ctx));
  const [o] = await db('plan_objectifs').where({ id: req.valid.params.id }).update({ ...req.valid.body, programme_id: req.valid.body.programme_id || null, updated_at: db.fn.now() }).returning('*');
  if (!o) throw notFound();
  await audit(req, { action: 'MODIFICATION', module: 'planification', entite: 'objectif', entiteId: o.id, apres: o });
  res.json(o);
});

const indicateurSchema = z.object({
  objectif_id: z.coerce.number().int().positive(), libelle: z.string().trim().min(3).max(2000), unite: z.string().trim().min(1).max(40),
  mode_calcul: z.string().trim().max(2000).optional().nullable(), source: z.string().trim().max(200).optional().nullable(),
  commentaire: z.string().trim().max(5000).optional().nullable(), sens: z.enum(['HAUSSE', 'BAISSE']).default('HAUSSE'),
  ordre: z.coerce.number().int().min(0).default(0), actif: z.boolean().default(true),
});
router.post('/indicateurs', requirePerm('planification.consulter'), validate({ body: indicateurSchema }), async (req, res) => {
  exiger(peutSaisir(req.ctx));
  if (!(await db('plan_objectifs').where({ id: req.valid.body.objectif_id }).first())) throw badRequest('Objectif inconnu.');
  const [i] = await db('plan_indicateurs').insert(req.valid.body).returning('*');
  await audit(req, { action: 'CREATION', module: 'planification', entite: 'indicateur', entiteId: i.id, apres: i });
  res.status(201).json(i);
});
router.put('/indicateurs/:id', requirePerm('planification.consulter'), validate({ params: idParam, body: indicateurSchema }), async (req, res) => {
  exiger(peutSaisir(req.ctx));
  const [i] = await db('plan_indicateurs').where({ id: req.valid.params.id }).update({ ...req.valid.body, updated_at: db.fn.now() }).returning('*');
  if (!i) throw notFound();
  await audit(req, { action: 'MODIFICATION', module: 'planification', entite: 'indicateur', entiteId: i.id, apres: i });
  res.json(i);
});

/** Valeur d’un indicateur : cible (programmation) ou réalisation (suivi-évaluation). null efface. */
router.put('/indicateurs/:id/valeurs', requirePerm('planification.consulter'), validate({ params: idParam, body: z.object({
  annee, type: z.enum(['REALISATION', 'REALISATION_S1', 'CIBLE']), valeur: z.coerce.number().min(-1e12).max(1e12).nullable(), commentaire: z.string().trim().max(2000).optional().nullable(),
}) }), async (req, res) => {
  const b = req.valid.body;
  exiger(b.type === 'CIBLE' ? peutSaisir(req.ctx) : peutSuivre(req.ctx), b.type === 'CIBLE' ? 'Les cibles sont fixées par le Bureau Programme et la Division Programme et Suivi.' : 'Les réalisations sont saisies par le Bureau Suivi-Évaluation.');
  const i = await db('plan_indicateurs').where({ id: req.valid.params.id }).first();
  if (!i) throw notFound('Indicateur introuvable.');
  const cle = { indicateur_id: i.id, annee: b.annee, type: b.type };
  const avant = await db('plan_indicateur_valeurs').where(cle).first();
  let apres = null;
  if (b.valeur === null) await db('plan_indicateur_valeurs').where(cle).del();
  else {
    [apres] = await db('plan_indicateur_valeurs').insert({ ...cle, valeur: b.valeur, commentaire: b.commentaire || null, saisi_par: req.ctx.userId, saisi_at: db.fn.now() })
      .onConflict(['indicateur_id', 'annee', 'type']).merge().returning('*');
  }
  await audit(req, { action: 'MODIFICATION', module: 'planification', entite: 'indicateur_valeur', entiteId: i.id, avant, apres, message: `${b.type} ${b.annee}` });
  res.json(apres || { supprime: true });
});

// ─── Crédits ────────────────────────────────────────────────────────────────
router.get('/credits', requirePerm('planification.consulter'), validate({ query: z.object({ annee }) }), async (req, res) => {
  const A = req.valid.query.annee;
  const { programmes } = await prog.cadre([A]);
  res.json({ annee: A, programmes, ...(await prog.credits([A - 2, A - 1, A, A + 1, A + 2, A + 3])), droits: { saisir: peutSaisir(req.ctx) } });
});

router.put('/credits', requirePerm('planification.consulter'), validate({ body: z.object({
  lignes: z.array(z.object({
    annee, programme_id: z.coerce.number().int().positive(), action_id: z.coerce.number().int().positive().nullable().optional(),
    poste_id: z.coerce.number().int().positive(), type: z.enum(['VOTE', 'EXECUTE', 'EXECUTE_S1', 'PREVISION']), montant: z.coerce.number().min(0).max(1e16).nullable(),
  })).min(1).max(1000),
}) }), async (req, res) => {
  exiger(peutSaisir(req.ctx));
  let n = 0;
  await db.transaction(async (trx) => {
    for (const l of req.valid.body.lignes) {
      if (l.action_id && !(await trx('plan_actions').where({ id: l.action_id, programme_id: l.programme_id }).first())) throw badRequest('Action hors du programme.');
      const cle = (q) => q.where({ annee: l.annee, programme_id: l.programme_id, poste_id: l.poste_id, type: l.type }).where((w) => (l.action_id ? w.where('action_id', l.action_id) : w.whereNull('action_id')));
      await cle(trx('plan_credits')).del();
      if (l.montant !== null) { await trx('plan_credits').insert({ annee: l.annee, programme_id: l.programme_id, action_id: l.action_id || null, poste_id: l.poste_id, type: l.type, montant: l.montant, saisi_par: req.ctx.userId }); n += 1; }
    }
  });
  await audit(req, { action: 'MODIFICATION', module: 'planification', entite: 'credits', message: `${req.valid.body.lignes.length} montant(s) saisi(s), ${n} enregistré(s)` });
  res.json({ enregistres: n });
});

// ─── Documents de programmation : PAP, RAP, CDMT ────────────────────────────
const TYPES = { PAP: 'Projet Annuel de Performance', RAP: 'Rapport Annuel de Performance', CDMT: 'Cadre de Dépenses à Moyen Terme' };

router.get('/documents', requirePerm('planification.consulter'), async (req, res) => {
  const q = db('plan_documents').orderBy('annee', 'desc').orderBy('type');
  if (req.ctx.perimetre === 'SUPERVISION_GLOBALE') q.where('statut', 'VALIDE');
  res.json({ data: await q, droits: { preparer: req.ctx.can('ptba.preparer') } });
});

async function chargerDoc(ctx, id) {
  const d = await db('plan_documents').where({ id }).first();
  if (!d) throw notFound('Document introuvable.');
  if (ctx.perimetre === 'SUPERVISION_GLOBALE' && d.statut !== 'VALIDE') throw forbidden('Document non accessible.', 'HORS_PERIMETRE');
  return d;
}
function actionsDoc(ctx, d) {
  const modifiable = ['BROUILLON', 'A_CORRIGER'].includes(d.statut);
  return {
    modifier: ctx.can('ptba.preparer') && modifiable, soumettre: ctx.can('ptba.preparer') && modifiable,
    verifier: ctx.can('ptba.verifier') && d.statut === 'SOUMIS', consolider: ctx.can('ptba.consolider') && d.statut === 'VERIFIE',
    valider: ctx.can('ptba.valider') && d.statut === 'CONSOLIDE',
    retourner: (ctx.can('ptba.verifier') && d.statut === 'SOUMIS') || (ctx.can('ptba.consolider') && d.statut === 'VERIFIE') || (ctx.can('ptba.valider') && d.statut === 'CONSOLIDE'),
  };
}

router.get('/documents/:id', requirePerm('planification.consulter'), validate({ params: idParam }), async (req, res) => {
  const d = await chargerDoc(req.ctx, req.valid.params.id);
  res.json({ ...d, libelle: TYPES[d.type], historique: await getHistory('PLAN_DOCUMENT', d.id), actions: actionsDoc(req.ctx, d) });
});

router.post('/documents', requirePerm('ptba.preparer'), validate({ body: z.object({ type: z.enum(Object.keys(TYPES)), annee }) }), async (req, res) => {
  try {
    const d = await db.transaction(async (trx) => {
      const [x] = await trx('plan_documents').insert({ ...req.valid.body, reference: await nextReference(req.valid.body.type, `DEP/${req.valid.body.type}`, trx), prepare_par: req.ctx.userId }).returning('*');
      await addHistory('PLAN_DOCUMENT', x.id, req.ctx.userId, { action: 'CREATION', nouveau: 'BROUILLON' }, trx);
      return x;
    });
    await audit(req, { action: 'CREATION', module: 'planification', entite: 'plan_document', entiteId: d.id, apres: { type: d.type, annee: d.annee } });
    res.status(201).json(d);
  } catch (e) {
    if (e.code === '23505') throw conflict(`Un ${req.valid.body.type} ${req.valid.body.annee} existe déjà.`);
    throw e;
  }
});

const texteLibre = z.string().trim().max(50000).optional().nullable();
router.put('/documents/:id', requirePerm('ptba.preparer'), validate({ params: idParam, body: z.object({ contenu: z.object({
  ministere: z.string().trim().max(200).optional().nullable(), section: z.string().trim().max(20).optional().nullable(), responsable: z.string().trim().max(300).optional().nullable(),
  missions: texteLibre, organisation: texteLibre, performances_anterieures: texteLibre, perspectives: texteLibre, synthese: texteLibre, difficultes: texteLibre,
  programmes: z.record(z.string(), z.object({ perimetre: texteLibre, strategie: texteLibre, analyse: texteLibre })).optional(),
}) }) }), async (req, res) => {
  const d = await chargerDoc(req.ctx, req.valid.params.id);
  if (!actionsDoc(req.ctx, d).modifier) throw badRequest('Seul un document en préparation ou à corriger se modifie.');
  const [u] = await db('plan_documents').where({ id: d.id }).update({ contenu: JSON.stringify(req.valid.body.contenu), updated_at: db.fn.now() }).returning('*');
  await addHistory('PLAN_DOCUMENT', d.id, req.ctx.userId, { action: 'MODIFICATION', commentaire: 'Parties rédigées mises à jour' });
  await audit(req, { action: 'MODIFICATION', module: 'planification', entite: 'plan_document', entiteId: d.id });
  res.json(u);
});

async function comptes(codeBureau, role, division) {
  const b = codeBureau ? await db('bureaux').where({ code: codeBureau }).first() : null;
  const dv = division ? await db('divisions').where({ code: division }).first() : null;
  return (await loadAllNodes()).filter((n) => n.node && (!role || n.primaryRole === role) && ((b && n.bureauId === b.id) || (dv && !n.bureauId && n.divisionId === dv.id && n.primaryRole === 'CHEF_DIVISION'))).map((n) => n.userId);
}

const ETAPES = {
  soumettre: { de: ['BROUILLON', 'A_CORRIGER'], vers: 'SOUMIS', droit: 'soumettre', dest: () => comptes('BUR-PRG', 'CHEF_BUREAU'), titre: 'à vérifier' },
  verifier: { de: ['SOUMIS'], vers: 'VERIFIE', droit: 'verifier', patch: (ctx) => ({ verifie_par: ctx.userId }), dest: () => comptes(null, null, 'DIV-PS'), titre: 'à consolider' },
  consolider: { de: ['VERIFIE'], vers: 'CONSOLIDE', droit: 'consolider', patch: (ctx) => ({ consolide_par: ctx.userId }), dest: () => directeursActifs(), titre: 'à valider' },
  valider: { de: ['CONSOLIDE'], vers: 'VALIDE', droit: 'valider', patch: (ctx) => ({ valide_par: ctx.userId, valide_at: db.fn.now() }), dest: async (d) => [d.prepare_par, d.verifie_par, d.consolide_par], titre: 'validé' },
};
for (const [nom, e] of Object.entries(ETAPES)) {
  router.post(`/documents/:id/${nom}`, requirePerm('planification.consulter'), validate({ params: idParam }), async (req, res) => {
    const d = await chargerDoc(req.ctx, req.valid.params.id);
    if (!actionsDoc(req.ctx, d)[e.droit] || !e.de.includes(d.statut)) throw forbidden('Opération impossible à cette étape.');
    const [u] = await db('plan_documents').where({ id: d.id }).update({ statut: e.vers, ...(e.patch ? e.patch(req.ctx) : {}), updated_at: db.fn.now() }).returning('*');
    await addHistory('PLAN_DOCUMENT', d.id, req.ctx.userId, { action: nom.toUpperCase(), ancien: d.statut, nouveau: e.vers });
    await audit(req, { action: nom === 'valider' ? 'VALIDATION' : 'MODIFICATION', module: 'planification', entite: 'plan_document', entiteId: d.id, message: `${d.type} ${d.annee} : ${nom}` });
    const to = [...new Set(await e.dest(d))].filter((x) => x && x !== req.ctx.userId);
    if (to.length) await notify(to, { type: 'PTBA', titre: `${d.type} ${d.annee} ${e.titre}`, message: d.reference, lien: `/planification/documents/${d.id}`, expediteur: req.ctx.userId });
    res.json(u);
  });
}
router.post('/documents/:id/retourner', requirePerm('planification.consulter'), validate({ params: idParam, body: z.object({ motif: z.string().trim().min(3).max(5000) }) }), async (req, res) => {
  const d = await chargerDoc(req.ctx, req.valid.params.id);
  if (!actionsDoc(req.ctx, d).retourner) throw forbidden('Vous ne pouvez pas retourner ce document à cette étape.');
  const [u] = await db('plan_documents').where({ id: d.id }).update({ statut: 'A_CORRIGER', observations: req.valid.body.motif, updated_at: db.fn.now() }).returning('*');
  await addHistory('PLAN_DOCUMENT', d.id, req.ctx.userId, { action: 'RETOUR_CORRECTION', ancien: d.statut, nouveau: 'A_CORRIGER', commentaire: req.valid.body.motif });
  await audit(req, { action: 'MODIFICATION', module: 'planification', entite: 'plan_document', entiteId: d.id, message: 'Retour pour correction' });
  if (d.prepare_par !== req.ctx.userId) await notify(d.prepare_par, { type: 'PTBA', titre: `${d.type} ${d.annee} à corriger`, message: req.valid.body.motif, lien: `/planification/documents/${d.id}`, expediteur: req.ctx.userId });
  res.json(u);
});

router.get('/documents/:id/export', requirePerm('exports.generer'), validate({ params: idParam }), async (req, res) => {
  const d = await chargerDoc(req.ctx, req.valid.params.id);
  const nom = `${d.type}-${d.annee}`;
  await audit(req, { action: 'EXPORT', module: 'planification', entite: 'plan_document', entiteId: d.id, message: nom });
  if (d.type === 'CDMT') {
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${nom}.xlsx"`);
    return res.send(await prog.cdmt(d));
  }
  const buf = d.type === 'PAP' ? await prog.pap(d) : await prog.rap(d);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  res.setHeader('Content-Disposition', `attachment; filename="${nom}.docx"`);
  return res.send(buf);
});

// ─── Banque des projets, jalons et risques ──────────────────────────────────
router.get('/banque', requirePerm('planification.consulter'), async (req, res) => {
  const rows = await db('pip_projects as p').leftJoin('plan_programmes as g', 'g.id', 'p.programme_id')
    .select('p.id', 'p.code', 'p.intitule', 'p.secteur', 'p.statut', 'p.maturite', 'p.programme_id', 'p.localisation', 'p.partenaires', 'p.cout_total', 'p.devise', 'p.date_debut', 'p.duree_mois', 'g.libelle as programme_libelle',
      db.raw('(SELECT count(*) FROM pip_jalons j WHERE j.pip_id = p.id)::int as jalons'),
      db.raw('(SELECT count(*) FROM pip_jalons j WHERE j.pip_id = p.id AND j.date_realisee IS NULL AND j.date_prevue < CURRENT_DATE)::int as jalons_en_retard'),
      db.raw(`(SELECT count(*) FROM risques r WHERE r.entity_type = 'PIP' AND r.entity_id = p.id AND r.statut = 'OUVERT')::int as risques_ouverts`))
    .whereNot('p.statut', 'BROUILLON').orderBy('p.code');
  res.json({ data: rows.map((r) => ({ ...r, cout_total: Number(r.cout_total) })), droits: { suivre: peutSuivre(req.ctx) } });
});

router.get('/banque/:id', requirePerm('planification.consulter'), validate({ params: idParam }), async (req, res) => {
  const p = await db('pip_projects').where({ id: req.valid.params.id }).first('id', 'code', 'intitule', 'maturite', 'programme_id', 'localisation', 'partenaires', 'statut');
  if (!p) throw notFound();
  res.json({ ...p, jalons: await db('pip_jalons').where({ pip_id: p.id }).orderBy('date_prevue'), risques: await db('risques').where({ entity_type: 'PIP', entity_id: p.id }).orderBy('id'), droits: { suivre: peutSuivre(req.ctx) } });
});

router.put('/banque/:id', requirePerm('planification.consulter'), validate({ params: idParam, body: z.object({
  maturite: z.enum(['IDEE', 'ETUDE', 'PRET', 'EN_COURS', 'ACHEVE', 'ABANDONNE']), programme_id: z.coerce.number().int().positive().nullable().optional(),
  localisation: z.string().trim().max(200).optional().nullable(), partenaires: z.string().trim().max(300).optional().nullable(),
}) }), async (req, res) => {
  exiger(peutSuivre(req.ctx));
  const avant = await db('pip_projects').where({ id: req.valid.params.id }).first('id', 'maturite', 'programme_id');
  if (!avant) throw notFound();
  const [u] = await db('pip_projects').where({ id: avant.id }).update({ ...req.valid.body, programme_id: req.valid.body.programme_id || null }).returning(['id', 'maturite', 'programme_id', 'localisation', 'partenaires']);
  await audit(req, { action: 'MODIFICATION', module: 'planification', entite: 'banque_projets', entiteId: avant.id, avant, apres: u });
  res.json(u);
});

const jalonSchema = z.object({ libelle: z.string().trim().min(3).max(300), date_prevue: z.string().date(), date_realisee: z.string().date().optional().nullable(), commentaire: z.string().trim().max(2000).optional().nullable() });
router.post('/banque/:id/jalons', requirePerm('planification.consulter'), validate({ params: idParam, body: jalonSchema }), async (req, res) => {
  exiger(peutSuivre(req.ctx));
  if (!(await db('pip_projects').where({ id: req.valid.params.id }).first())) throw notFound();
  const [j] = await db('pip_jalons').insert({ ...req.valid.body, pip_id: req.valid.params.id }).returning('*');
  await audit(req, { action: 'CREATION', module: 'planification', entite: 'jalon', entiteId: j.id, apres: j });
  res.status(201).json(j);
});
router.put('/jalons/:id', requirePerm('planification.consulter'), validate({ params: idParam, body: jalonSchema }), async (req, res) => {
  exiger(peutSuivre(req.ctx));
  const [j] = await db('pip_jalons').where({ id: req.valid.params.id }).update({ ...req.valid.body, updated_at: db.fn.now() }).returning('*');
  if (!j) throw notFound();
  await audit(req, { action: 'MODIFICATION', module: 'planification', entite: 'jalon', entiteId: j.id, apres: j });
  res.json(j);
});

const risqueSchema = z.object({
  entity_type: z.enum(['PIP', 'PROGRAMME', 'PTBA']), entity_id: z.coerce.number().int().positive(), libelle: z.string().trim().min(3).max(2000),
  probabilite: z.coerce.number().int().min(1).max(3), impact: z.coerce.number().int().min(1).max(3), mesures: z.string().trim().max(5000).optional().nullable(),
  responsable: z.string().trim().max(200).optional().nullable(), echeance: z.string().date().optional().nullable(), statut: z.enum(['OUVERT', 'MAITRISE', 'CLOS']).default('OUVERT'),
});
const TABLES_RISQUE = { PIP: 'pip_projects', PROGRAMME: 'plan_programmes', PTBA: 'ptba' };

router.get('/risques', requirePerm('planification.consulter'), async (req, res) => {
  const rows = await db('risques as r')
    .leftJoin('pip_projects as p', function j() { this.on('p.id', 'r.entity_id').andOn('r.entity_type', db.raw("'PIP'")); })
    .leftJoin('plan_programmes as g', function j() { this.on('g.id', 'r.entity_id').andOn('r.entity_type', db.raw("'PROGRAMME'")); })
    .leftJoin('ptba as t', function j() { this.on('t.id', 'r.entity_id').andOn('r.entity_type', db.raw("'PTBA'")); })
    .leftJoin('plan_services as s', 's.id', 't.service_id')
    .select('r.*', db.raw(`coalesce(p.code || ' — ' || p.intitule, 'Programme ' || g.code || ' — ' || g.libelle, 'PTBA ' || s.sigle) as objet`), db.raw('(r.probabilite * r.impact) as criticite'))
    .orderByRaw("CASE r.statut WHEN 'OUVERT' THEN 0 WHEN 'MAITRISE' THEN 1 ELSE 2 END").orderByRaw('r.probabilite * r.impact DESC');
  res.json({ data: rows, droits: { suivre: peutSuivre(req.ctx) } });
});
router.post('/risques', requirePerm('planification.consulter'), validate({ body: risqueSchema }), async (req, res) => {
  exiger(peutSuivre(req.ctx));
  if (!(await db(TABLES_RISQUE[req.valid.body.entity_type]).where({ id: req.valid.body.entity_id }).first())) throw badRequest('Élément concerné introuvable.');
  const [r] = await db('risques').insert({ ...req.valid.body, created_by: req.ctx.userId }).returning('*');
  await audit(req, { action: 'CREATION', module: 'planification', entite: 'risque', entiteId: r.id, apres: r });
  if (r.probabilite * r.impact >= 6) await notify(await directeursActifs(), { type: 'PTBA', titre: `Risque critique signalé : ${r.libelle.slice(0, 120)}`, message: `Probabilité ${r.probabilite}/3, impact ${r.impact}/3`, lien: '/planification', expediteur: req.ctx.userId });
  res.status(201).json(r);
});
router.put('/risques/:id', requirePerm('planification.consulter'), validate({ params: idParam, body: risqueSchema }), async (req, res) => {
  exiger(peutSuivre(req.ctx));
  const avant = await db('risques').where({ id: req.valid.params.id }).first();
  if (!avant) throw notFound();
  const [r] = await db('risques').where({ id: avant.id }).update({ ...req.valid.body, updated_at: db.fn.now() }).returning('*');
  await audit(req, { action: 'MODIFICATION', module: 'planification', entite: 'risque', entiteId: r.id, avant, apres: r });
  res.json(r);
});

module.exports = router;

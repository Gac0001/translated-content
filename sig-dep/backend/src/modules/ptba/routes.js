'use strict';
/**
 * Plans de Travail Annuels Budgétisés (PTBA) des services du Ministère, consolidés par la DEP.
 *   Brouillon → Soumis (Bureau Programme) → Vérifié (Chef du Bureau Programme)
 *   → Consolidé (Chef de la Division Programme et Suivi) → Validé (Directeur)
 *   Retour pour correction à chaque étape ; PTBA validé intangible en base.
 * Le Bureau Suivi-Évaluation saisit l’exécution trimestrielle (physique et financière) des PTBA
 * validés. Import et export au format du Ministère (une feuille par service).
 */
const express = require('express');
const multer = require('multer');
const { z } = require('zod');
const db = require('../../db/knex');
const validate = require('../../middleware/validate');
const { requirePerm } = require('../../middleware/auth');
const { audit } = require('../../services/audit');
const { notify } = require('../../services/notifications');
const { addHistory, getHistory } = require('../../services/history');
const { nextReference } = require('../../services/sequence');
const { loadAllNodes } = require('../../services/hierarchy');
const { directeursActifs } = require('../../services/alertes');
const ptba = require('../../services/ptba');
const pdf = require('../../services/pdf');
const { badRequest, forbidden, notFound, conflict } = require('../../utils/errors');

const router = express.Router();
const idParam = z.object({ id: z.coerce.number().int().positive() });
const STATUTS = { BROUILLON: 'Brouillon', SOUMIS: 'Soumis', VERIFIE: 'Vérifié', CONSOLIDE: 'Consolidé', VALIDE: 'Validé', A_CORRIGER: 'À corriger' };
const upload = multer({
  storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => (/\.xlsx$/i.test(file.originalname) ? cb(null, true) : cb(badRequest('Format attendu : classeur Excel (.xlsx) au format PTBA du Ministère.'))),
});
const fmt = (n) => Math.round(Number(n) || 0).toLocaleString('fr-FR').replace(/ | /g, ' ');

/** Le Secrétaire Général ne voit que les PTBA validés (résultats consolidés). */
function visibles(qb, ctx) {
  if (!ctx.can('planification.consulter')) return qb.whereRaw('false');
  if (ctx.perimetre === 'SUPERVISION_GLOBALE') return qb.where('p.statut', 'VALIDE');
  return qb;
}

/** Comptes d’une structure (intérims compris), éventuellement limités à un rôle. */
async function comptesStructure({ bureau, division, role }) {
  const b = bureau ? await db('bureaux').where({ code: bureau }).first() : null;
  const d = division ? await db('divisions').where({ code: division }).first() : null;
  return (await loadAllNodes()).filter((n) => n.node && (!role || n.primaryRole === role)
    && ((b && n.bureauId === b.id) || (d && !n.bureauId && n.divisionId === d.id && n.primaryRole === 'CHEF_DIVISION'))).map((n) => n.userId);
}

router.get('/', validate({ query: z.object({ exercice: z.coerce.number().int().optional(), statut: z.enum(Object.keys(STATUTS)).optional() }) }), async (req, res) => {
  const q = visibles(db('ptba as p'), req.ctx).join('exercices as e', 'e.id', 'p.exercice_id').join('plan_services as s', 's.id', 'p.service_id')
    .leftJoin('plan_programmes as g', 'g.id', 'p.programme_id')
    .select('p.*', 'e.annee', 's.sigle as service_sigle', 's.libelle as service_libelle', 'g.libelle as programme_libelle',
      db.raw('(SELECT count(*) FROM ptba_lignes l WHERE l.ptba_id = p.id)::int as nb_lignes'),
      db.raw('(SELECT coalesce(sum(cout), 0) FROM ptba_lignes l WHERE l.ptba_id = p.id) as cout_total'))
    .orderBy('e.annee', 'desc').orderBy('s.sigle');
  if (req.valid.query.exercice) q.where('e.annee', req.valid.query.exercice);
  if (req.valid.query.statut) q.where('p.statut', req.valid.query.statut);
  const rows = (await q).map((r) => ({ ...r, cout_total: Number(r.cout_total) }));
  res.json({
    data: rows,
    droits: { preparer: req.ctx.can('ptba.preparer'), suivre: req.ctx.can('ptba.suivre') },
  });
});

/** Tableau de bord de l’exercice : coût programmé, engagé, décaissé, exécution physique par service. */
router.get('/tableau-de-bord', validate({ query: z.object({ exercice: z.coerce.number().int() }) }), async (req, res) => {
  const ids = await visibles(db('ptba as p'), req.ctx).join('exercices as e', 'e.id', 'p.exercice_id').where('e.annee', req.valid.query.exercice).where('p.statut', 'VALIDE').pluck('p.id');
  const services = [];
  let toutes = [];
  for (const id of ids) {
    const p = await ptba.charger(id);
    toutes = toutes.concat(p.lignes);
    services.push({ id, sigle: p.service_sigle, libelle: p.service_libelle, trimestres: ptba.coutParTrimestre(p.lignes), ...ptba.execution(p.lignes) });
  }
  res.json({ exercice: req.valid.query.exercice, global: { ...ptba.execution(toutes), trimestres: ptba.coutParTrimestre(toutes) }, services: services.sort((a, b) => b.cout - a.cout) });
});

router.get('/export/consolide', requirePerm('exports.generer'), validate({ query: z.object({ exercice: z.coerce.number().int(), tous: z.enum(['1']).optional() }) }), async (req, res) => {
  const q = visibles(db('ptba as p'), req.ctx).join('exercices as e', 'e.id', 'p.exercice_id').join('plan_services as s', 's.id', 'p.service_id').where('e.annee', req.valid.query.exercice).orderBy('s.sigle');
  if (!req.valid.query.tous) q.whereIn('p.statut', ['CONSOLIDE', 'VALIDE']);
  const ids = await q.pluck('p.id');
  if (!ids.length) throw badRequest('Aucun PTBA consolidé ou validé pour cet exercice.');
  const wb = await ptba.classeur(ids, { synthese: true });
  await audit(req, { action: 'EXPORT', module: 'planification', message: `PTBA consolidé ${req.valid.query.exercice} (${ids.length} service(s))` });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="PTBA-${req.valid.query.exercice}-consolide.xlsx"`);
  await wb.xlsx.write(res);
  res.end();
});

// ─── Import au format du Ministère ──────────────────────────────────────────
router.post('/import/analyser', requirePerm('ptba.preparer'), (req, res, next) => upload.single('fichier')(req, res, async (err) => {
  if (err) return next(err);
  try {
    if (!req.file) throw badRequest('Aucun fichier transmis.');
    let r;
    try { r = await ptba.analyser(req.file.buffer); } catch (e) { throw badRequest('Classeur illisible : vérifiez qu’il s’agit d’un fichier Excel (.xlsx).'); }
    if (!r.feuilles.length) throw badRequest('Aucune feuille au format PTBA (colonnes « Activités principales », « Tâches », « Coût », chronogramme) n’a été trouvée.');
    const services = await db('plan_services').select('id', 'sigle');
    const programmes = await db('plan_programmes').select('id', 'libelle');
    for (const f of r.feuilles) {
      f.service_id = (services.find((s) => s.sigle === f.sigle) || {}).id || null;
      const prog = f.programme && programmes.find((p) => p.libelle.toLowerCase().replace(/[^a-z]/g, '').startsWith(f.programme.toLowerCase().replace(/[^a-z]/g, '').slice(0, 12)));
      f.programme_id = prog ? prog.id : null;
    }
    return res.json(r);
  } catch (e) { return next(e); }
}));

const ligneSchema = z.object({
  id: z.coerce.number().int().positive().optional(),
  numero: z.string().trim().max(20).optional().nullable(),
  activite: z.string().trim().min(2).max(2000),
  taches: z.string().trim().max(10000).optional().nullable(),
  cout: z.coerce.number().min(0).max(1e15),
  mois: z.array(z.coerce.number().int().min(1).max(12)).max(12).default([]),
  structure_responsable: z.string().trim().max(200).optional().nullable(),
  resultats_attendus: z.string().trim().max(5000).optional().nullable(),
  indicateur: z.string().trim().max(5000).optional().nullable(),
  source_verification: z.string().trim().max(5000).optional().nullable(),
  source_financement: z.string().trim().max(200).optional().nullable(),
  action_id: z.coerce.number().int().positive().optional().nullable(),
});
const contenuSchema = z.object({
  objectifs: z.array(z.object({ libelle: z.string().trim().max(2000), lignes: z.array(ligneSchema).max(500) })).max(30),
});

async function ecrireContenu(trx, ptbaId, objectifs) {
  await trx('ptba_lignes').where({ ptba_id: ptbaId }).del();
  await trx('ptba_objectifs').where({ ptba_id: ptbaId }).del();
  let ordre = 0;
  for (const [i, o] of objectifs.entries()) {
    const [obj] = o.libelle ? await trx('ptba_objectifs').insert({ ptba_id: ptbaId, ordre: i, libelle: o.libelle }).returning('*') : [null];
    for (const l of o.lignes) {
      const { id, ...champs } = l;
      ordre += 1;
      await trx('ptba_lignes').insert({ ...champs, mois: [...new Set(l.mois)].sort((a, b) => a - b), ptba_id: ptbaId, objectif_id: obj ? obj.id : null, ordre });
    }
  }
}

router.post('/import/confirmer', requirePerm('ptba.preparer'), validate({ body: z.object({
  exercice_id: z.coerce.number().int().positive(),
  feuilles: z.array(contenuSchema.extend({
    sigle: z.string().trim().min(2).max(30), service_libelle: z.string().trim().max(300).optional(), service_id: z.coerce.number().int().positive().optional().nullable(),
    programme_id: z.coerce.number().int().positive().optional().nullable(), objectif_global: z.string().trim().max(2000).optional().nullable(),
  })).min(1).max(30),
}) }), async (req, res) => {
  const { exercice_id: exerciceId, feuilles } = req.valid.body;
  const ex = await db('exercices').where({ id: exerciceId }).first();
  if (!ex) throw badRequest('Exercice inconnu.');
  const crees = await db.transaction(async (trx) => {
    const out = [];
    for (const f of feuilles) {
      let service = f.service_id ? await trx('plan_services').where({ id: f.service_id }).first() : await trx('plan_services').where({ sigle: f.sigle.toUpperCase() }).first();
      if (!service) [service] = await trx('plan_services').insert({ sigle: f.sigle.toUpperCase(), libelle: f.service_libelle || f.sigle.toUpperCase() }).returning('*');
      const existe = await trx('ptba').where({ exercice_id: exerciceId, service_id: service.id }).first();
      if (existe) throw conflict(`Un PTBA ${ex.annee} existe déjà pour ${service.sigle} : modifiez-le ou retirez cette feuille de l’import.`);
      const [p] = await trx('ptba').insert({
        reference: await nextReference('PTBA', 'DEP/PTBA', trx), exercice_id: exerciceId, service_id: service.id, programme_id: f.programme_id || null,
        objectif_global: f.objectif_global || null, prepare_par: req.ctx.userId, detenteur_user_id: req.ctx.userId,
      }).returning('*');
      await ecrireContenu(trx, p.id, f.objectifs);
      await addHistory('PTBA', p.id, req.ctx.userId, { action: 'IMPORT', nouveau: 'BROUILLON', commentaire: `Importé (${f.objectifs.reduce((s, o) => s + o.lignes.length, 0)} ligne(s))` }, trx);
      out.push(p);
    }
    return out;
  });
  await audit(req, { action: 'IMPORT', module: 'planification', message: `Import PTBA ${ex.annee} : ${crees.map((p) => p.reference).join(', ')}` });
  res.status(201).json({ data: crees });
});

// ─── PTBA ───────────────────────────────────────────────────────────────────
async function chargerVisible(ctx, id) {
  const p = await ptba.charger(id);
  if (!p) throw notFound('PTBA introuvable.');
  if (!ctx.can('planification.consulter') || (ctx.perimetre === 'SUPERVISION_GLOBALE' && p.statut !== 'VALIDE')) throw forbidden('PTBA non accessible.', 'HORS_PERIMETRE');
  return p;
}

function actionsPour(ctx, p) {
  const modifiable = ['BROUILLON', 'A_CORRIGER'].includes(p.statut);
  return {
    modifier: ctx.can('ptba.preparer') && modifiable,
    soumettre: ctx.can('ptba.preparer') && modifiable && p.lignes.length > 0,
    verifier: ctx.can('ptba.verifier') && p.statut === 'SOUMIS',
    consolider: ctx.can('ptba.consolider') && p.statut === 'VERIFIE',
    valider: ctx.can('ptba.valider') && p.statut === 'CONSOLIDE',
    retourner: (ctx.can('ptba.verifier') && p.statut === 'SOUMIS') || (ctx.can('ptba.consolider') && p.statut === 'VERIFIE') || (ctx.can('ptba.valider') && p.statut === 'CONSOLIDE'),
    suivre: ctx.can('ptba.suivre') && p.statut === 'VALIDE',
  };
}

router.get('/:id', validate({ params: idParam }), async (req, res) => {
  const p = await chargerVisible(req.ctx, req.valid.params.id);
  res.json({ ...p, historique: await getHistory('PTBA', p.id), trimestres: ptba.coutParTrimestre(p.lignes), execution: ptba.execution(p.lignes), actions: actionsPour(req.ctx, p) });
});

const enteteSchema = z.object({
  exercice_id: z.coerce.number().int().positive(), service_id: z.coerce.number().int().positive(),
  programme_id: z.coerce.number().int().positive().optional().nullable(), objectif_global: z.string().trim().max(2000).optional().nullable(),
});

router.post('/', requirePerm('ptba.preparer'), validate({ body: enteteSchema }), async (req, res) => {
  const b = req.valid.body;
  if (!(await db('exercices').where({ id: b.exercice_id }).first()) || !(await db('plan_services').where({ id: b.service_id }).first())) throw badRequest('Exercice ou service inconnu.');
  try {
    const p = await db.transaction(async (trx) => {
      const [x] = await trx('ptba').insert({ ...b, reference: await nextReference('PTBA', 'DEP/PTBA', trx), prepare_par: req.ctx.userId, detenteur_user_id: req.ctx.userId }).returning('*');
      await addHistory('PTBA', x.id, req.ctx.userId, { action: 'CREATION', nouveau: 'BROUILLON' }, trx);
      return x;
    });
    await audit(req, { action: 'CREATION', module: 'planification', entite: 'ptba', entiteId: p.id, apres: { reference: p.reference } });
    res.status(201).json(p);
  } catch (e) {
    if (e.code === '23505') throw conflict('Un PTBA existe déjà pour ce service et cet exercice.');
    throw e;
  }
});

router.put('/:id', requirePerm('ptba.preparer'), validate({ params: idParam, body: enteteSchema.omit({ exercice_id: true, service_id: true }).extend(contenuSchema.shape) }), async (req, res) => {
  const p = await chargerVisible(req.ctx, req.valid.params.id);
  if (!actionsPour(req.ctx, p).modifier) throw badRequest('Seul un PTBA en préparation ou retourné pour correction se modifie.');
  const b = req.valid.body;
  await db.transaction(async (trx) => {
    await trx('ptba').where({ id: p.id }).update({ programme_id: b.programme_id || null, objectif_global: b.objectif_global || null, updated_at: trx.fn.now() });
    await ecrireContenu(trx, p.id, b.objectifs);
  });
  const nb = b.objectifs.reduce((s, o) => s + o.lignes.length, 0);
  await addHistory('PTBA', p.id, req.ctx.userId, { action: 'MODIFICATION', commentaire: `${nb} ligne(s), ${fmt(b.objectifs.reduce((s, o) => s + o.lignes.reduce((x, l) => x + l.cout, 0), 0))} CDF` });
  await audit(req, { action: 'MODIFICATION', module: 'planification', entite: 'ptba', entiteId: p.id, message: `${nb} ligne(s)` });
  res.json(await ptba.charger(p.id));
});

async function changer(req, p, patch, action, commentaire, destinataires, titre) {
  const [u] = await db('ptba').where({ id: p.id }).update({ ...patch, updated_at: db.fn.now() }).returning('*');
  await addHistory('PTBA', p.id, req.ctx.userId, { action, ancien: p.statut, nouveau: u.statut, commentaire });
  await audit(req, { action: ['VALIDATION', 'VERIFICATION', 'CONSOLIDATION'].includes(action) ? 'VALIDATION' : 'MODIFICATION', module: 'planification', entite: 'ptba', entiteId: p.id, avant: { statut: p.statut }, apres: { statut: u.statut }, message: action });
  const to = [...new Set(destinataires)].filter((x) => x && x !== req.ctx.userId);
  if (to.length) await notify(to, { type: 'PTBA', titre: `${titre} : PTBA ${p.annee} ${p.service_sigle}`, message: commentaire || p.reference, lien: `/planification/ptba/${p.id}`, expediteur: req.ctx.userId });
  return u;
}

router.post('/:id/soumettre', requirePerm('ptba.preparer'), validate({ params: idParam }), async (req, res) => {
  const p = await chargerVisible(req.ctx, req.valid.params.id);
  if (!actionsPour(req.ctx, p).soumettre) throw badRequest('PTBA vide ou déjà transmis.');
  const sansCout = p.lignes.filter((l) => !l.activite || !l.mois.length).length;
  if (sansCout) throw badRequest(`${sansCout} ligne(s) sans chronogramme : cochez au moins un mois pour chaque activité.`);
  const chefs = await comptesStructure({ bureau: 'BUR-PRG', role: 'CHEF_BUREAU' });
  res.json(await changer(req, p, { statut: 'SOUMIS', detenteur_user_id: chefs[0] || null }, 'SOUMISSION', null, chefs, 'PTBA à vérifier'));
});

router.post('/:id/verifier', requirePerm('ptba.verifier'), validate({ params: idParam, body: z.object({ commentaire: z.string().trim().max(2000).optional() }) }), async (req, res) => {
  const p = await chargerVisible(req.ctx, req.valid.params.id);
  if (p.statut !== 'SOUMIS') throw badRequest('Seul un PTBA soumis se vérifie.');
  const cd = await comptesStructure({ division: 'DIV-PS' });
  res.json(await changer(req, p, { statut: 'VERIFIE', verifie_par: req.ctx.userId, verifie_at: db.fn.now(), detenteur_user_id: cd[0] || null }, 'VERIFICATION', req.valid.body.commentaire, cd, 'PTBA à consolider'));
});

router.post('/:id/consolider', requirePerm('ptba.consolider'), validate({ params: idParam, body: z.object({ commentaire: z.string().trim().max(2000).optional() }) }), async (req, res) => {
  const p = await chargerVisible(req.ctx, req.valid.params.id);
  if (p.statut !== 'VERIFIE') throw badRequest('Seul un PTBA vérifié se consolide.');
  const dirs = await directeursActifs();
  res.json(await changer(req, p, { statut: 'CONSOLIDE', consolide_par: req.ctx.userId, consolide_at: db.fn.now(), detenteur_user_id: dirs[0] || null }, 'CONSOLIDATION', req.valid.body.commentaire, dirs, 'PTBA à valider'));
});

router.post('/:id/valider', requirePerm('ptba.valider'), validate({ params: idParam, body: z.object({ commentaire: z.string().trim().max(2000).optional() }) }), async (req, res) => {
  const p = await chargerVisible(req.ctx, req.valid.params.id);
  if (p.statut !== 'CONSOLIDE') throw badRequest('Seul un PTBA consolidé se valide.');
  const suivi = await comptesStructure({ bureau: 'BUR-SEV' });
  res.json(await changer(req, p, { statut: 'VALIDE', valide_par: req.ctx.userId, valide_at: db.fn.now(), detenteur_user_id: null }, 'VALIDATION', req.valid.body.commentaire, [p.prepare_par, p.verifie_par, p.consolide_par, ...suivi], 'PTBA validé'));
});

router.post('/:id/retourner', validate({ params: idParam, body: z.object({ motif: z.string().trim().min(3).max(5000) }) }), async (req, res) => {
  const p = await chargerVisible(req.ctx, req.valid.params.id);
  if (!actionsPour(req.ctx, p).retourner) throw forbidden('Vous ne pouvez pas retourner ce PTBA à cette étape.');
  res.json(await changer(req, p, { statut: 'A_CORRIGER', observations: req.valid.body.motif, detenteur_user_id: p.prepare_par }, 'RETOUR_CORRECTION', req.valid.body.motif, [p.prepare_par], 'PTBA à corriger'));
});

// ─── Suivi trimestriel (Bureau Suivi-Évaluation) ────────────────────────────
router.put('/lignes/:ligne/suivi/:trimestre', requirePerm('ptba.suivre'), validate({
  params: z.object({ ligne: z.coerce.number().int().positive(), trimestre: z.coerce.number().int().min(1).max(4) }),
  body: z.object({ taux_physique: z.coerce.number().int().min(0).max(100), montant_engage: z.coerce.number().min(0), montant_decaisse: z.coerce.number().min(0), commentaire: z.string().trim().max(2000).optional().nullable() }),
}), async (req, res) => {
  const { ligne: ligneId, trimestre } = req.valid.params;
  const b = req.valid.body;
  const l = await db('ptba_lignes as l').join('ptba as p', 'p.id', 'l.ptba_id').where('l.id', ligneId).first('l.*', 'p.statut');
  if (!l) throw notFound('Ligne introuvable.');
  if (l.statut !== 'VALIDE') throw badRequest('L’exécution se suit sur un PTBA validé.');
  if (b.montant_decaisse > b.montant_engage) throw badRequest('Le montant décaissé ne peut pas dépasser le montant engagé.');
  if (b.montant_engage > Number(l.cout) * 1.5) throw badRequest('Montant engagé incohérent avec le coût programmé (plus de 150 %).');
  const [s] = await db('ptba_suivi').insert({ ligne_id: ligneId, trimestre, ...b, commentaire: b.commentaire || null, saisi_par: req.ctx.userId, saisi_at: db.fn.now() })
    .onConflict(['ligne_id', 'trimestre']).merge().returning('*');
  await addHistory('PTBA', l.ptba_id, req.ctx.userId, { action: 'SUIVI', commentaire: `T${trimestre} — ${l.activite.slice(0, 80)} : ${b.taux_physique} % ; décaissé ${fmt(b.montant_decaisse)} CDF` });
  await audit(req, { action: 'MODIFICATION', module: 'planification', entite: 'ptba_suivi', entiteId: s.id, apres: s });
  res.json(s);
});

// ─── Exports ────────────────────────────────────────────────────────────────
router.get('/:id/export/:format', requirePerm('exports.generer'), validate({ params: z.object({ id: z.coerce.number().int().positive(), format: z.enum(['xlsx', 'pdf']) }) }), async (req, res) => {
  const p = await chargerVisible(req.ctx, req.valid.params.id);
  await audit(req, { action: 'EXPORT', module: 'planification', entite: 'ptba', entiteId: p.id, message: req.valid.params.format.toUpperCase() });
  const nom = `PTBA-${p.annee}-${p.service_sigle}`;
  if (req.valid.params.format === 'xlsx') {
    const wb = await ptba.classeur([p.id]);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${nom}.xlsx"`);
    await wb.xlsx.write(res);
    return res.end();
  }
  const { doc, finish } = pdf.createPdf(res, { filename: `${nom}.pdf`, titre: 'PLAN DE TRAVAIL ANNUEL BUDGÉTISÉ', sousTitre: `${p.service_libelle} (${p.service_sigle}) — exercice ${p.annee}`, reference: p.reference, landscape: true });
  pdf.keyValues(doc, [['Programme', p.programme_libelle || '—'], ['Objectif global', p.objectif_global || '—'], ['Statut', STATUTS[p.statut]], ['Coût total', `${fmt(p.lignes.reduce((s, l) => s + l.cout, 0))} CDF`]]);
  const groupes = [...p.objectifs.map((o) => ({ titre: o.libelle, lignes: p.lignes.filter((l) => l.objectif_id === o.id) })), { titre: null, lignes: p.lignes.filter((l) => !l.objectif_id) }].filter((g) => g.lignes.length);
  groupes.forEach((g, i) => {
    if (g.titre) pdf.section(doc, `Objectif spécifique ${i + 1}`, g.titre);
    pdf.table(doc, [
      { header: 'Activité', key: 'activite', width: 4 }, { header: 'Coût (CDF)', value: (l) => fmt(l.cout), width: 1.6 },
      { header: 'Chronogramme', value: (l) => ptba.MOIS.map((m, k) => (l.mois.includes(k + 1) ? m : '·')).join(' '), width: 2.2 },
      { header: 'Responsable', key: 'structure_responsable', width: 1.4 }, { header: 'Résultats attendus', key: 'resultats_attendus', width: 3 },
      { header: 'Indicateur', key: 'indicateur', width: 2.4 },
    ], g.lignes);
  });
  return finish();
});

module.exports = router;

'use strict';
/**
 * Données sectorielles (lot 10A) : référentiel, annuaire des acteurs, questionnaires versionnés,
 * campagnes de collecte, saisie des réponses par la DEP et contrôle de qualité.
 *
 * Bureau Études, Analyses et Prospective : questionnaires et campagnes ; Bureau Documentation et
 * Information : annuaire, contrôle des réponses ; tous deux saisissent ; Chef de la Division
 * Études, Documentation et Information et Directeur : validation des campagnes. Le Secrétaire
 * Général consulte l’annuaire et les campagnes validées.
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
const svc = require('../../services/donnees');
const { badRequest, forbidden, notFound, conflict } = require('../../utils/errors');

const router = express.Router();
router.use(requirePerm('donnees.consulter'));
const idParam = z.object({ id: z.coerce.number().int().positive() });
const texte = (max) => z.string().trim().max(max).optional().nullable().transform((v) => v || null);
const dateIso = z.string().date();
const upload = multer({
  storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => (/\.xlsx$/i.test(file.originalname) ? cb(null, true) : cb(badRequest('Format attendu : classeur Excel (.xlsx) établi sur le modèle d’import.'))),
});
const xlsx = (res, nom, buf) => {
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${nom}.xlsx"`);
  res.send(buf);
};
const supervision = (ctx) => ctx.perimetre === 'SUPERVISION_GLOBALE';
const droits = (ctx) => ({
  annuaire: ctx.can('donnees.annuaire'), questionnaires: ctx.can('donnees.questionnaires'), saisir: ctx.can('donnees.saisir'),
  controler: ctx.can('donnees.controler'), valider: ctx.can('donnees.valider'), exporter: ctx.can('exports.generer'),
});
function exiger(ok, message) { if (!ok) throw forbidden(message); }

/** Comptes de la Division Études, Documentation et Information (filtrés par bureau ou rôle). */
async function membresEdi({ bureaux = ['BUR-EAP', 'BUR-DOI'], chef = true } = {}) {
  const [bs, dv] = await Promise.all([db('bureaux').whereIn('code', bureaux).pluck('id'), db('divisions').where({ code: 'DIV-EDI' }).first('id')]);
  return (await loadAllNodes()).filter((n) => n.node && (bs.includes(n.bureauId) || (chef && dv && !n.bureauId && n.divisionId === dv.id && n.primaryRole === 'CHEF_DIVISION')));
}
const validateurs = async () => [...(await membresEdi({ bureaux: [] })).map((n) => n.userId), ...(await directeursActifs())];

// ─── Référentiel ────────────────────────────────────────────────────────────
router.get('/referentiel', async (req, res) => {
  const [zones, categories] = await Promise.all([db('sect_zones').orderBy('ordre'), db('sect_categories').orderBy('ordre')]);
  const responsables = (await membresEdi()).map((n) => ({ id: n.userId, nom: n.nomComplet, fonction: n.roleLibelle, structure: n.structure }));
  res.json({ zones, categories, responsables, droits: droits(req.ctx) });
});
const zoneSchema = z.object({ libelle: z.string().trim().min(2).max(120), ordre: z.coerce.number().int().min(0).max(999).default(0), actif: z.boolean().default(true) });
const categorieSchema = z.object({ code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_]{2,20}$/, 'Code : 2 à 20 lettres, chiffres ou _'), libelle: z.string().trim().min(2).max(200), ordre: z.coerce.number().int().min(0).max(999).default(0), actif: z.boolean().default(true) });
for (const [chemin, table, schema, entite] of [['zones', 'sect_zones', zoneSchema, 'zone'], ['categories', 'sect_categories', categorieSchema, 'categorie']]) {
  router.post(`/${chemin}`, validate({ body: schema }), async (req, res) => {
    exiger(req.ctx.can('donnees.annuaire'), 'Le référentiel est tenu par le Bureau Documentation et Information.');
    try {
      const [x] = await db(table).insert(req.valid.body).returning('*');
      await audit(req, { action: 'CREATION', module: 'donnees', entite, entiteId: x.id, apres: x });
      res.status(201).json(x);
    } catch (e) { if (e.code === '23505') throw conflict('Cet élément existe déjà.'); throw e; }
  });
  router.put(`/${chemin}/:id`, validate({ params: idParam, body: schema }), async (req, res) => {
    exiger(req.ctx.can('donnees.annuaire'), 'Le référentiel est tenu par le Bureau Documentation et Information.');
    const avant = await db(table).where({ id: req.valid.params.id }).first();
    if (!avant) throw notFound();
    try {
      const [x] = await db(table).where({ id: avant.id }).update(req.valid.body).returning('*');
      await audit(req, { action: 'MODIFICATION', module: 'donnees', entite, entiteId: x.id, avant, apres: x });
      res.json(x);
    } catch (e) { if (e.code === '23505') throw conflict('Cet élément existe déjà.'); throw e; }
  });
}

// ─── Annuaire des acteurs ───────────────────────────────────────────────────
const acteurSchema = z.object({
  raison_sociale: z.string().trim().min(2).max(300), sigle: texte(60), categorie_id: z.coerce.number().int().positive(), forme_juridique: texte(60),
  rccm: texte(60), id_nat: texte(60), numero_impot: texte(60), zone_id: z.coerce.number().int().positive(), ville: texte(120), adresse: texte(300),
  telephone: texte(60), email: z.string().trim().email('Courriel invalide').max(200).optional().nullable().or(z.literal('')).transform((v) => v || null), site_web: texte(200), responsable: texte(200),
  annee_creation: z.coerce.number().int().min(1900).max(2100).optional().nullable(), effectif: z.coerce.number().int().min(0).max(10000000).optional().nullable(),
  statut: z.enum(['ACTIF', 'SUSPENDU', 'CESSE']).default('ACTIF'), observations: texte(5000),
});
const LIBELLES_ACTEUR = { raison_sociale: 'raison sociale', sigle: 'sigle', categorie_id: 'catégorie', forme_juridique: 'forme juridique', rccm: 'RCCM', id_nat: 'identification nationale', numero_impot: 'numéro d’impôt', zone_id: 'province', ville: 'ville', adresse: 'adresse', telephone: 'téléphone', email: 'courriel', site_web: 'site web', responsable: 'responsable', annee_creation: 'année de création', effectif: 'effectif', statut: 'statut', observations: 'observations' };

function doublon(e) {
  if (e.code !== '23505') return e;
  if (/rccm/.test(e.constraint)) return conflict('Un acteur porte déjà ce RCCM dans l’annuaire.');
  if (/idnat/.test(e.constraint)) return conflict('Un acteur porte déjà cette identification nationale dans l’annuaire.');
  return conflict('Un acteur de même raison sociale existe déjà dans cette province.');
}
const requeteActeurs = () => db('sect_acteurs as a').join('sect_categories as c', 'c.id', 'a.categorie_id').join('sect_zones as z', 'z.id', 'a.zone_id')
  .select('a.*', 'c.libelle as categorie', 'z.libelle as zone');

router.get('/acteurs', validate({ query: z.object({ categorie: z.coerce.number().int().optional(), zone: z.coerce.number().int().optional(), statut: z.enum(['ACTIF', 'SUSPENDU', 'CESSE']).optional() }) }), async (req, res) => {
  const f = req.valid.query;
  const q = requeteActeurs().select(db.raw('(SELECT count(*) FROM sect_reponses r WHERE r.acteur_id = a.id)::int as reponses')).orderBy('a.raison_sociale');
  if (f.categorie) q.where('a.categorie_id', f.categorie);
  if (f.zone) q.where('a.zone_id', f.zone);
  if (f.statut) q.where('a.statut', f.statut);
  res.json({ data: await q, droits: droits(req.ctx) });
});
router.get('/acteurs/modele', requirePerm('exports.generer'), async (req, res) => xlsx(res, 'Modele-import-annuaire', await svc.modele()));
router.get('/acteurs/export', requirePerm('exports.generer'), async (req, res) => {
  const rows = await requeteActeurs().orderBy('a.raison_sociale');
  await audit(req, { action: 'EXPORT', module: 'donnees', entite: 'annuaire', message: `${rows.length} acteur(s)` });
  xlsx(res, 'Annuaire-acteurs-numerique', await svc.exporterAnnuaire(rows));
});
router.get('/acteurs/:id', validate({ params: idParam }), async (req, res) => {
  const a = await requeteActeurs().where('a.id', req.valid.params.id).first();
  if (!a) throw notFound('Acteur introuvable.');
  const participations = await db('sect_campagne_cibles as k').join('sect_campagnes as c', 'c.id', 'k.campagne_id')
    .leftJoin('sect_reponses as r', function j() { this.on('r.campagne_id', 'c.id').andOn('r.acteur_id', 'k.acteur_id'); })
    .where('k.acteur_id', a.id).modify((q) => { if (supervision(req.ctx)) q.where('c.statut', 'VALIDEE'); })
    .orderBy('c.periode_debut', 'desc').select('c.id', 'c.reference', 'c.titre', 'c.periode', 'c.statut', 'r.statut as reponse');
  res.json({ ...a, participations, historique: await getHistory('ACTEUR', a.id), droits: droits(req.ctx) });
});
router.post('/acteurs', validate({ body: acteurSchema }), async (req, res) => {
  exiger(req.ctx.can('donnees.annuaire'), 'L’annuaire est tenu par le Bureau Documentation et Information.');
  try {
    const a = await db.transaction(async (trx) => {
      const [x] = await trx('sect_acteurs').insert({ ...req.valid.body, reference: await nextReference('ACTEUR', 'DEP/ACT', trx), created_by: req.ctx.userId }).returning('*');
      await addHistory('ACTEUR', x.id, req.ctx.userId, { action: 'CREATION', nouveau: x.statut }, trx);
      return x;
    });
    await audit(req, { action: 'CREATION', module: 'donnees', entite: 'acteur', entiteId: a.id, apres: a });
    res.status(201).json(a);
  } catch (e) { throw doublon(e); }
});
router.put('/acteurs/:id', validate({ params: idParam, body: acteurSchema }), async (req, res) => {
  exiger(req.ctx.can('donnees.annuaire'), 'L’annuaire est tenu par le Bureau Documentation et Information.');
  const avant = await db('sect_acteurs').where({ id: req.valid.params.id }).first();
  if (!avant) throw notFound('Acteur introuvable.');
  const champs = Object.keys(req.valid.body).filter((k) => String(req.valid.body[k] ?? '') !== String(avant[k] ?? ''));
  if (!champs.length) return res.json(avant);
  try {
    const [a] = await db('sect_acteurs').where({ id: avant.id }).update({ ...req.valid.body, updated_at: db.fn.now() }).returning('*');
    await addHistory('ACTEUR', a.id, req.ctx.userId, {
      action: 'MODIFICATION', ancien: avant.statut !== a.statut ? avant.statut : null, nouveau: avant.statut !== a.statut ? a.statut : null,
      commentaire: `Modifié : ${champs.map((k) => LIBELLES_ACTEUR[k]).join(', ')}`, details: Object.fromEntries(champs.map((k) => [k, { avant: avant[k], apres: a[k] }])),
    });
    await audit(req, { action: 'MODIFICATION', module: 'donnees', entite: 'acteur', entiteId: a.id, avant, apres: a });
    res.json(a);
  } catch (e) { throw doublon(e); }
});

router.post('/acteurs/import/analyser', (req, res, next) => upload.single('fichier')(req, res, async (err) => {
  if (err) return next(err);
  try {
    exiger(req.ctx.can('donnees.annuaire'), 'L’annuaire est tenu par le Bureau Documentation et Information.');
    if (!req.file) throw badRequest('Aucun fichier transmis.');
    let r;
    try { r = await svc.analyserImport(req.file.buffer); } catch (e) { throw badRequest('Classeur illisible : vérifiez qu’il s’agit d’un fichier Excel (.xlsx).'); }
    if (r.erreur) throw badRequest(r.erreur);
    if (!r.lignes.length) throw badRequest('Aucune ligne d’acteur trouvée dans le classeur.');
    const compte = (e) => r.lignes.filter((l) => l.etat === e).length;
    res.json({ ...r, resume: { nouveaux: compte('NOUVEAU'), doublons: compte('DOUBLON'), erreurs: compte('ERREUR') } });
  } catch (e) { next(e); }
}));
router.post('/acteurs/import/confirmer', validate({ body: z.object({ acteurs: z.array(acteurSchema).min(1).max(2000), fichier: texte(200) }) }), async (req, res) => {
  exiger(req.ctx.can('donnees.annuaire'), 'L’annuaire est tenu par le Bureau Documentation et Information.');
  const n = await db.transaction(async (trx) => {
    let k = 0;
    for (const [i, a] of req.valid.body.acteurs.entries()) {
      try {
        await trx.raw('SAVEPOINT acteur');
        const [x] = await trx('sect_acteurs').insert({ ...a, reference: await nextReference('ACTEUR', 'DEP/ACT', trx), created_by: req.ctx.userId }).returning('*');
        await addHistory('ACTEUR', x.id, req.ctx.userId, { action: 'IMPORT', nouveau: x.statut, commentaire: req.valid.body.fichier ? `Import du classeur ${req.valid.body.fichier}` : 'Import' }, trx);
        await trx.raw('RELEASE SAVEPOINT acteur');
        k += 1;
      } catch (e) {
        await trx.raw('ROLLBACK TO SAVEPOINT acteur');
        const err = doublon(e);
        if (err !== e) { err.message = `${a.raison_sociale} (ligne ${i + 1} de la sélection) : ${err.message}`; }
        throw err;
      }
    }
    return k;
  });
  await audit(req, { action: 'IMPORT', module: 'donnees', entite: 'annuaire', message: `${n} acteur(s) importé(s)${req.valid.body.fichier ? ` depuis ${req.valid.body.fichier}` : ''}` });
  res.status(201).json({ importes: n });
});

// ─── Questionnaires ─────────────────────────────────────────────────────────
const codeQuestion = z.string().trim().toUpperCase().regex(/^[A-Z][A-Z0-9_]{0,29}$/, 'Code de question : lettre puis lettres, chiffres ou _ (30 au plus)');
const questionSchema = z.object({
  code: codeQuestion, libelle: z.string().trim().min(2).max(500), type: z.enum(svc.TYPES_QUESTION), obligatoire: z.boolean().default(false),
  section: texte(200), aide: texte(1000), unite: texte(40),
  min: z.number().finite().optional().nullable(), max: z.number().finite().optional().nullable(),
  options: z.array(z.string().trim().min(1).max(200)).max(50).optional(),
});
const controleSchema = z.object({ gauche: codeQuestion, operateur: z.enum(['<=', '>=', '=', '<', '>']), droite: z.union([codeQuestion, z.number().finite()]), message: texte(300) });
const versionSchema = z.object({ questions: z.array(questionSchema).max(300), controles: z.array(controleSchema).max(100).default([]) }).superRefine((v, ctx) => {
  const codes = new Set();
  v.questions.forEach((q, i) => {
    if (codes.has(q.code)) ctx.addIssue({ code: 'custom', path: ['questions', i, 'code'], message: `Code en double : ${q.code}` });
    codes.add(q.code);
    if (['CHOIX', 'CHOIX_MULTIPLE'].includes(q.type) && (!q.options || q.options.length < 2)) ctx.addIssue({ code: 'custom', path: ['questions', i, 'options'], message: `${q.code} : deux options au moins.` });
    if (q.min !== null && q.min !== undefined && q.max !== null && q.max !== undefined && q.min > q.max) ctx.addIssue({ code: 'custom', path: ['questions', i, 'min'], message: `${q.code} : minimum supérieur au maximum.` });
  });
  const numerique = (c) => v.questions.some((q) => q.code === c && svc.NUMERIQUES.includes(q.type));
  v.controles.forEach((c, i) => {
    if (!numerique(c.gauche) || (typeof c.droite === 'string' && !numerique(c.droite))) ctx.addIssue({ code: 'custom', path: ['controles', i], message: 'Un contrôle de cohérence porte sur des questions numériques.' });
  });
});

router.get('/questionnaires', async (req, res) => {
  const rows = await db('sect_questionnaires as q').orderBy('q.code').select('q.*',
    db.raw('(SELECT max(version) FROM sect_questionnaire_versions v WHERE v.questionnaire_id = q.id AND v.statut = \'PUBLIEE\') as version_publiee'),
    db.raw('(SELECT count(*) FROM sect_questionnaire_versions v WHERE v.questionnaire_id = q.id AND v.statut = \'BROUILLON\')::int as brouillons'),
    db.raw('(SELECT count(*) FROM sect_campagnes c JOIN sect_questionnaire_versions v ON v.id = c.version_id WHERE v.questionnaire_id = q.id)::int as campagnes'));
  res.json({ data: rows, droits: droits(req.ctx) });
});
router.post('/questionnaires', validate({ body: z.object({ code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{2,30}$/, 'Code : 2 à 30 lettres, chiffres, - ou _'), titre: z.string().trim().min(3).max(300), description: texte(5000) }) }), async (req, res) => {
  exiger(req.ctx.can('donnees.questionnaires'), 'Les questionnaires sont conçus par le Bureau Études, Analyses et Prospective.');
  try {
    const q = await db.transaction(async (trx) => {
      const [x] = await trx('sect_questionnaires').insert({ ...req.valid.body, created_by: req.ctx.userId }).returning('*');
      await trx('sect_questionnaire_versions').insert({ questionnaire_id: x.id, version: 1 });
      return x;
    });
    await audit(req, { action: 'CREATION', module: 'donnees', entite: 'questionnaire', entiteId: q.id, apres: q });
    res.status(201).json(q);
  } catch (e) { if (e.code === '23505') throw conflict('Ce code de questionnaire existe déjà.'); throw e; }
});
router.get('/questionnaires/:id', validate({ params: idParam }), async (req, res) => {
  const q = await db('sect_questionnaires').where({ id: req.valid.params.id }).first();
  if (!q) throw notFound('Questionnaire introuvable.');
  const versions = await db('sect_questionnaire_versions as v').leftJoin('users as u', 'u.id', 'v.publiee_par').leftJoin('agents as a', 'a.id', 'u.agent_id')
    .where('v.questionnaire_id', q.id).orderBy('v.version', 'desc')
    .select('v.*', db.raw(`concat_ws(' ', a.prenom, a.nom) as publiee_par_nom`), db.raw('(SELECT count(*) FROM sect_campagnes c WHERE c.version_id = v.id)::int as campagnes'));
  res.json({ ...q, versions, droits: droits(req.ctx) });
});
router.put('/questionnaires/:id', validate({ params: idParam, body: z.object({ titre: z.string().trim().min(3).max(300), description: texte(5000), actif: z.boolean().default(true) }) }), async (req, res) => {
  exiger(req.ctx.can('donnees.questionnaires'), 'Les questionnaires sont conçus par le Bureau Études, Analyses et Prospective.');
  const [q] = await db('sect_questionnaires').where({ id: req.valid.params.id }).update({ ...req.valid.body, updated_at: db.fn.now() }).returning('*');
  if (!q) throw notFound();
  await audit(req, { action: 'MODIFICATION', module: 'donnees', entite: 'questionnaire', entiteId: q.id, apres: q });
  res.json(q);
});
router.post('/questionnaires/:id/versions', validate({ params: idParam }), async (req, res) => {
  exiger(req.ctx.can('donnees.questionnaires'), 'Les questionnaires sont conçus par le Bureau Études, Analyses et Prospective.');
  const vs = await db('sect_questionnaire_versions').where({ questionnaire_id: req.valid.params.id }).orderBy('version', 'desc');
  if (!vs.length) throw notFound('Questionnaire introuvable.');
  if (vs.some((v) => v.statut === 'BROUILLON')) throw badRequest('Une version en préparation existe déjà : modifiez-la.');
  const [v] = await db('sect_questionnaire_versions').insert({ questionnaire_id: req.valid.params.id, version: vs[0].version + 1, questions: JSON.stringify(vs[0].questions), controles: JSON.stringify(vs[0].controles) }).returning('*');
  await audit(req, { action: 'CREATION', module: 'donnees', entite: 'questionnaire_version', entiteId: v.id, message: `Version ${v.version}` });
  res.status(201).json(v);
});
router.put('/versions/:id', validate({ params: idParam, body: versionSchema }), async (req, res) => {
  exiger(req.ctx.can('donnees.questionnaires'), 'Les questionnaires sont conçus par le Bureau Études, Analyses et Prospective.');
  const v = await db('sect_questionnaire_versions').where({ id: req.valid.params.id }).first();
  if (!v) throw notFound();
  if (v.statut !== 'BROUILLON') throw badRequest('Une version publiée est figée : créez une nouvelle version.');
  const [u] = await db('sect_questionnaire_versions').where({ id: v.id }).update({ questions: JSON.stringify(req.valid.body.questions), controles: JSON.stringify(req.valid.body.controles), updated_at: db.fn.now() }).returning('*');
  await audit(req, { action: 'MODIFICATION', module: 'donnees', entite: 'questionnaire_version', entiteId: v.id, message: `${req.valid.body.questions.length} question(s)` });
  res.json(u);
});
router.post('/versions/:id/publier', validate({ params: idParam }), async (req, res) => {
  exiger(req.ctx.can('donnees.questionnaires'), 'Les questionnaires sont conçus par le Bureau Études, Analyses et Prospective.');
  const v = await db('sect_questionnaire_versions').where({ id: req.valid.params.id }).first();
  if (!v) throw notFound();
  if (v.statut !== 'BROUILLON') throw badRequest('Version déjà publiée.');
  if (!v.questions.length) throw badRequest('Le questionnaire ne comporte aucune question.');
  const [u] = await db('sect_questionnaire_versions').where({ id: v.id }).update({ statut: 'PUBLIEE', publiee_par: req.ctx.userId, publiee_at: db.fn.now(), updated_at: db.fn.now() }).returning('*');
  await audit(req, { action: 'VALIDATION', module: 'donnees', entite: 'questionnaire_version', entiteId: v.id, message: `Version ${v.version} publiée` });
  res.json(u);
});

// ─── Campagnes ──────────────────────────────────────────────────────────────
const campagneSchema = z.object({
  titre: z.string().trim().min(3).max(300), version_id: z.coerce.number().int().positive(), periode: z.string().trim().min(2).max(40),
  periode_debut: dateIso, periode_fin: dateIso, echeance: dateIso, zones: z.array(z.coerce.number().int().positive()).max(100).default([]),
  categories: z.array(z.coerce.number().int().positive()).max(100).default([]), responsable_id: z.coerce.number().int().positive(), instructions: texte(10000),
}).refine((c) => c.periode_fin >= c.periode_debut, { message: 'La fin de période précède son début.', path: ['periode_fin'] });

function scopeCampagnes(qb, ctx) { return supervision(ctx) ? qb.where('c.statut', 'VALIDEE') : qb; }
async function chargerCampagne(ctx, id, trx = db) {
  const c = await scopeCampagnes(trx('sect_campagnes as c'), ctx).where('c.id', id).first('c.*');
  if (!c) throw notFound('Campagne introuvable.');
  return c;
}
function actionsCampagne(ctx, c) {
  const q = ctx.can('donnees.questionnaires');
  const resp = c.responsable_id === ctx.userId;
  return {
    modifier: q && c.statut === 'BROUILLON', cibler: q && ['BROUILLON', 'OUVERTE'].includes(c.statut), ouvrir: q && c.statut === 'BROUILLON',
    cloturer: (q || resp) && c.statut === 'OUVERTE', rouvrir: q && c.statut === 'CLOTUREE',
    valider: ctx.can('donnees.valider') && c.statut === 'CLOTUREE', retourner: ctx.can('donnees.valider') && c.statut === 'CLOTUREE',
    saisir: ctx.can('donnees.saisir') && c.statut === 'OUVERTE', controler: ctx.can('donnees.controler') && ['OUVERTE', 'CLOTUREE'].includes(c.statut),
  };
}
async function verifierVersion(id) {
  const v = await db('sect_questionnaire_versions').where({ id }).first();
  if (!v || v.statut !== 'PUBLIEE') throw badRequest('Choisissez une version publiée du questionnaire.');
  return v;
}

router.get('/campagnes', async (req, res) => {
  const rows = await scopeCampagnes(db('sect_campagnes as c'), req.ctx).join('sect_questionnaire_versions as v', 'v.id', 'c.version_id').join('sect_questionnaires as q', 'q.id', 'v.questionnaire_id')
    .leftJoin('users as u', 'u.id', 'c.responsable_id').leftJoin('agents as a', 'a.id', 'u.agent_id')
    .select('c.*', 'q.code as questionnaire_code', 'q.titre as questionnaire_titre', 'v.version', db.raw(`concat_ws(' ', a.prenom, a.nom) as responsable`),
      db.raw('(SELECT count(*) FROM sect_campagne_cibles k WHERE k.campagne_id = c.id)::int as cibles'),
      db.raw('(SELECT count(*) FROM sect_reponses r WHERE r.campagne_id = c.id)::int as reponses'),
      db.raw('(SELECT count(*) FROM sect_reponses r WHERE r.campagne_id = c.id AND r.statut = \'CONTROLEE\')::int as controlees'))
    .orderBy('c.periode_debut', 'desc').orderBy('c.id', 'desc');
  res.json({ data: rows, droits: droits(req.ctx) });
});
router.post('/campagnes', validate({ body: campagneSchema }), async (req, res) => {
  exiger(req.ctx.can('donnees.questionnaires'), 'Les campagnes sont organisées par le Bureau Études, Analyses et Prospective.');
  await verifierVersion(req.valid.body.version_id);
  if (!(await membresEdi()).some((n) => n.userId === req.valid.body.responsable_id)) throw badRequest('Le responsable doit appartenir à la Division Études, Documentation et Information.');
  const c = await db.transaction(async (trx) => {
    const [x] = await trx('sect_campagnes').insert({ ...req.valid.body, reference: await nextReference('CAMPAGNE', 'DEP/COL', trx), created_by: req.ctx.userId }).returning('*');
    const ids = await svc.acteursCibles(x, trx);
    if (ids.length) await trx('sect_campagne_cibles').insert(ids.map((a) => ({ campagne_id: x.id, acteur_id: a })));
    await addHistory('CAMPAGNE', x.id, req.ctx.userId, { action: 'CREATION', nouveau: 'BROUILLON', commentaire: `${ids.length} acteur(s) ciblé(s)` }, trx);
    return x;
  });
  await audit(req, { action: 'CREATION', module: 'donnees', entite: 'campagne', entiteId: c.id, apres: c });
  res.status(201).json(c);
});
router.get('/campagnes/:id', validate({ params: idParam }), async (req, res) => {
  const c = await chargerCampagne(req.ctx, req.valid.params.id);
  const version = await db('sect_questionnaire_versions as v').join('sect_questionnaires as q', 'q.id', 'v.questionnaire_id').where('v.id', c.version_id).first('v.*', 'q.code as questionnaire_code', 'q.titre as questionnaire_titre');
  const cibles = await db('sect_campagne_cibles as k').join('sect_acteurs as a', 'a.id', 'k.acteur_id').join('sect_categories as g', 'g.id', 'a.categorie_id').join('sect_zones as z', 'z.id', 'a.zone_id')
    .leftJoin('sect_reponses as r', function j() { this.on('r.campagne_id', 'k.campagne_id').andOn('r.acteur_id', 'k.acteur_id'); })
    .where('k.campagne_id', c.id).orderBy('a.raison_sociale')
    .select('a.id', 'a.reference', 'a.raison_sociale', 'a.sigle', 'g.libelle as categorie', 'z.libelle as zone', 'r.id as reponse_id', 'r.statut as reponse_statut', 'r.anomalies', 'r.saisi_par');
  const responsable = await db('users as u').leftJoin('agents as a', 'a.id', 'u.agent_id').where('u.id', c.responsable_id).first(db.raw(`concat_ws(' ', a.prenom, a.nom) as nom`));
  res.json({
    ...c, responsable: responsable?.nom, version, historique: await getHistory('CAMPAGNE', c.id), actions: actionsCampagne(req.ctx, c), droits: droits(req.ctx),
    cibles: cibles.map((k) => ({ ...k, erreurs: (k.anomalies || []).filter((a) => a.niveau === 'ERREUR').length, alertes: (k.anomalies || []).filter((a) => a.niveau === 'ALERTE').length, anomalies: undefined })),
  });
});
router.put('/campagnes/:id', validate({ params: idParam, body: campagneSchema }), async (req, res) => {
  const c = await chargerCampagne(req.ctx, req.valid.params.id);
  exiger(actionsCampagne(req.ctx, c).modifier, 'Seule une campagne en préparation se modifie.');
  await verifierVersion(req.valid.body.version_id);
  if (!(await membresEdi()).some((n) => n.userId === req.valid.body.responsable_id)) throw badRequest('Le responsable doit appartenir à la Division Études, Documentation et Information.');
  const [u] = await db('sect_campagnes').where({ id: c.id }).update({ ...req.valid.body, updated_at: db.fn.now() }).returning('*');
  await addHistory('CAMPAGNE', c.id, req.ctx.userId, { action: 'MODIFICATION', commentaire: 'Paramètres de la campagne modifiés' });
  await audit(req, { action: 'MODIFICATION', module: 'donnees', entite: 'campagne', entiteId: c.id, avant: c, apres: u });
  res.json(u);
});

// Ciblage : selon les zones et catégories de la campagne, ou acteur par acteur
router.post('/campagnes/:id/cibles', validate({ params: idParam, body: z.object({ generer: z.boolean().optional(), acteurs: z.array(z.coerce.number().int().positive()).max(5000).optional() }) }), async (req, res) => {
  const c = await chargerCampagne(req.ctx, req.valid.params.id);
  exiger(actionsCampagne(req.ctx, c).cibler, 'Le ciblage se modifie tant que la campagne est en préparation ou ouverte.');
  const ids = req.valid.body.generer ? await svc.acteursCibles(c) : req.valid.body.acteurs || [];
  if (!req.valid.body.generer && (await db('sect_acteurs').whereIn('id', ids).count('* as n').first()).n !== String(ids.length)) throw badRequest('Acteur inconnu.');
  const avant = Number((await db('sect_campagne_cibles').where({ campagne_id: c.id }).count('* as n').first()).n);
  if (ids.length) await db('sect_campagne_cibles').insert(ids.map((a) => ({ campagne_id: c.id, acteur_id: a }))).onConflict(['campagne_id', 'acteur_id']).ignore();
  const apres = Number((await db('sect_campagne_cibles').where({ campagne_id: c.id }).count('* as n').first()).n);
  await addHistory('CAMPAGNE', c.id, req.ctx.userId, { action: 'CIBLAGE', commentaire: `${apres - avant} acteur(s) ajouté(s) — ${apres} ciblé(s)` });
  res.json({ ajoutes: apres - avant, cibles: apres });
});
router.delete('/campagnes/:id/cibles/:acteur', validate({ params: idParam.extend({ acteur: z.coerce.number().int().positive() }) }), async (req, res) => {
  const c = await chargerCampagne(req.ctx, req.valid.params.id);
  exiger(actionsCampagne(req.ctx, c).cibler, 'Le ciblage se modifie tant que la campagne est en préparation ou ouverte.');
  if (await db('sect_reponses').where({ campagne_id: c.id, acteur_id: req.valid.params.acteur }).first()) throw badRequest('Une réponse a été saisie pour cet acteur : supprimez-la d’abord.');
  await db('sect_campagne_cibles').where({ campagne_id: c.id, acteur_id: req.valid.params.acteur }).del();
  await addHistory('CAMPAGNE', c.id, req.ctx.userId, { action: 'CIBLAGE', commentaire: 'Acteur retiré du ciblage' });
  res.json({ ok: true });
});

const ETAPES = {
  ouvrir: { droit: 'ouvrir', vers: 'OUVERTE', action: 'OUVERTURE', patch: { ouverte_at: db.fn.now() } },
  cloturer: { droit: 'cloturer', vers: 'CLOTUREE', action: 'CLOTURE', patch: { cloturee_at: db.fn.now() } },
  rouvrir: { droit: 'rouvrir', vers: 'OUVERTE', action: 'REOUVERTURE' },
  valider: { droit: 'valider', vers: 'VALIDEE', action: 'VALIDATION' },
};
for (const [nom, e] of Object.entries(ETAPES)) {
  router.post(`/campagnes/:id/${nom}`, validate({ params: idParam }), async (req, res) => {
    const c = await chargerCampagne(req.ctx, req.valid.params.id);
    exiger(actionsCampagne(req.ctx, c)[e.droit], 'Opération impossible à cette étape.');
    if (nom === 'ouvrir') {
      if (!(await db('sect_campagne_cibles').where({ campagne_id: c.id }).first())) throw badRequest('Aucun acteur ciblé : complétez le ciblage avant d’ouvrir la campagne.');
      await verifierVersion(c.version_id);
    }
    if (nom === 'valider') {
      const s = await db('sect_reponses').where({ campagne_id: c.id }).select('statut');
      if (!s.length) throw badRequest('Aucune réponse n’a été saisie.');
      const restantes = s.filter((r) => r.statut !== 'CONTROLEE').length;
      if (restantes) throw badRequest(`${restantes} réponse(s) ne sont pas contrôlées.`);
    }
    const patch = nom === 'valider' ? { validee_par: req.ctx.userId, validee_at: db.fn.now() } : e.patch || {};
    const [u] = await db('sect_campagnes').where({ id: c.id }).update({ statut: e.vers, ...patch, updated_at: db.fn.now() }).returning('*');
    await addHistory('CAMPAGNE', c.id, req.ctx.userId, { action: e.action, ancien: c.statut, nouveau: e.vers });
    await audit(req, { action: nom === 'valider' ? 'VALIDATION' : 'MODIFICATION', module: 'donnees', entite: 'campagne', entiteId: c.id, message: `${c.reference} : ${nom}` });
    const lien = `/donnees/campagnes/${c.id}`;
    let to = [];
    let titre = '';
    if (nom === 'ouvrir') { to = (await membresEdi({ chef: false })).map((n) => n.userId).concat(c.responsable_id); titre = `Campagne ouverte : ${c.titre}`; }
    if (nom === 'cloturer') { to = await validateurs(); titre = `Campagne à valider : ${c.titre}`; }
    if (nom === 'valider') { to = [c.responsable_id, c.created_by]; titre = `Campagne validée : ${c.titre}`; }
    to = [...new Set(to)].filter((x) => x && x !== req.ctx.userId);
    if (to.length) await notify(to, { type: 'DONNEES', titre, message: `${c.reference} — période ${c.periode}`, lien, expediteur: req.ctx.userId });
    res.json(u);
  });
}
router.post('/campagnes/:id/retourner', validate({ params: idParam, body: z.object({ motif: z.string().trim().min(3).max(5000) }) }), async (req, res) => {
  const c = await chargerCampagne(req.ctx, req.valid.params.id);
  exiger(actionsCampagne(req.ctx, c).retourner, 'Opération impossible à cette étape.');
  const [u] = await db('sect_campagnes').where({ id: c.id }).update({ statut: 'OUVERTE', observations: req.valid.body.motif, updated_at: db.fn.now() }).returning('*');
  await addHistory('CAMPAGNE', c.id, req.ctx.userId, { action: 'RETOUR_CORRECTION', ancien: c.statut, nouveau: 'OUVERTE', commentaire: req.valid.body.motif });
  await audit(req, { action: 'MODIFICATION', module: 'donnees', entite: 'campagne', entiteId: c.id, message: 'Retour pour compléments' });
  const to = [c.responsable_id, c.created_by].filter((x) => x !== req.ctx.userId);
  if (to.length) await notify([...new Set(to)], { type: 'DONNEES', titre: `Campagne retournée : ${c.titre}`, message: req.valid.body.motif, lien: `/donnees/campagnes/${c.id}`, expediteur: req.ctx.userId });
  res.json(u);
});
router.get('/campagnes/:id/export', requirePerm('exports.generer'), validate({ params: idParam }), async (req, res) => {
  const c = await chargerCampagne(req.ctx, req.valid.params.id);
  const version = await db('sect_questionnaire_versions').where({ id: c.version_id }).first();
  const cibles = await db('sect_campagne_cibles as k').join('sect_acteurs as a', 'a.id', 'k.acteur_id').join('sect_categories as g', 'g.id', 'a.categorie_id').join('sect_zones as z', 'z.id', 'a.zone_id')
    .leftJoin('sect_reponses as r', function j() { this.on('r.campagne_id', 'k.campagne_id').andOn('r.acteur_id', 'k.acteur_id'); })
    .where('k.campagne_id', c.id).orderBy('a.raison_sociale')
    .select('a.reference', 'a.raison_sociale', 'g.libelle as categorie', 'z.libelle as zone', 'r.statut', 'r.valeurs', 'r.anomalies');
  await audit(req, { action: 'EXPORT', module: 'donnees', entite: 'campagne', entiteId: c.id, message: c.reference });
  xlsx(res, `Campagne-${c.reference.replace(/\//g, '-')}`, await svc.exporterReponses(c, version, cibles.map((k) => ({ ...k, reponse: k.statut ? { statut: k.statut, valeurs: k.valeurs, anomalies: k.anomalies } : null }))));
});

// ─── Réponses ───────────────────────────────────────────────────────────────
const reponseParams = idParam.extend({ acteur: z.coerce.number().int().positive() });
async function contexteReponse(req) {
  const c = await chargerCampagne(req.ctx, req.valid.params.id);
  if (!(await db('sect_campagne_cibles').where({ campagne_id: c.id, acteur_id: req.valid.params.acteur }).first())) throw notFound('Cet acteur n’est pas ciblé par la campagne.');
  const [version, acteur, r] = await Promise.all([
    db('sect_questionnaire_versions').where({ id: c.version_id }).first(),
    db('sect_acteurs as a').join('sect_categories as g', 'g.id', 'a.categorie_id').join('sect_zones as z', 'z.id', 'a.zone_id').where('a.id', req.valid.params.acteur).first('a.id', 'a.reference', 'a.raison_sociale', 'a.sigle', 'g.libelle as categorie', 'z.libelle as zone'),
    db('sect_reponses').where({ campagne_id: c.id, acteur_id: req.valid.params.acteur }).first(),
  ]);
  return { c, version, acteur, r };
}
function actionsReponse(ctx, c, r) {
  const a = actionsCampagne(ctx, c);
  const modifiable = !r || ['BROUILLON', 'A_CORRIGER'].includes(r.statut);
  return {
    saisir: a.saisir && modifiable, soumettre: a.saisir && !!r && modifiable,
    controler: a.controler && r?.statut === 'SAISIE' && r.saisi_par !== ctx.userId,
    supprimer: !!r && r.statut === 'BROUILLON' && c.statut === 'OUVERTE' && (r.saisi_par === ctx.userId || ctx.can('donnees.questionnaires')),
  };
}
router.get('/campagnes/:id/reponses/:acteur', validate({ params: reponseParams }), async (req, res) => {
  const { c, version, acteur, r } = await contexteReponse(req);
  const saisiPar = r ? await db('users as u').leftJoin('agents as a', 'a.id', 'u.agent_id').where('u.id', r.saisi_par).first(db.raw(`concat_ws(' ', a.prenom, a.nom) as nom`)) : null;
  res.json({
    campagne: { id: c.id, reference: c.reference, titre: c.titre, periode: c.periode, statut: c.statut }, version, acteur,
    reponse: r ? { ...r, saisi_par_nom: saisiPar?.nom } : null, precedent: await svc.precedent(c, acteur.id),
    historique: r ? await getHistory('REPONSE_SECT', r.id) : [], actions: actionsReponse(req.ctx, c, r),
  });
});
router.put('/campagnes/:id/reponses/:acteur', validate({ params: reponseParams, body: z.object({
  valeurs: z.record(z.string(), z.any()), source: z.enum(['PAPIER', 'FICHIER', 'COURRIEL', 'ENTRETIEN']), date_reception: dateIso.optional().nullable(),
  justification: texte(5000), observations: texte(5000),
}) }), async (req, res) => {
  const { c, version, acteur, r } = await contexteReponse(req);
  exiger(actionsReponse(req.ctx, c, r).saisir, r && !['BROUILLON', 'A_CORRIGER'].includes(r.statut) ? 'Réponse déjà transmise au contrôle.' : 'La saisie est réservée aux Bureaux de la Division Études, Documentation et Information, campagne ouverte.');
  const valeurs = svc.normaliser(version, req.valid.body.valeurs);
  const anomalies = svc.anomalies(version, valeurs, await svc.precedent(c, acteur.id));
  const donnees = { valeurs: JSON.stringify(valeurs), anomalies: JSON.stringify(anomalies), source: req.valid.body.source, date_reception: req.valid.body.date_reception || null, justification: req.valid.body.justification, observations: req.valid.body.observations, updated_at: db.fn.now() };
  const u = await db.transaction(async (trx) => {
    if (r) { const [x] = await trx('sect_reponses').where({ id: r.id }).update(donnees).returning('*'); return x; }
    const [x] = await trx('sect_reponses').insert({ ...donnees, campagne_id: c.id, acteur_id: acteur.id, saisi_par: req.ctx.userId }).returning('*');
    await addHistory('REPONSE_SECT', x.id, req.ctx.userId, { action: 'SAISIE', nouveau: 'BROUILLON' }, trx);
    return x;
  });
  await audit(req, { action: r ? 'MODIFICATION' : 'CREATION', module: 'donnees', entite: 'reponse', entiteId: u.id, message: `${c.reference} — ${acteur.raison_sociale}` });
  res.json(u);
});
router.post('/campagnes/:id/reponses/:acteur/soumettre', validate({ params: reponseParams }), async (req, res) => {
  const { c, acteur, r } = await contexteReponse(req);
  exiger(actionsReponse(req.ctx, c, r).soumettre, 'Opération impossible à cette étape.');
  const erreurs = r.anomalies.filter((a) => a.niveau === 'ERREUR');
  if (erreurs.length) throw badRequest(`${erreurs.length} erreur(s) à corriger avant transmission au contrôle.`);
  if (r.anomalies.some((a) => a.niveau === 'ALERTE') && !r.justification) throw badRequest('Justifiez les alertes maintenues avant transmission au contrôle.');
  const [u] = await db('sect_reponses').where({ id: r.id }).update({ statut: 'SAISIE', saisi_at: db.fn.now(), updated_at: db.fn.now() }).returning('*');
  await addHistory('REPONSE_SECT', r.id, req.ctx.userId, { action: 'SOUMISSION', ancien: r.statut, nouveau: 'SAISIE' });
  await audit(req, { action: 'MODIFICATION', module: 'donnees', entite: 'reponse', entiteId: r.id, message: `${c.reference} — ${acteur.raison_sociale} : transmise au contrôle` });
  const to = (await membresEdi({ bureaux: ['BUR-DOI'] })).map((n) => n.userId).filter((x) => x !== req.ctx.userId);
  if (to.length) await notify([...new Set(to)], { type: 'DONNEES', titre: `Réponse à contrôler : ${acteur.raison_sociale}`, message: `${c.reference} — ${c.titre}`, lien: `/donnees/campagnes/${c.id}/reponses/${acteur.id}`, expediteur: req.ctx.userId });
  res.json(u);
});
router.post('/campagnes/:id/reponses/:acteur/controler', validate({ params: reponseParams, body: z.object({ decision: z.enum(['CONTROLEE', 'A_CORRIGER']), motif: texte(5000) }) }), async (req, res) => {
  const { c, acteur, r } = await contexteReponse(req);
  const a = actionsReponse(req.ctx, c, r);
  if (!a.controler && r?.statut === 'SAISIE' && r.saisi_par === req.ctx.userId) throw forbidden('Le contrôle est assuré par une autre personne que celle qui a saisi la réponse.');
  exiger(a.controler, 'Le contrôle est assuré par le Bureau Documentation et Information.');
  const { decision, motif } = req.valid.body;
  if (decision === 'A_CORRIGER' && !motif) throw badRequest('Indiquez les corrections demandées.');
  const [u] = await db('sect_reponses').where({ id: r.id }).update({ statut: decision, controle_par: req.ctx.userId, controle_at: db.fn.now(), observations: decision === 'A_CORRIGER' ? motif : r.observations, updated_at: db.fn.now() }).returning('*');
  await addHistory('REPONSE_SECT', r.id, req.ctx.userId, { action: decision === 'CONTROLEE' ? 'CONTROLE' : 'RETOUR_CORRECTION', ancien: r.statut, nouveau: decision, commentaire: motif });
  await audit(req, { action: 'MODIFICATION', module: 'donnees', entite: 'reponse', entiteId: r.id, message: `${c.reference} — ${acteur.raison_sociale} : ${decision === 'CONTROLEE' ? 'contrôlée' : 'à corriger'}` });
  if (decision === 'A_CORRIGER') await notify(r.saisi_par, { type: 'DONNEES', titre: `Réponse à corriger : ${acteur.raison_sociale}`, message: motif, lien: `/donnees/campagnes/${c.id}/reponses/${acteur.id}`, expediteur: req.ctx.userId });
  res.json(u);
});
router.delete('/campagnes/:id/reponses/:acteur', validate({ params: reponseParams }), async (req, res) => {
  const { c, acteur, r } = await contexteReponse(req);
  exiger(r && actionsReponse(req.ctx, c, r).supprimer, 'Seul un brouillon de réponse se supprime, par son auteur ou le Bureau Études, Analyses et Prospective.');
  await db('attachments').where({ entity_type: 'REPONSE_SECT', entity_id: r.id }).whereNull('deleted_at').first().then((x) => { if (x) throw badRequest('Retirez d’abord les pièces jointes de la réponse.'); });
  await db('sect_reponses').where({ id: r.id }).del();
  await audit(req, { action: 'SUPPRESSION', module: 'donnees', entite: 'reponse', entiteId: r.id, avant: r, message: `${c.reference} — ${acteur.raison_sociale}` });
  res.json({ ok: true });
});

module.exports = router;
module.exports.scopeCampagnes = scopeCampagnes;

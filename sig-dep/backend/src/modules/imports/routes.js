'use strict';
/**
 * Import du personnel (liste officielle Word, Excel ou CSV).
 *  1. POST /api/imports/personnel/analyser : lecture du fichier, propositions et anomalies (aucune écriture) ;
 *  2. POST /api/imports/personnel/executer : création des Agents et affectations, revalidées côté serveur,
 *     en une seule transaction (tout ou rien).
 * Le fichier n’est jamais conservé sur le serveur.
 */
const express = require('express');
const multer = require('multer');
const { z } = require('zod');
const db = require('../../db/knex');
const validate = require('../../middleware/validate');
const { audit } = require('../../services/audit');
const { readRows, analyse, normalizeMatricule } = require('../../services/importAgents');
const { sendWorkbook } = require('../../services/excel');
const { badRequest, forbidden, AppError } = require('../../utils/errors');

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => (/\.(docx|xlsx|csv|txt)$/i.test(file.originalname) ? cb(null, true) : cb(badRequest('Format non pris en charge : fichier Word (.docx), Excel (.xlsx) ou CSV attendu.'))),
});

function assertCanImport(ctx) {
  if (!ctx.can('personnel.gerer') && !ctx.can('personnel.suivre') && !ctx.can('liste.gerer')) throw forbidden('L’import du personnel est réservé à l’Admin, au Directeur et au Bureau Secrétariat de Direction (sur désignation).', 'PERMISSION_REQUISE');
}

async function referentiel() {
  const [bureaux, divisions, grades, agents, chefs] = await Promise.all([
    db('bureaux').where({ actif: true }).orderBy(['parent_type', 'ordre']),
    db('divisions').where({ actif: true }).orderBy('ordre'),
    db('grades').where({ actif: true }).orderBy('niveau', 'desc'),
    db('agents').select('id', 'matricule', 'nom', 'prenom'),
    db('affectations as a').join('postes_organiques as p', 'p.id', 'a.poste_id').where('a.est_active', true)
      .whereIn('p.role_associe', ['CHEF_BUREAU', 'CHEF_DIVISION']).select('a.agent_id', 'a.bureau_id', 'a.division_id', 'p.role_associe'),
  ]);
  const existants = new Map(agents.map((a) => [normalizeMatricule(a.matricule), a]));
  const chefsEnPoste = new Map(chefs.map((c) => [c.role_associe === 'CHEF_BUREAU' ? `BUR:${c.bureau_id}` : `DIV:${c.division_id}`, c.agent_id]));
  return { bureaux, divisions, grades, existants, chefsEnPoste };
}

router.get('/personnel/modele.xlsx', async (req, res) => {
  assertCanImport(req.ctx);
  const ref = await referentiel();
  const rows = [];
  const intitule = (x) => (x.code_organique ? `${x.code_organique} ${x.nom}` : x.nom);
  for (const b of ref.bureaux.filter((x) => x.parent_type === 'DIRECTION')) rows.push({ section: intitule(b) });
  ref.divisions.forEach((d) => {
    rows.push({ section: intitule(d) });
    ref.bureaux.filter((b) => b.division_id === d.id).forEach((b) => rows.push({ section: intitule(b) }));
  });
  await audit(req, { action: 'EXPORT', module: 'personnel', message: 'Modèle d’import du personnel' });
  return sendWorkbook(res, 'modele-import-personnel-DEP.xlsx', [
    {
      name: 'Personnel', titre: 'Liste du personnel — modèle d’import',
      sousTitre: 'Une ligne de section par structure (déjà préremplie), puis une ligne par Agent. Grades : codes du référentiel (CD, CB, ATA1, ATA2, AGA1, AGA2, AA1, AA2…).',
      columns: [
        { header: 'N°', value: (r) => (r.section ? r.section : ''), width: 50 },
        { header: 'NOM, POSTNOM & PRENOM', key: 'x', width: 34 }, { header: 'MATRICULE', key: 'x', width: 14 },
        { header: 'GRADE', key: 'x', width: 10 }, { header: 'SEXE', key: 'x', width: 8 },
        { header: 'TELEPHONE', key: 'x', width: 16 }, { header: 'E-MAIL', key: 'x', width: 30 },
      ],
      rows,
    },
    {
      name: 'Grades', titre: 'Référentiel des grades',
      columns: [{ header: 'Code', key: 'code', width: 10 }, { header: 'Grade', key: 'libelle', width: 44 }, { header: 'Catégorie', key: 'categorie', width: 26 }],
      rows: ref.grades,
    },
  ]);
});

router.post('/personnel/analyser', (req, res, next) => {
  try { assertCanImport(req.ctx); } catch (e) { return next(e); }
  return upload.single('fichier')(req, res, async (err) => {
    if (err) return next(err);
    try {
      if (!req.file) throw badRequest('Aucun fichier transmis.');
      let parsed;
      try { parsed = await readRows(req.file.buffer, req.file.originalname); } catch (e) { throw badRequest(e.message); }
      const ref = await referentiel();
      let result;
      try {
        result = analyse(parsed.rows, { ...ref, chefsEnPoste: new Set(ref.chefsEnPoste.keys()) });
      } catch (e) { throw badRequest(e.message); }
      await audit(req, { action: 'IMPORT_ANALYSE', module: 'personnel', message: `${req.file.originalname} : ${result.resume.total} ligne(s), ${result.resume.erreurs} en erreur` });
      return res.json({
        fichier: req.file.originalname, format: parsed.format, ...result,
        referentiel: {
          structures: [
            ...ref.bureaux.filter((b) => b.parent_type === 'DIRECTION').map((b) => ({ type: 'BUREAU', id: b.id, nom: b.nom, groupe: 'Rattachés au Directeur' })),
            ...ref.divisions.flatMap((d) => [{ type: 'DIVISION', id: d.id, nom: d.nom, groupe: d.nom }, ...ref.bureaux.filter((b) => b.division_id === d.id).map((b) => ({ type: 'BUREAU', id: b.id, nom: b.nom, groupe: d.nom }))]),
          ],
          grades: ref.grades.map((g) => ({ id: g.id, code: g.code, libelle: g.libelle })),
        },
        peutAffecter: req.ctx.can('affectations.gerer') || req.ctx.can('liste.gerer'),
      });
    } catch (e) { return next(e); }
  });
});

const ligneSchema = z.object({
  ligne: z.number().int().optional(),
  matricule: z.string().trim().min(1).max(40),
  nom: z.string().trim().min(1).max(100),
  postnom: z.string().trim().max(100).nullable().optional(),
  prenom: z.string().trim().max(100).nullable().optional(),
  sexe: z.enum(['M', 'F']).nullable().optional(),
  grade_id: z.number().int().positive().nullable().optional(),
  telephone: z.string().trim().max(40).nullable().optional(),
  email: z.union([z.email(), z.literal('')]).nullable().optional(),
  structure_type: z.enum(['BUREAU', 'DIVISION']).nullable().optional(),
  structure_id: z.number().int().positive().nullable().optional(),
  role: z.enum(['CHEF_DIVISION', 'CHEF_BUREAU', 'AGENT']).nullable().optional(),
});

router.post('/personnel/executer', validate({ body: z.object({
  fichier: z.string().max(255).optional(),
  date_affectation: z.string().date(),
  mode_existants: z.enum(['ignorer', 'mettre_a_jour']).default('ignorer'),
  lignes: z.array(ligneSchema).min(1).max(2000),
}) }), async (req, res) => {
  assertCanImport(req.ctx);
  const { lignes, date_affectation: dateAff, mode_existants: mode } = req.valid.body;
  // La liste déclarative (avec affectations) est constituée par le Directeur ou l’Admin, puis validée par le Directeur.
  const affecter = req.ctx.can('affectations.gerer') || req.ctx.can('liste.gerer');
  const ref = await referentiel();
  const bureaux = new Map(ref.bureaux.map((b) => [b.id, b]));
  const divisions = new Map(ref.divisions.map((d) => [d.id, d]));
  const grades = new Set(ref.grades.map((g) => g.id));
  const dep = await db('directions').where({ code: 'DEP' }).first();
  const postes = await db('postes_organiques').where({ actif: true });

  // ─── Revalidation complète (le client n’est jamais une barrière de sécurité) ───
  const erreurs = [];
  const vus = new Set();
  const chefs = new Map(ref.chefsEnPoste);
  const plan = lignes.map((l, i) => {
    const num = l.ligne || i + 1;
    const err = (m) => erreurs.push({ ligne: num, matricule: l.matricule, message: m });
    const matricule = normalizeMatricule(l.matricule);
    if (vus.has(matricule)) err('Matricule en double.');
    vus.add(matricule);
    if (l.grade_id && !grades.has(l.grade_id)) err('Grade inconnu.');
    const existant = ref.existants.get(matricule);
    let poste = null; let structure = null;
    if (l.structure_type && l.structure_id) {
      structure = l.structure_type === 'BUREAU' ? bureaux.get(l.structure_id) : divisions.get(l.structure_id);
      if (!structure) err('Structure inconnue ou archivée.');
      else if (l.structure_type === 'DIVISION' && l.role !== 'CHEF_DIVISION') err('Au niveau d’une Division, seul le Chef de Division peut être affecté : choisissez un Bureau.');
      else if (l.structure_type === 'BUREAU' && !['CHEF_BUREAU', 'AGENT'].includes(l.role)) err('Dans un Bureau, le poste doit être Chef de Bureau ou Agent.');
      else {
        poste = l.structure_type === 'BUREAU'
          ? postes.find((p) => p.bureau_id === structure.id && p.role_associe === l.role)
          : postes.find((p) => p.niveau === 'DIVISION' && p.division_id === structure.id && p.role_associe === 'CHEF_DIVISION');
        if (!poste) err('Aucun poste organique correspondant dans cette structure.');
        if (l.role === 'CHEF_BUREAU' || l.role === 'CHEF_DIVISION') {
          const key = `${l.role === 'CHEF_BUREAU' ? 'BUR' : 'DIV'}:${structure.id}`;
          if (chefs.has(key) && (!existant || chefs.get(key) !== existant.id)) err('Cette structure a déjà un responsable (dans SIG-DEP ou plus haut dans le fichier).');
          chefs.set(key, existant ? existant.id : `ligne-${num}`);
        }
      }
    }
    return { l, num, matricule, existant, structure, poste };
  });
  if (erreurs.length) {
    throw new AppError(400, 'IMPORT_INVALIDE', `${erreurs.length} ligne(s) à corriger avant l’import.`, erreurs);
  }

  const rapport = { crees: 0, misAJour: 0, ignores: 0, affectations: 0, sansAffectation: 0, details: [] };
  await db.transaction(async (trx) => {
    for (const p of plan) {
      const { l } = p;
      const data = {
        nom: l.nom.toUpperCase(), postnom: l.postnom ? l.postnom.toUpperCase() : null, prenom: l.prenom || null,
        sexe: l.sexe || null, grade_id: l.grade_id || null, telephone: l.telephone || null, email: l.email || null,
        liste_declarative: true,
      };
      if (l.role === 'CHEF_BUREAU') data.fonction_id = (await trx('fonctions').where({ code: 'F-CB' }).first() || {}).id || null;
      if (l.role === 'CHEF_DIVISION') data.fonction_id = (await trx('fonctions').where({ code: 'F-CD' }).first() || {}).id || null;
      let agentId;
      if (p.existant) {
        if (mode === 'ignorer') { rapport.ignores += 1; rapport.details.push({ ligne: p.num, matricule: p.matricule, resultat: 'Ignoré (matricule existant)' }); continue; }
        const patch = Object.fromEntries(Object.entries(data).filter(([, v]) => v !== null));
        await trx('agents').where({ id: p.existant.id }).update({ ...patch, updated_at: trx.fn.now() });
        agentId = p.existant.id;
        rapport.misAJour += 1;
      } else {
        const [a] = await trx('agents').insert({ matricule: p.matricule, ...data, statut: 'ACTIF' }).returning('id');
        agentId = a.id;
        rapport.crees += 1;
      }
      let resultat = p.existant ? 'Mis à jour' : 'Créé';
      if (affecter && p.poste) {
        const cur = await trx('affectations').where({ agent_id: agentId, est_active: true }).first();
        if (!cur || cur.poste_id !== p.poste.id) {
          if (cur) await trx('affectations').where({ id: cur.id }).update({ est_active: false, date_fin: dateAff < cur.date_debut ? cur.date_debut : dateAff, motif_cloture: 'Import de la liste du personnel', closed_by: req.ctx.userId });
          await trx('affectations').insert({
            agent_id: agentId, direction_id: dep.id, niveau: p.structure.parent_type ? 'BUREAU' : 'DIVISION',
            bureau_id: p.structure.parent_type ? p.structure.id : null, division_id: p.structure.parent_type ? p.structure.division_id : p.structure.id,
            poste_id: p.poste.id, date_debut: dateAff, motif: 'Import de la liste du personnel', created_by: req.ctx.userId,
          });
          rapport.affectations += 1;
          resultat += ` et affecté (${p.poste.libelle})`;
        } else resultat += ' (affectation inchangée)';
      } else {
        rapport.sansAffectation += 1;
        resultat += affecter ? ' sans affectation (structure non choisie)' : ' sans affectation (droit d’affectation requis)';
      }
      rapport.details.push({ ligne: p.num, matricule: p.matricule, resultat });
    }
  });
  await audit(req, { action: 'IMPORT', module: 'personnel', apres: { crees: rapport.crees, misAJour: rapport.misAJour, ignores: rapport.ignores, affectations: rapport.affectations }, message: `Import du personnel${req.valid.body.fichier ? ` (${req.valid.body.fichier})` : ''}` });
  res.status(201).json(rapport);
});

module.exports = router;

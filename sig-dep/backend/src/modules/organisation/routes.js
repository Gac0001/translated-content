'use strict';
/**
 * Organisation administrative : organigramme, structures, cadre organique.
 * Le rang organique et le rattachement hiérarchique sont toujours présentés séparément.
 * Le Bureau Secrétariat de Direction n’apparaît jamais dans la liste des Divisions.
 */
const express = require('express');
const { z } = require('zod');
const db = require('../../db/knex');
const validate = require('../../middleware/validate');
const { requirePerm } = require('../../middleware/auth');
const { audit } = require('../../services/audit');
const { notFound, badRequest, forbidden } = require('../../utils/errors');
const { DEP_NOM } = require('../../constants');

const router = express.Router();
const id = z.object({ id: z.coerce.number().int().positive() });

const agentName = (r) => [r.prenom, r.nom, r.postnom].filter(Boolean).join(' ');

async function activeAssignments() {
  return db('affectations as a')
    .join('agents as ag', 'ag.id', 'a.agent_id')
    .leftJoin('postes_organiques as p', 'p.id', 'a.poste_id')
    .leftJoin('grades as g', 'g.id', 'ag.grade_id')
    .leftJoin('fonctions as f', 'f.id', 'ag.fonction_id')
    .where('a.est_active', true).whereNull('ag.archived_at')
    .select('a.*', 'ag.nom', 'ag.postnom', 'ag.prenom', 'ag.matricule', 'ag.sexe', 'ag.photo_path',
      'p.libelle as poste', 'p.role_associe', 'g.libelle as grade', 'f.libelle as fonction')
    .orderBy('ag.nom');
}

function personView(a) {
  return a ? { agentId: a.agent_id, nomComplet: agentName(a), matricule: a.matricule, poste: a.poste, grade: a.grade, fonction: a.fonction, hasPhoto: !!a.photo_path } : null;
}

async function attributionsFor(where) {
  return db('attributions').where({ actif: true, ...where }).orderBy(['categorie', 'ordre']).select('id', 'categorie', 'libelle', 'description', 'ordre');
}

function rattachementLabel(b, divisionsById) {
  return b.parent_type === 'DIRECTION'
    ? 'Bureau directement rattaché au Directeur'
    : `Rattaché à la ${divisionsById[b.division_id] ? divisionsById[b.division_id].nom : 'Division'}`;
}

/** Organigramme interactif complet. */
router.get('/organigramme', requirePerm('organisation.consulter'), async (req, res) => {
  const dep = await db('directions').where({ code: 'DEP' }).first();
  const divisions = await db('divisions').where({ direction_id: dep.id, actif: true }).orderBy('ordre');
  const bureaux = await db('bureaux').where({ direction_id: dep.id, actif: true }).orderBy('ordre');
  const aff = await activeAssignments();
  const attrs = await db('attributions').where({ actif: true }).orderBy('ordre');
  const divisionsById = Object.fromEntries(divisions.map((d) => [d.id, d]));
  const showAgents = req.ctx.perimetre !== 'SYSTEME';

  const bureauView = (b) => {
    const members = aff.filter((a) => a.bureau_id === b.id);
    const chef = members.find((a) => a.role_associe === 'CHEF_BUREAU');
    return {
      id: b.id, code: b.code, nom: b.nom,
      typeStructure: b.type_structure, rangOrganique: b.rang_organique,
      rattachement: { parentType: b.parent_type, divisionId: b.division_id, superieurDirect: b.superieur_direct, libelle: rattachementLabel(b, divisionsById) },
      perimetreAcces: b.perimetre_acces, responsableRole: b.responsable_role, responsableTitre: 'Chef de Bureau',
      estSecretariatDirection: b.est_secretariat_direction,
      badge: b.parent_type === 'DIRECTION' ? 'Bureau directement rattaché au Directeur' : null,
      missions: b.missions,
      attributions: attrs.filter((x) => x.cible_type === 'BUREAU' && x.bureau_id === b.id).map((x) => x.libelle),
      responsable: personView(chef),
      agents: showAgents ? members.filter((a) => a !== chef).map(personView) : [],
      effectif: members.length,
    };
  };

  const directeur = aff.find((a) => a.niveau === 'DIRECTION' && a.role_associe === 'DIRECTEUR');
  res.json({
    direction: {
      id: dep.id, code: dep.code, sigle: dep.sigle, nom: dep.nom, rangOrganique: dep.rang_organique,
      autoriteTutelle: dep.autorite_tutelle, missions: attrs.filter((x) => x.cible_type === 'DIRECTION' && x.categorie === 'MISSION').map((x) => x.libelle),
      presentation: dep.missions,
      responsable: personView(directeur), responsableTitre: 'Directeur',
      responsabilites: attrs.filter((x) => x.cible_type === 'ROLE' && x.role_code === 'DIRECTEUR').map((x) => x.libelle),
    },
    // Bureaux directement rattachés au Directeur (rang BUREAU)
    bureauxRattachesDirection: bureaux.filter((b) => b.parent_type === 'DIRECTION').map(bureauView),
    // Divisions (rang DIVISION) — le Bureau Secrétariat de Direction n’y figure jamais
    divisions: divisions.map((d) => {
      const chef = aff.find((a) => a.niveau === 'DIVISION' && a.division_id === d.id && a.role_associe === 'CHEF_DIVISION');
      return {
        id: d.id, code: d.code, nom: d.nom, typeStructure: d.type_structure, rangOrganique: d.rang_organique,
        rattachement: { parentType: 'DIRECTION', superieurDirect: 'DIRECTEUR', libelle: 'Placée sous l’autorité du Directeur' },
        perimetreAcces: d.perimetre_acces, responsableTitre: 'Chef de Division', missions: d.missions,
        attributions: attrs.filter((x) => x.cible_type === 'DIVISION' && x.division_id === d.id).map((x) => x.libelle),
        responsable: personView(chef),
        bureaux: bureaux.filter((b) => b.division_id === d.id).map(bureauView),
      };
    }),
    statistiques: {
      divisions: divisions.length,
      bureaux: bureaux.length,
      bureauxRattachesDivisions: bureaux.filter((b) => b.parent_type === 'DIVISION').length,
      bureauxRattachesDirection: bureaux.filter((b) => b.parent_type === 'DIRECTION').length,
      agents: aff.length,
    },
  });
});

/** Liste des Divisions — n’inclut que les structures de rang DIVISION. */
router.get('/divisions', requirePerm('organisation.consulter'), async (req, res) => {
  const rows = await db('divisions').where({ actif: true }).orderBy('ordre');
  res.json({ data: rows });
});

router.get('/bureaux', requirePerm('organisation.consulter'), validate({ query: z.object({ division_id: z.coerce.number().int().optional(), rattachement: z.enum(['DIVISION', 'DIRECTION']).optional() }) }), async (req, res) => {
  const { division_id: divisionId, rattachement } = req.valid.query;
  const q = db('bureaux as b').leftJoin('divisions as d', 'd.id', 'b.division_id').where('b.actif', true)
    .select('b.*', 'd.nom as division_nom').orderBy(['b.parent_type', 'b.ordre']);
  if (divisionId) q.where('b.division_id', divisionId);
  if (rattachement) q.where('b.parent_type', rattachement);
  res.json({ data: await q });
});

/** Fiche d’une structure (rang, rattachement, responsable, missions, attributions, agents, postes). */
router.get('/structures/:type/:id', requirePerm('organisation.consulter'), validate({ params: z.object({ type: z.enum(['direction', 'division', 'bureau']), id: z.coerce.number().int() }) }), async (req, res) => {
  const { type, id: sid } = req.valid.params;
  const aff = await activeAssignments();
  let s; let members; let chef; let attrs; let postes; let rattachement; let responsabilites;
  if (type === 'direction') {
    s = await db('directions').where({ id: sid }).first();
    if (!s) throw notFound('Structure introuvable.');
    members = aff.filter((a) => a.niveau === 'DIRECTION');
    chef = members.find((a) => a.role_associe === 'DIRECTEUR');
    attrs = await attributionsFor({ cible_type: 'DIRECTION', direction_id: sid });
    postes = await db('postes_organiques').where({ niveau: 'DIRECTION', direction_id: sid });
    rattachement = { libelle: `Placée sous l’autorité du ${s.autorite_tutelle}` };
    responsabilites = await attributionsFor({ cible_type: 'ROLE', role_code: 'DIRECTEUR' });
    s = { ...s, type_structure: 'DIRECTION', responsable_titre: 'Directeur' };
  } else if (type === 'division') {
    s = await db('divisions').where({ id: sid }).first();
    if (!s) throw notFound('Structure introuvable.');
    members = aff.filter((a) => a.division_id === sid);
    chef = members.find((a) => a.niveau === 'DIVISION' && a.role_associe === 'CHEF_DIVISION');
    attrs = await attributionsFor({ cible_type: 'DIVISION', division_id: sid });
    postes = await db('postes_organiques').where({ division_id: sid });
    rattachement = { parentType: 'DIRECTION', superieurDirect: 'DIRECTEUR', libelle: 'Placée sous l’autorité du Directeur' };
    responsabilites = await attributionsFor({ cible_type: 'ROLE', role_code: 'CHEF_DIVISION' });
    s = { ...s, responsable_titre: 'Chef de Division', bureaux: await db('bureaux').where({ division_id: sid, actif: true }).orderBy('ordre') };
  } else {
    s = await db('bureaux as b').leftJoin('divisions as d', 'd.id', 'b.division_id').where('b.id', sid).first('b.*', 'd.nom as division_nom');
    if (!s) throw notFound('Structure introuvable.');
    members = aff.filter((a) => a.bureau_id === sid);
    chef = members.find((a) => a.role_associe === 'CHEF_BUREAU');
    attrs = await attributionsFor({ cible_type: 'BUREAU', bureau_id: sid });
    postes = await db('postes_organiques').where({ bureau_id: sid });
    rattachement = {
      parentType: s.parent_type, divisionId: s.division_id, superieurDirect: s.superieur_direct,
      libelle: s.parent_type === 'DIRECTION' ? 'Bureau directement rattaché au Directeur' : `Rattaché à la ${s.division_nom}`,
      divisionRattachement: s.division_nom || 'Aucune',
    };
    responsabilites = await attributionsFor({ cible_type: 'ROLE', role_code: 'CHEF_BUREAU' });
    s = { ...s, responsable_titre: 'Chef de Bureau', badge: s.parent_type === 'DIRECTION' ? 'Bureau directement rattaché au Directeur' : null };
  }
  const showAgents = req.ctx.perimetre !== 'SYSTEME';
  res.json({
    structure: s, rattachement, responsable: personView(chef),
    attributions: attrs, responsabilitesResponsable: responsabilites, postes,
    agents: showAgents ? members.map((a) => ({ ...personView(a), niveau: a.niveau, dateAffectation: a.date_debut })) : [],
  });
});

// ─── Gestion des structures (Directeur) ─────────────────────────────────────
const divisionSchema = z.object({
  code: z.string().trim().min(2).max(20), nom: z.string().trim().min(3).max(200),
  missions: z.string().max(5000).optional().nullable(), ordre: z.coerce.number().int().optional(),
});

router.post('/divisions', requirePerm('organisation.gerer'), validate({ body: divisionSchema }), async (req, res) => {
  const dep = await db('directions').where({ code: 'DEP' }).first();
  const row = await db.transaction(async (trx) => {
    const ordre = req.valid.body.ordre ?? Number((await trx('divisions').max('ordre as m').first()).m || 0) + 1;
    const [d] = await trx('divisions').insert({ ...req.valid.body, ordre, direction_id: dep.id }).returning('*');
    // Poste organique du responsable, créé avec la structure
    await trx('postes_organiques').insert({ code: `P-CD-${d.code}`, libelle: `Chef de ${d.nom}`, niveau: 'DIVISION', role_associe: 'CHEF_DIVISION', direction_id: dep.id, division_id: d.id, grade_minimum_id: await gradeId(trx, 'CD') });
    return d;
  });
  await audit(req, { action: 'CREATION', module: 'organisation', entite: 'division', entiteId: row.id, apres: row });
  res.status(201).json(row);
});

router.put('/divisions/:id', requirePerm('organisation.gerer'), validate({ params: id, body: divisionSchema.partial() }), async (req, res) => {
  const before = await db('divisions').where({ id: req.valid.params.id }).first();
  if (!before) throw notFound();
  const [row] = await db('divisions').where({ id: before.id }).update({ ...req.valid.body, updated_at: db.fn.now() }).returning('*');
  await audit(req, { action: 'MODIFICATION', module: 'organisation', entite: 'division', entiteId: row.id, avant: before, apres: row });
  res.json(row);
});

const bureauSchema = z.object({
  code: z.string().trim().min(2).max(20), nom: z.string().trim().min(3).max(200),
  rattachement: z.enum(['DIVISION', 'DIRECTION']),
  division_id: z.coerce.number().int().positive().optional().nullable(),
  missions: z.string().max(5000).optional().nullable(), ordre: z.coerce.number().int().optional(),
});

function bureauRow(body) {
  if (body.rattachement === 'DIVISION' && !body.division_id) throw badRequest('Un Bureau rattaché à une Division doit préciser sa Division.');
  const isDirection = body.rattachement === 'DIRECTION';
  return {
    code: body.code, nom: body.nom, missions: body.missions, ordre: body.ordre,
    type_structure: 'BUREAU', rang_organique: 'BUREAU', responsable_role: 'CHEF_BUREAU', perimetre_acces: 'BUREAU',
    parent_type: body.rattachement, division_id: isDirection ? null : body.division_id,
    superieur_direct: isDirection ? 'DIRECTEUR' : 'CHEF_DIVISION',
  };
}

async function gradeId(trx, code) {
  const g = await trx('grades').where({ code }).first();
  return g ? g.id : null;
}

async function assertDivisionActive(divisionId) {
  if (!divisionId) return;
  const d = await db('divisions').where({ id: divisionId, actif: true }).first();
  if (!d) throw badRequest('Division de rattachement inconnue ou archivée.');
}

router.post('/bureaux', requirePerm('organisation.gerer'), validate({ body: bureauSchema }), async (req, res) => {
  const dep = await db('directions').where({ code: 'DEP' }).first();
  const data = bureauRow(req.valid.body);
  await assertDivisionActive(data.division_id);
  const row = await db.transaction(async (trx) => {
    const ordre = data.ordre ?? Number((await trx('bureaux').where({ parent_type: data.parent_type, division_id: data.division_id }).max('ordre as m').first()).m || 0) + 1;
    const [b] = await trx('bureaux').insert({ ...data, ordre, direction_id: dep.id, est_secretariat_direction: false }).returning('*');
    await trx('postes_organiques').insert([
      { code: `P-CB-${b.code}`, libelle: `Chef du ${b.nom}`, niveau: 'BUREAU', role_associe: 'CHEF_BUREAU', direction_id: dep.id, division_id: b.division_id, bureau_id: b.id, grade_minimum_id: await gradeId(trx, 'CB') },
      { code: `P-AG-${b.code}`, libelle: `Agent du ${b.nom}`, niveau: 'BUREAU', role_associe: 'AGENT', direction_id: dep.id, division_id: b.division_id, bureau_id: b.id },
    ]);
    return b;
  });
  await audit(req, { action: 'CREATION', module: 'organisation', entite: 'bureau', entiteId: row.id, apres: row });
  res.status(201).json(row);
});

router.put('/bureaux/:id', requirePerm('organisation.gerer'), validate({ params: id, body: bureauSchema }), async (req, res) => {
  const before = await db('bureaux').where({ id: req.valid.params.id }).first();
  if (!before) throw notFound();
  const data = bureauRow(req.valid.body);
  if (before.est_secretariat_direction && data.parent_type !== 'DIRECTION') {
    throw forbidden('Le Bureau Secrétariat de Direction reste directement rattaché au Directeur : il ne peut être rattaché à une Division.', 'SECRETARIAT_RATTACHEMENT');
  }
  await assertDivisionActive(data.division_id);
  const row = await db.transaction(async (trx) => {
    const [b] = await trx('bureaux').where({ id: before.id }).update({ ...data, updated_at: trx.fn.now() }).returning('*');
    if (b.division_id !== before.division_id) {
      // Changement de rattachement : propagation aux postes et aux affectations en cours (le déclencheur recalcule la Division).
      await trx('postes_organiques').where({ bureau_id: b.id }).update({ division_id: b.division_id, updated_at: trx.fn.now() });
      await trx('affectations').where({ bureau_id: b.id, est_active: true }).update({ updated_at: trx.fn.now() });
    }
    return b;
  });
  await audit(req, { action: 'MODIFICATION', module: 'organisation', entite: 'bureau', entiteId: row.id, avant: before, apres: row, message: row.division_id !== before.division_id ? 'Changement de rattachement' : null });
  res.json(row);
});

for (const table of ['divisions', 'bureaux']) {
  router.post(`/${table}/:id/archiver`, requirePerm('organisation.gerer'), validate({ params: id }), async (req, res) => {
    const before = await db(table).where({ id: req.valid.params.id }).first();
    if (!before) throw notFound();
    if (table === 'bureaux' && before.est_secretariat_direction) throw forbidden('Le Bureau Secrétariat de Direction ne peut pas être archivé.');
    const actifs = await db('affectations').where({ est_active: true }).where(table === 'divisions' ? 'division_id' : 'bureau_id', before.id).count('* as n').first();
    if (Number(actifs.n) > 0) throw badRequest('Impossible d’archiver une structure ayant des Agents affectés. Clôturez d’abord les affectations.');
    if (table === 'divisions') {
      const b = await db('bureaux').where({ division_id: before.id, actif: true }).count('* as n').first();
      if (Number(b.n) > 0) throw badRequest('Archivez d’abord les Bureaux rattachés à cette Division.');
    }
    const [row] = await db(table).where({ id: before.id }).update({ actif: false, archived_at: db.fn.now() }).returning('*');
    await audit(req, { action: 'ARCHIVAGE', module: 'organisation', entite: table.slice(0, -1), entiteId: row.id, avant: before, apres: row });
    res.json(row);
  });
}

// ─── Cadre organique ────────────────────────────────────────────────────────
router.get('/cadre', requirePerm('organisation.consulter'), async (req, res) => {
  const dep = await db('directions').where({ code: 'DEP' }).first();
  const [attributions, postes, grades, fonctions, divisions, bureaux] = await Promise.all([
    db('attributions').where({ actif: true }).orderBy(['cible_type', 'ordre']),
    db('postes_organiques as p').leftJoin('grades as g', 'g.id', 'p.grade_minimum_id')
      .leftJoin('bureaux as b', 'b.id', 'p.bureau_id').leftJoin('divisions as d', 'd.id', 'p.division_id')
      .where('p.actif', true).select('p.*', 'g.libelle as grade_minimum', 'b.nom as bureau_nom', 'd.nom as division_nom').orderBy('p.id'),
    db('grades').where({ actif: true }).orderBy('niveau', 'desc'),
    db('fonctions as f').leftJoin('grades as g', 'g.id', 'f.grade_id').where('f.actif', true).select('f.*', 'g.libelle as grade_libelle').orderBy('f.id'),
    db('divisions').where({ actif: true }).orderBy('ordre'),
    db('bureaux').where({ actif: true }).orderBy('ordre'),
  ]);
  res.json({ direction: { ...dep, nom: DEP_NOM }, attributions, postes, grades, fonctions, divisions, bureaux });
});

const attributionSchema = z.object({
  cible_type: z.enum(['DIRECTION', 'DIVISION', 'BUREAU', 'POSTE', 'ROLE']),
  division_id: z.coerce.number().int().optional().nullable(),
  bureau_id: z.coerce.number().int().optional().nullable(),
  poste_id: z.coerce.number().int().optional().nullable(),
  role_code: z.enum(['DIRECTEUR', 'CHEF_DIVISION', 'CHEF_BUREAU', 'AGENT']).optional().nullable(),
  categorie: z.enum(['MISSION', 'ATTRIBUTION', 'RESPONSABILITE']),
  libelle: z.string().trim().min(3).max(500),
  description: z.string().max(5000).optional().nullable(),
  ordre: z.coerce.number().int().optional(),
});

router.post('/attributions', requirePerm('cadre.gerer'), validate({ body: attributionSchema }), async (req, res) => {
  const b = req.valid.body;
  if (b.cible_type === 'DIVISION' && !b.division_id) throw badRequest('Division requise.');
  if (b.cible_type === 'BUREAU' && !b.bureau_id) throw badRequest('Bureau requis.');
  if (b.cible_type === 'ROLE' && !b.role_code) throw badRequest('Rôle requis.');
  const dep = await db('directions').where({ code: 'DEP' }).first();
  const [row] = await db('attributions').insert({ ...b, direction_id: dep.id }).returning('*');
  await audit(req, { action: 'CREATION', module: 'cadre', entite: 'attribution', entiteId: row.id, apres: row });
  res.status(201).json(row);
});

router.put('/attributions/:id', requirePerm('cadre.gerer'), validate({ params: id, body: attributionSchema.pick({ libelle: true, description: true, ordre: true, categorie: true }).partial() }), async (req, res) => {
  const before = await db('attributions').where({ id: req.valid.params.id }).first();
  if (!before) throw notFound();
  const [row] = await db('attributions').where({ id: before.id }).update({ ...req.valid.body, updated_at: db.fn.now() }).returning('*');
  await audit(req, { action: 'MODIFICATION', module: 'cadre', entite: 'attribution', entiteId: row.id, avant: before, apres: row });
  res.json(row);
});

router.delete('/attributions/:id', requirePerm('cadre.gerer'), validate({ params: id }), async (req, res) => {
  const before = await db('attributions').where({ id: req.valid.params.id }).first();
  if (!before) throw notFound();
  await db('attributions').where({ id: before.id }).update({ actif: false, updated_at: db.fn.now() });
  await audit(req, { action: 'DESACTIVATION', module: 'cadre', entite: 'attribution', entiteId: before.id, avant: before });
  res.json({ message: 'Attribution désactivée (conservée dans l’historique).' });
});

const posteSchema = z.object({
  code: z.string().trim().min(2).max(30), libelle: z.string().trim().min(3).max(200),
  niveau: z.enum(['DIRECTION', 'DIVISION', 'BUREAU']),
  role_associe: z.enum(['DIRECTEUR', 'CHEF_DIVISION', 'CHEF_BUREAU', 'AGENT']),
  division_id: z.coerce.number().int().optional().nullable(),
  bureau_id: z.coerce.number().int().optional().nullable(),
  grade_minimum_id: z.coerce.number().int().optional().nullable(),
  description: z.string().max(3000).optional().nullable(),
});

router.post('/postes', requirePerm('cadre.gerer'), validate({ body: posteSchema }), async (req, res) => {
  const b = { ...req.valid.body };
  if (b.bureau_id) {
    const bur = await db('bureaux').where({ id: b.bureau_id }).first();
    if (!bur) throw badRequest('Bureau inconnu.');
    b.division_id = bur.division_id;
    if (bur.est_secretariat_direction && b.role_associe === 'CHEF_DIVISION') throw forbidden('Aucun poste de Chef de Division ne peut être créé au Bureau Secrétariat de Direction.');
  }
  const dep = await db('directions').where({ code: 'DEP' }).first();
  const [row] = await db('postes_organiques').insert({ ...b, direction_id: dep.id }).returning('*');
  await audit(req, { action: 'CREATION', module: 'cadre', entite: 'poste', entiteId: row.id, apres: row });
  res.status(201).json(row);
});

router.put('/postes/:id', requirePerm('cadre.gerer'), validate({ params: id, body: posteSchema.pick({ libelle: true, grade_minimum_id: true, description: true }).partial() }), async (req, res) => {
  const before = await db('postes_organiques').where({ id: req.valid.params.id }).first();
  if (!before) throw notFound('Poste introuvable.');
  const [row] = await db('postes_organiques').where({ id: before.id }).update({ ...req.valid.body, updated_at: db.fn.now() }).returning('*');
  await audit(req, { action: 'MODIFICATION', module: 'cadre', entite: 'poste', entiteId: row.id, avant: before, apres: row });
  res.json(row);
});

router.post('/postes/:id/desactiver', requirePerm('cadre.gerer'), validate({ params: id }), async (req, res) => {
  const before = await db('postes_organiques').where({ id: req.valid.params.id }).first();
  if (!before) throw notFound('Poste introuvable.');
  const occ = await db('affectations').where({ poste_id: before.id, est_active: true }).count('* as n').first();
  if (Number(occ.n) > 0) throw badRequest('Ce poste est occupé : clôturez d’abord les affectations correspondantes.');
  await db('postes_organiques').where({ id: before.id }).update({ actif: false, updated_at: db.fn.now() });
  await audit(req, { action: 'DESACTIVATION', module: 'cadre', entite: 'poste', entiteId: before.id, avant: before });
  res.json({ message: 'Poste désactivé (conservé dans l’historique).' });
});

const gradeSchema = z.object({ code: z.string().trim().min(1).max(20), libelle: z.string().trim().min(2).max(150), categorie: z.string().max(80).optional().nullable(), niveau: z.coerce.number().int().default(0) });
router.post('/grades', requirePerm('cadre.gerer'), validate({ body: gradeSchema }), async (req, res) => {
  const [row] = await db('grades').insert(req.valid.body).returning('*');
  await audit(req, { action: 'CREATION', module: 'cadre', entite: 'grade', entiteId: row.id, apres: row });
  res.status(201).json(row);
});
const fonctionSchema = z.object({ code: z.string().trim().min(1).max(30), libelle: z.string().trim().min(2).max(150), grade_id: z.coerce.number().int().optional().nullable(), description: z.string().max(3000).optional().nullable() });
router.post('/fonctions', requirePerm('cadre.gerer'), validate({ body: fonctionSchema }), async (req, res) => {
  const [row] = await db('fonctions').insert(req.valid.body).returning('*');
  await audit(req, { action: 'CREATION', module: 'cadre', entite: 'fonction', entiteId: row.id, apres: row });
  res.status(201).json(row);
});

module.exports = router;

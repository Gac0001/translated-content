'use strict';
/**
 * Personnel : fiches des Agents, affectations (clôture sans suppression de l’historique),
 * supérieur hiérarchique, photo, exports.
 */
const express = require('express');
const fs = require('fs');
const { z } = require('zod');
const db = require('../../db/knex');
const validate = require('../../middleware/validate');
const { requirePerm } = require('../../middleware/auth');
const { audit } = require('../../services/audit');
const { notify } = require('../../services/notifications');
const { makeUpload, safePath, removeQuiet } = require('../../services/files');
const pdf = require('../../services/pdf');
const { sendWorkbook } = require('../../services/excel');
const { notFound, badRequest, forbidden } = require('../../utils/errors');
const { DEP_NOM, ROLE_LIBELLES } = require('../../constants');

const router = express.Router();
const idParam = z.object({ id: z.coerce.number().int().positive() });
const photoUpload = makeUpload({ imagesOnly: true });

const STATUTS = ['ACTIF', 'CONGE', 'DETACHE', 'SUSPENDU', 'RETRAITE', 'ARCHIVE'];

/** Lecture du personnel : périmètre + délégation « suivi administratif du personnel ». */
function canReadAll(ctx) {
  return ['SUPERVISION_GLOBALE', 'DIRECTION'].includes(ctx.perimetre) || ctx.can('personnel.suivre');
}

function baseQuery() {
  return db('agents as ag')
    .leftJoin('affectations as a', function j() { this.on('a.agent_id', 'ag.id').andOn('a.est_active', db.raw('true')); })
    .leftJoin('bureaux as b', 'b.id', 'a.bureau_id')
    .leftJoin('divisions as d', 'd.id', 'a.division_id')
    .leftJoin('grades as g', 'g.id', 'ag.grade_id')
    .leftJoin('fonctions as f', 'f.id', 'ag.fonction_id')
    .leftJoin('postes_organiques as p', 'p.id', 'a.poste_id')
    .leftJoin('users as u', 'u.agent_id', 'ag.id');
}

const listColumns = ['ag.id', 'ag.matricule', 'ag.nom', 'ag.postnom', 'ag.prenom', 'ag.sexe', 'ag.telephone', 'ag.email', 'ag.statut',
  'ag.est_autorite', 'ag.photo_path', 'g.libelle as grade', 'f.libelle as fonction', 'a.niveau', 'a.division_id', 'a.bureau_id',
  'a.date_debut as date_affectation', 'b.nom as bureau_nom', 'b.est_secretariat_direction', 'd.nom as division_nom',
  'p.libelle as poste', 'p.role_associe', 'u.id as user_id', 'u.username', 'u.statut as compte_statut'];

function scopeAgents(q, ctx) {
  if (canReadAll(ctx)) return q.where('ag.est_autorite', false);
  if (ctx.perimetre === 'DIVISION') return q.where('a.division_id', ctx.divisionId);
  if (ctx.perimetre === 'BUREAU') return q.where('a.bureau_id', ctx.bureauId);
  return q.where('ag.id', ctx.agentId || -1);
}

async function assertAgentInScope(ctx, agentId) {
  if (agentId === ctx.agentId) return;
  const row = await scopeAgents(baseQuery().where('ag.id', agentId), ctx).first('ag.id');
  if (!row) throw forbidden('Cet Agent n’appartient pas à votre périmètre administratif.', 'HORS_PERIMETRE');
}

const listQuery = z.object({
  q: z.string().trim().max(100).optional(),
  division_id: z.coerce.number().int().optional(),
  bureau_id: z.coerce.number().int().optional(),
  statut: z.enum(STATUTS).optional(),
  sans_affectation: z.enum(['true', 'false']).optional(),
});

function applyFilters(q, f) {
  if (f.q) q.where((w) => w.whereILike('ag.nom', `%${f.q}%`).orWhereILike('ag.postnom', `%${f.q}%`).orWhereILike('ag.prenom', `%${f.q}%`).orWhereILike('ag.matricule', `%${f.q}%`));
  if (f.division_id) q.where('a.division_id', f.division_id);
  if (f.bureau_id) q.where('a.bureau_id', f.bureau_id);
  if (f.statut) q.where('ag.statut', f.statut); else q.whereNull('ag.archived_at');
  if (f.sans_affectation === 'true') q.whereNull('a.id');
  return q;
}

router.get('/', requirePerm('personnel.consulter', 'personnel.suivre'), validate({ query: listQuery }), async (req, res) => {
  const q = applyFilters(scopeAgents(baseQuery(), req.ctx), req.valid.query).select(listColumns).orderBy(['ag.nom', 'ag.prenom']);
  const rows = await q;
  res.json({ data: rows.map((r) => ({ ...r, has_photo: !!r.photo_path, photo_path: undefined })) });
});

async function superieurOf(agentId) {
  const aff = await db('affectations as a').leftJoin('bureaux as b', 'b.id', 'a.bureau_id').leftJoin('postes_organiques as p', 'p.id', 'a.poste_id')
    .where({ 'a.agent_id': agentId, 'a.est_active': true }).first('a.*', 'b.est_secretariat_direction', 'b.parent_type', 'b.nom as bureau_nom', 'p.role_associe');
  if (!aff) return null;
  const chefQuery = (where, role) => db('affectations as a').join('agents as ag', 'ag.id', 'a.agent_id').join('postes_organiques as p', 'p.id', 'a.poste_id')
    .where({ 'a.est_active': true, 'p.role_associe': role, ...where }).whereNot('a.agent_id', agentId).first('ag.id', 'ag.nom', 'ag.postnom', 'ag.prenom');
  let sup = null; let titre = '';
  if (aff.niveau === 'BUREAU' && aff.role_associe !== 'CHEF_BUREAU') {
    sup = await chefQuery({ 'a.bureau_id': aff.bureau_id }, 'CHEF_BUREAU');
    titre = aff.est_secretariat_direction ? 'Chef du Bureau Secrétariat de Direction' : `Chef du ${aff.bureau_nom}`;
  } else if (aff.niveau === 'BUREAU') {
    if (aff.parent_type === 'DIRECTION') { sup = await chefQuery({ 'a.niveau': 'DIRECTION' }, 'DIRECTEUR'); titre = 'Directeur'; } else {
      sup = await chefQuery({ 'a.niveau': 'DIVISION', 'a.division_id': aff.division_id }, 'CHEF_DIVISION'); titre = 'Chef de Division';
    }
  } else if (aff.niveau === 'DIVISION') {
    sup = await chefQuery({ 'a.niveau': 'DIRECTION' }, 'DIRECTEUR'); titre = 'Directeur';
  } else {
    sup = await db('users as u').join('user_roles as ur', 'ur.user_id', 'u.id').join('roles as r', 'r.id', 'ur.role_id').join('agents as ag', 'ag.id', 'u.agent_id')
      .where('r.code', 'SECRETAIRE_GENERAL').first('ag.id', 'ag.nom', 'ag.postnom', 'ag.prenom');
    titre = 'Secrétaire Général';
  }
  return { titre, agent: sup ? { id: sup.id, nomComplet: [sup.prenom, sup.nom, sup.postnom].filter(Boolean).join(' ') } : null };
}

async function fiche(agentId) {
  const agent = await baseQuery().where('ag.id', agentId).first([...listColumns, 'ag.date_naissance', 'ag.adresse', 'ag.grade_id', 'ag.fonction_id', 'a.poste_id', 'a.id as affectation_id', 'ag.created_at', 'ag.archived_at',
    'ag.lieu_naissance', 'ag.date_mise_en_service', 'ag.numero_carte_igap', 'ag.commission_attachment_id', 'ag.liste_declarative', 'ag.enrole_at']);
  if (!agent) throw notFound('Agent introuvable.');
  const historique = await db('affectations as a')
    .leftJoin('bureaux as b', 'b.id', 'a.bureau_id').leftJoin('divisions as d', 'd.id', 'a.division_id')
    .leftJoin('postes_organiques as p', 'p.id', 'a.poste_id')
    .where('a.agent_id', agentId).orderBy('a.date_debut', 'desc').orderBy('a.id', 'desc')
    .select('a.*', 'b.nom as bureau_nom', 'b.est_secretariat_direction', 'd.nom as division_nom', 'p.libelle as poste');
  const roles = agent.user_id
    ? (await db('user_roles as ur').join('roles as r', 'r.id', 'ur.role_id').where('ur.user_id', agent.user_id).select('r.code')).map((r) => r.code) : [];
  const attrs = [];
  if (agent.bureau_id) attrs.push(...await db('attributions').where({ actif: true, cible_type: 'BUREAU', bureau_id: agent.bureau_id }).orderBy('ordre'));
  else if (agent.niveau === 'DIVISION') attrs.push(...await db('attributions').where({ actif: true, cible_type: 'DIVISION', division_id: agent.division_id }).orderBy('ordre'));
  const roleResp = agent.role_associe ? await db('attributions').where({ actif: true, cible_type: 'ROLE', role_code: agent.role_associe }).orderBy('ordre') : [];
  return {
    ...agent,
    has_photo: !!agent.photo_path,
    photo_path: undefined,
    direction: DEP_NOM,
    division: agent.est_secretariat_direction ? 'Aucune' : (agent.division_nom || (agent.niveau === 'BUREAU' ? 'Aucune' : null)),
    rattachement: agent.est_secretariat_direction ? 'Bureau directement rattaché au Directeur' : null,
    roles: roles.map((r) => ({ code: r, libelle: ROLE_LIBELLES[r] })),
    superieur: await superieurOf(agentId),
    historique_affectations: historique,
    attributions_structure: attrs,
    responsabilites_poste: roleResp,
  };
}

router.get('/moi', async (req, res) => {
  if (!req.ctx.agentId) throw notFound('Aucune fiche Agent n’est liée à ce compte.');
  res.json(await fiche(req.ctx.agentId));
});

router.get('/export/:format', requirePerm('personnel.consulter', 'personnel.suivre'), requirePerm('exports.generer'), validate({ params: z.object({ format: z.enum(['pdf', 'xlsx']) }), query: listQuery }), async (req, res) => {
  const rows = await applyFilters(scopeAgents(baseQuery(), req.ctx), req.valid.query).select(listColumns).orderBy(['ag.nom', 'ag.prenom']);
  const structure = (r) => (r.est_secretariat_direction ? `${r.bureau_nom} (rattaché au Directeur)` : [r.division_nom, r.bureau_nom].filter(Boolean).join(' / ') || (r.niveau === 'DIRECTION' ? 'Direction' : '—'));
  const columns = [
    { header: 'Matricule', key: 'matricule', width: 14 },
    { header: 'Nom, postnom et prénom', value: (r) => [r.nom, r.postnom, r.prenom].filter(Boolean).join(' '), width: 30 },
    { header: 'Sexe', key: 'sexe', width: 6 },
    { header: 'Grade', key: 'grade', width: 22 },
    { header: 'Fonction', key: 'fonction', width: 20 },
    { header: 'Structure', value: structure, width: 36 },
    { header: 'Poste organique', key: 'poste', width: 30 },
    { header: 'Statut', key: 'statut', width: 10 },
  ];
  await audit(req, { action: 'EXPORT', module: 'personnel', message: `Liste du personnel (${req.valid.params.format.toUpperCase()}, ${rows.length} lignes)` });
  const titre = 'Liste du personnel';
  if (req.valid.params.format === 'xlsx') return sendWorkbook(res, 'personnel-DEP.xlsx', [{ name: 'Personnel', titre, columns, rows }]);
  const { doc, finish } = pdf.createPdf(res, { filename: 'personnel-DEP.pdf', titre, sousTitre: `${DEP_NOM} — ${rows.length} agent(s)`, landscape: true });
  pdf.table(doc, columns.map((c) => ({ ...c, width: c.width })), rows);
  return finish();
});

router.get('/:id', validate({ params: idParam }), async (req, res) => {
  const { id } = req.valid.params;
  if (id !== req.ctx.agentId) {
    if (!req.ctx.can('personnel.consulter') && !req.ctx.can('personnel.suivre')) throw forbidden('Vous ne pouvez consulter que votre propre fiche.');
    await assertAgentInScope(req.ctx, id);
  }
  res.json(await fiche(id));
});

router.get('/:id/commission', validate({ params: idParam }), async (req, res) => {
  const { id } = req.valid.params;
  if (id !== req.ctx.agentId && !req.ctx.can('liste.consulter')) {
    if (!req.ctx.can('personnel.consulter') && !req.ctx.can('personnel.suivre')) throw forbidden();
    await assertAgentInScope(req.ctx, id);
  }
  const ag = await db('agents').where({ id }).first('commission_attachment_id');
  const att = ag && ag.commission_attachment_id ? await db('attachments').where({ id: ag.commission_attachment_id }).whereNull('deleted_at').first() : null;
  if (!att) throw notFound('Aucune commission d’affectation enregistrée.');
  const p = safePath(att.stored_name);
  if (!fs.existsSync(p)) throw notFound('Fichier absent du stockage.');
  await audit(req, { action: 'TELECHARGEMENT', module: 'personnel', entite: 'agent', entiteId: id, message: 'Commission d’affectation' });
  res.setHeader('Content-Type', att.mime_type);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(att.original_name)}`);
  fs.createReadStream(p).pipe(res);
});

router.get('/:id/photo', requirePerm('organisation.consulter'), validate({ params: idParam }), async (req, res) => {
  const a = await db('agents').where({ id: req.valid.params.id }).first('photo_path');
  if (!a || !a.photo_path) throw notFound('Aucune photo.');
  const p = safePath(a.photo_path);
  if (!fs.existsSync(p)) throw notFound('Photo introuvable.');
  res.setHeader('Cache-Control', 'private, max-age=300');
  res.sendFile(p);
});

// ─── Création / modification ────────────────────────────────────────────────
const agentSchema = z.object({
  matricule: z.string().trim().min(2).max(40),
  nom: z.string().trim().min(2).max(100),
  postnom: z.string().trim().max(100).optional().nullable(),
  prenom: z.string().trim().max(100).optional().nullable(),
  sexe: z.union([z.enum(['M', 'F']), z.literal('').transform(() => null), z.null()]).optional(), // facultatif : jamais déduit du prénom
  date_naissance: z.string().date().optional().nullable().or(z.literal('').transform(() => null)),
  grade_id: z.coerce.number().int().optional().nullable(),
  fonction_id: z.coerce.number().int().optional().nullable(),
  telephone: z.string().trim().max(40).optional().nullable(),
  email: z.union([z.email('adresse électronique invalide'), z.literal('')]).optional().nullable().transform((v) => v || null),
  adresse: z.string().trim().max(300).optional().nullable(),
  statut: z.enum(STATUTS).optional(),
});

function assertCanManage(ctx) {
  if (!ctx.can('personnel.gerer') && !ctx.can('personnel.suivre') && !ctx.can('liste.gerer')) throw forbidden('Permission insuffisante pour gérer le personnel.', 'PERMISSION_REQUISE');
}

router.post('/', validate({ body: agentSchema }), async (req, res) => {
  assertCanManage(req.ctx);
  // Tout nouvel agent est inscrit sur la liste déclarative, qui devra être revalidée par le Directeur.
  const [row] = await db('agents').insert({ ...req.valid.body, liste_declarative: true }).returning('*');
  await audit(req, { action: 'CREATION', module: 'personnel', entite: 'agent', entiteId: row.id, apres: row, message: 'Inscription sur la liste déclarative (à revalider)' });
  res.status(201).json(row);
});

router.put('/:id', validate({ params: idParam, body: agentSchema.partial() }), async (req, res) => {
  assertCanManage(req.ctx);
  const before = await db('agents').where({ id: req.valid.params.id }).first();
  if (!before) throw notFound('Agent introuvable.');
  if (before.est_autorite && !req.ctx.can('compte.creer_initial')) throw forbidden('La fiche d’une autorité hors DEP n’est pas modifiable depuis la DEP.');
  const [row] = await db('agents').where({ id: before.id }).update({ ...req.valid.body, updated_at: db.fn.now() }).returning('*');
  await audit(req, { action: 'MODIFICATION', module: 'personnel', entite: 'agent', entiteId: row.id, avant: before, apres: row });
  res.json(row);
});

router.post('/:id/photo', validate({ params: idParam }), photoUpload.single('photo'), async (req, res) => {
  const isSelf = req.valid.params.id === req.ctx.agentId;
  if (!isSelf) assertCanManage(req.ctx);
  if (!req.file) throw badRequest('Aucune photo transmise.');
  const before = await db('agents').where({ id: req.valid.params.id }).first();
  if (!before) { removeQuiet(req.file.filename); throw notFound('Agent introuvable.'); }
  await db('agents').where({ id: before.id }).update({ photo_path: req.file.filename, updated_at: db.fn.now() });
  if (before.photo_path) removeQuiet(before.photo_path);
  await audit(req, { action: 'MODIFICATION', module: 'personnel', entite: 'agent', entiteId: before.id, message: 'Mise à jour de la photo' });
  res.json({ message: 'Photo enregistrée.' });
});

router.post('/:id/archiver', validate({ params: idParam, body: z.object({ motif: z.string().trim().min(3).max(300) }) }), async (req, res) => {
  if (!req.ctx.can('personnel.gerer')) throw forbidden();
  const before = await db('agents').where({ id: req.valid.params.id }).first();
  if (!before) throw notFound();
  await db.transaction(async (trx) => {
    await trx('affectations').where({ agent_id: before.id, est_active: true }).update({ est_active: false, date_fin: trx.raw('CURRENT_DATE'), motif_cloture: req.valid.body.motif, closed_by: req.ctx.userId });
    await trx('agents').where({ id: before.id }).update({ statut: 'ARCHIVE', archived_at: trx.fn.now() });
    await trx('users').where({ agent_id: before.id }).update({ statut: 'DESACTIVE' });
  });
  await audit(req, { action: 'ARCHIVAGE', module: 'personnel', entite: 'agent', entiteId: before.id, avant: before, message: req.valid.body.motif });
  res.json({ message: 'Agent archivé. Son historique est conservé.' });
});

// ─── Affectations ───────────────────────────────────────────────────────────
const affectationSchema = z.object({
  division_id: z.coerce.number().int().positive().optional().nullable(),
  bureau_id: z.coerce.number().int().positive().optional().nullable(),
  poste_id: z.coerce.number().int().positive(),
  date_debut: z.string().date(),
  motif: z.string().trim().max(300).optional().nullable(),
});

router.post('/:id/affectations', requirePerm('affectations.gerer'), validate({ params: idParam, body: affectationSchema }), async (req, res) => {
  const agentId = req.valid.params.id;
  const b = req.valid.body;
  const agent = await db('agents').where({ id: agentId }).first();
  if (!agent) throw notFound('Agent introuvable.');
  if (agent.est_autorite) throw badRequest('Une autorité hors DEP ne reçoit pas d’affectation dans la DEP.');
  const poste = await db('postes_organiques').where({ id: b.poste_id, actif: true }).first();
  if (!poste) throw badRequest('Poste organique inconnu.');
  const dep = await db('directions').where({ code: 'DEP' }).first();
  let niveau = 'DIRECTION'; let divisionId = null; let bureauId = null;
  if (b.bureau_id) {
    const bur = await db('bureaux').where({ id: b.bureau_id, actif: true }).first();
    if (!bur) throw badRequest('Bureau inconnu ou archivé.');
    niveau = 'BUREAU'; bureauId = bur.id; divisionId = bur.division_id;
  } else if (b.division_id) {
    niveau = 'DIVISION'; divisionId = b.division_id;
  }
  if (poste.niveau !== niveau) throw badRequest(`Le poste « ${poste.libelle} » correspond au niveau ${poste.niveau}, incompatible avec l’affectation choisie (${niveau}).`);
  if (poste.bureau_id && poste.bureau_id !== bureauId) throw badRequest('Le poste choisi n’appartient pas à ce Bureau.');
  if (poste.division_id && niveau === 'DIVISION' && poste.division_id !== divisionId) throw badRequest('Le poste choisi n’appartient pas à cette Division.');

  // Un seul responsable par structure
  if (['CHEF_BUREAU', 'CHEF_DIVISION', 'DIRECTEUR'].includes(poste.role_associe)) {
    const q = db('affectations as a').join('postes_organiques as p', 'p.id', 'a.poste_id')
      .where({ 'a.est_active': true, 'p.role_associe': poste.role_associe }).whereNot('a.agent_id', agentId);
    if (bureauId) q.where('a.bureau_id', bureauId); else if (divisionId) q.where('a.division_id', divisionId).where('a.niveau', 'DIVISION'); else q.where('a.niveau', 'DIRECTION');
    if (await q.first()) throw badRequest('Cette structure a déjà un responsable en fonction. Clôturez d’abord son affectation.');
  }

  // Cohérence avec le rôle du compte : un Chef de Division ne peut être affecté dans un Bureau.
  const user = await db('users').where({ agent_id: agentId }).first();
  if (user) {
    const roles = (await db('user_roles as ur').join('roles as r', 'r.id', 'ur.role_id').where('ur.user_id', user.id).select('r.code')).map((r) => r.code);
    if (roles.includes('CHEF_DIVISION') && niveau !== 'DIVISION') {
      throw forbidden('Un compte ayant le rôle Chef de Division doit être affecté au niveau d’une Division. Modifiez d’abord ses rôles.', 'AFFECTATION_INCOMPATIBLE');
    }
  }

  const before = await db('affectations').where({ agent_id: agentId, est_active: true }).first();
  const created = await db.transaction(async (trx) => {
    if (before) {
      if (new Date(b.date_debut) < new Date(before.date_debut)) throw badRequest('La date de la nouvelle affectation ne peut précéder celle de l’affectation en cours.');
      await trx('affectations').where({ id: before.id }).update({ est_active: false, date_fin: b.date_debut, motif_cloture: 'Nouvelle affectation', closed_by: req.ctx.userId, updated_at: trx.fn.now() });
    }
    const [row] = await trx('affectations').insert({
      agent_id: agentId, direction_id: dep.id, division_id: divisionId, bureau_id: bureauId, poste_id: poste.id,
      niveau, date_debut: b.date_debut, motif: b.motif, est_active: true, created_by: req.ctx.userId,
    }).returning('*');
    return row;
  });
  await audit(req, { action: 'CHANGEMENT_AFFECTATION', module: 'personnel', entite: 'agent', entiteId: agentId, avant: before, apres: created });
  if (user) {
    await notify(user.id, { type: 'AFFECTATION', titre: 'Changement d’affectation', message: `Nouvelle affectation : ${poste.libelle}`, lien: '/profil', expediteur: req.ctx.userId });
  }
  res.status(201).json(created);
});

router.post('/:id/affectations/cloturer', requirePerm('affectations.gerer'), validate({ params: idParam, body: z.object({ date_fin: z.string().date(), motif_cloture: z.string().trim().min(3).max(300) }) }), async (req, res) => {
  const before = await db('affectations').where({ agent_id: req.valid.params.id, est_active: true }).first();
  if (!before) throw badRequest('Aucune affectation en cours pour cet Agent.');
  if (new Date(req.valid.body.date_fin) < new Date(before.date_debut)) throw badRequest('La date de clôture précède la date d’affectation.');
  const [row] = await db('affectations').where({ id: before.id }).update({ est_active: false, ...req.valid.body, closed_by: req.ctx.userId, updated_at: db.fn.now() }).returning('*');
  await audit(req, { action: 'CHANGEMENT_AFFECTATION', module: 'personnel', entite: 'affectation', entiteId: row.id, avant: before, apres: row, message: 'Clôture d’affectation' });
  const user = await db('users').where({ agent_id: req.valid.params.id }).first();
  if (user) await notify(user.id, { type: 'AFFECTATION', titre: 'Clôture de votre affectation', message: req.valid.body.motif_cloture, lien: '/profil', expediteur: req.ctx.userId });
  res.json(row);
});

module.exports = router;
module.exports.scopeAgents = scopeAgents;
module.exports.baseQuery = baseQuery;

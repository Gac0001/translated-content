'use strict';
/**
 * Documents de service : rédaction guidée, versionnement (aucune version supprimée),
 * commentaires, circuit de validation hiérarchique, visas et signature, archivage, exports.
 *
 * Circuit (annexe 2) : brouillon → en relecture → à corriger → visé → validé → publié → archivé.
 *   Auteur → Chef de Bureau (relecture) → Chef de Division (visa) → Directeur (validation, publication)
 *   Bureau Secrétariat de Direction : Auteur → Chef du Bureau (visa) → Directeur
 * Le visa revient au supérieur hiérarchique de l’auteur placé juste sous le Directeur.
 * La publication diffuse le document validé à toute la Direction ou aux structures choisies,
 * et au Secrétaire Général si le Directeur le décide.
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
const { directContacts, ctxNode } = require('../../services/hierarchy');
const { scopeDocuments, loadEntity } = require('../../services/access');
const pdf = require('../../services/pdf');
const { sendWorkbook } = require('../../services/excel');
const { buildDocx } = require('../../services/word');
const { TYPES, BY_CODE, normalize } = require('./types');
const { notFound, badRequest, forbidden } = require('../../utils/errors');
const { ROLE_LIBELLES } = require('../../constants');

const router = express.Router();
const idParam = z.object({ id: z.coerce.number().int().positive() });
const STATUT_LIBELLES = { BROUILLON: 'Brouillon', EN_RELECTURE: 'En relecture', A_CORRIGER: 'À corriger', VISE: 'Visé', VALIDE: 'Validé', PUBLIE: 'Publié', REJETE: 'Rejeté', ARCHIVE: 'Archivé' };
const NIVEAU = { AGENT: 'AUTEUR', CHEF_BUREAU: 'BUREAU', CHEF_DIVISION: 'DIVISION', DIRECTEUR: 'DIRECTION' };

router.get('/types', (req, res) => res.json({ data: TYPES }));

function baseQuery() {
  return db('documents as d')
    .join('users as ua', 'ua.id', 'd.auteur_user_id').leftJoin('agents as aa', 'aa.id', 'ua.agent_id')
    .leftJoin('users as uh', 'uh.id', 'd.detenteur_user_id').leftJoin('agents as ah', 'ah.id', 'uh.agent_id')
    .leftJoin('bureaux as b', 'b.id', 'd.bureau_id').leftJoin('divisions as dv', 'dv.id', 'd.division_id')
    .select('d.*', 'b.nom as bureau_nom', 'dv.nom as division_nom',
      db.raw(`concat_ws(' ', aa.prenom, aa.nom) as auteur_nom`), db.raw(`concat_ws(' ', ah.prenom, ah.nom) as detenteur_nom`));
}

const listQuery = z.object({
  type_document: z.string().max(40).optional(), statut: z.enum(Object.keys(STATUT_LIBELLES)).optional(),
  boite: z.enum(['mes', 'a_examiner', 'tous']).optional(), q: z.string().trim().max(100).optional(),
});

router.get('/', requirePerm('documents.consulter'), validate({ query: listQuery }), async (req, res) => {
  const { type_document: type, statut, boite, q } = req.valid.query;
  const query = scopeDocuments(baseQuery(), req.ctx).orderBy('d.updated_at', 'desc');
  if (type) query.where('d.type_document', type);
  if (statut) query.where('d.statut', statut); else if (boite !== 'mes') query.whereNot('d.statut', 'ARCHIVE');
  if (boite === 'mes') query.where('d.auteur_user_id', req.ctx.userId);
  if (boite === 'a_examiner') query.where('d.detenteur_user_id', req.ctx.userId).whereIn('d.statut', ['EN_RELECTURE', 'VISE']).whereNot('d.auteur_user_id', req.ctx.userId);
  if (q) query.where((w) => w.whereILike('d.titre', `%${q}%`).orWhereILike('d.reference', `%${q}%`));
  const rows = await query.limit(500);
  res.json({ data: rows.map((r) => ({ ...r, contenu: undefined, type_libelle: BY_CODE[r.type_document]?.libelle })) });
});

async function detail(ctx, id) {
  await loadEntity(ctx, 'DOCUMENT', id);
  const d = await baseQuery().where('d.id', id).first();
  const [versions, commentaires, historique, pieces, diffusions] = await Promise.all([
    db('document_versions as v').leftJoin('users as u', 'u.id', 'v.created_by').leftJoin('agents as a', 'a.id', 'u.agent_id').where('v.document_id', id).orderBy('v.numero', 'desc')
      .select('v.id', 'v.numero', 'v.titre', 'v.commentaire', 'v.created_at', db.raw(`concat_ws(' ', a.prenom, a.nom) as auteur`)),
    db('document_comments as c').join('users as u', 'u.id', 'c.user_id').leftJoin('agents as a', 'a.id', 'u.agent_id').where('c.document_id', id).orderBy('c.created_at')
      .select('c.*', db.raw(`concat_ws(' ', a.prenom, a.nom) as auteur`)),
    getHistory('DOCUMENT', id),
    db('attachments').where({ entity_type: 'DOCUMENT', entity_id: id }).whereNull('deleted_at'),
    db('document_diffusions as x').leftJoin('divisions as dv', 'dv.id', 'x.division_id').leftJoin('bureaux as b', 'b.id', 'x.bureau_id')
      .where('x.document_id', id).select('x.division_id', 'x.bureau_id', db.raw('coalesce(dv.nom, b.nom) as nom')),
  ]);
  return { ...d, type: BY_CODE[d.type_document], versions, commentaires, historique, pieces, diffusions };
}

/**
 * Niveau du visa : le responsable placé juste sous le Directeur, c’est-à-dire le Chef de Division
 * (titulaire ou intérimaire) ou le Chef du Bureau Secrétariat de Direction.
 */
function niveauVisa(ctx) {
  if (!ctx.can('documents.viser')) return false;
  return (ctx.primaryRole === 'CHEF_DIVISION' && ctx.perimetre === 'DIVISION') || (ctx.primaryRole === 'CHEF_BUREAU' && !!ctx.inSecretariat);
}

function actionsFor(ctx, d) {
  const auteur = d.auteur_user_id === ctx.userId;
  const detenteur = d.detenteur_user_id === ctx.userId;
  const readOnly = ctx.perimetre === 'SUPERVISION_GLOBALE';
  const viseur = niveauVisa(ctx);
  return {
    modifier: !readOnly && auteur && ['BROUILLON', 'A_CORRIGER'].includes(d.statut),
    transmettre: !readOnly && ((auteur && ['BROUILLON', 'A_CORRIGER'].includes(d.statut) && ctx.primaryRole !== 'DIRECTEUR')
      // Relecture par un Chef de Bureau rattaché à une Division : transmission au Chef de Division
      || (detenteur && !auteur && d.statut === 'EN_RELECTURE' && ctx.can('documents.examiner') && ctx.primaryRole !== 'DIRECTEUR' && !viseur)
      // Au niveau du visa, le document ne monte au Directeur qu’une fois visé
      || (detenteur && !auteur && d.statut === 'VISE' && viseur)),
    retourner: !readOnly && detenteur && !auteur && ['EN_RELECTURE', 'VISE'].includes(d.statut) && ctx.can('documents.examiner'),
    viser: !readOnly && detenteur && !auteur && d.statut === 'EN_RELECTURE' && viseur,
    valider: !readOnly && ctx.can('documents.valider_final') && ((detenteur && d.statut === 'EN_RELECTURE' && d.niveau_actuel === 'DIRECTION') || (auteur && d.statut === 'BROUILLON')),
    rejeter: !readOnly && ctx.can('documents.valider_final') && detenteur && d.statut === 'EN_RELECTURE' && d.niveau_actuel === 'DIRECTION' && !auteur,
    publier: !readOnly && ctx.can('documents.publier') && d.statut === 'VALIDE',
    archiver: !readOnly && ctx.can('documents.archiver') && ['VALIDE', 'PUBLIE', 'REJETE'].includes(d.statut),
    commenter: !readOnly && (auteur || detenteur || ctx.can('documents.examiner')),
  };
}

router.get('/:id', requirePerm('documents.consulter'), validate({ params: idParam }), async (req, res) => {
  const d = await detail(req.ctx, req.valid.params.id);
  res.json({ ...d, actions: actionsFor(req.ctx, d) });
});

router.get('/:id/versions/:numero', requirePerm('documents.consulter'), validate({ params: z.object({ id: z.coerce.number().int(), numero: z.coerce.number().int() }) }), async (req, res) => {
  await loadEntity(req.ctx, 'DOCUMENT', req.valid.params.id);
  const v = await db('document_versions').where({ document_id: req.valid.params.id, numero: req.valid.params.numero }).first();
  if (!v) throw notFound('Version introuvable.');
  res.json(v);
});

const createSchema = z.object({
  type_document: z.enum(TYPES.map((t) => t.code)),
  titre: z.string().trim().min(3).max(300),
  contenu: z.record(z.string(), z.any()).default({}),
  confidentialite: z.enum(['ORDINAIRE', 'CONFIDENTIEL', 'SECRET']).default('ORDINAIRE'),
  instruction_id: z.coerce.number().int().positive().optional().nullable(),
  task_id: z.coerce.number().int().positive().optional().nullable(),
});

router.post('/', requirePerm('documents.rediger'), validate({ body: createSchema }), async (req, res) => {
  if (req.ctx.perimetre === 'SUPERVISION_GLOBALE' || !ctxNode(req.ctx)) throw forbidden('Votre compte ne peut pas rédiger de document de service de la DEP.');
  const b = req.valid.body;
  const { contenu } = normalize(b.type_document, b.contenu);
  const dep = await db('directions').where({ code: 'DEP' }).first();
  const row = await db.transaction(async (trx) => {
    const reference = await nextReference(`DOC-${b.type_document}`, `DEP/${b.type_document.split('_').map((x) => x[0]).join('')}`, trx);
    const [d] = await trx('documents').insert({
      reference, type_document: b.type_document, titre: b.titre, contenu: JSON.stringify(contenu), confidentialite: b.confidentialite,
      auteur_user_id: req.ctx.userId, detenteur_user_id: req.ctx.userId, statut: 'BROUILLON', niveau_actuel: 'AUTEUR',
      direction_id: dep.id, division_id: req.ctx.divisionId, bureau_id: req.ctx.bureauId,
      instruction_id: b.instruction_id || null, task_id: b.task_id || null,
    }).returning('*');
    await trx('document_versions').insert({ document_id: d.id, numero: 1, titre: d.titre, contenu: JSON.stringify(contenu), commentaire: 'Version initiale', created_by: req.ctx.userId });
    await addHistory('DOCUMENT', d.id, req.ctx.userId, { action: 'CREATION', nouveau: 'BROUILLON', commentaire: 'Version 1' }, trx);
    return d;
  });
  await audit(req, { action: 'CREATION', module: 'documents', entite: 'document', entiteId: row.id, apres: { reference: row.reference, titre: row.titre } });
  res.status(201).json(row);
});

router.put('/:id', requirePerm('documents.rediger'), validate({ params: idParam, body: z.object({ titre: z.string().trim().min(3).max(300).optional(), contenu: z.record(z.string(), z.any()).optional(), confidentialite: z.enum(['ORDINAIRE', 'CONFIDENTIEL', 'SECRET']).optional(), commentaire: z.string().trim().max(500).optional() }) }), async (req, res) => {
  const d = await loadEntity(req.ctx, 'DOCUMENT', req.valid.params.id, 'write');
  if (d.auteur_user_id !== req.ctx.userId) throw forbidden('Seul l’auteur peut modifier ce document. Un Agent ne peut modifier le travail d’un autre Agent.');
  if (!['BROUILLON', 'A_CORRIGER'].includes(d.statut)) throw badRequest('Document en cours d’examen ou validé : modification impossible.');
  const b = req.valid.body;
  const contenu = b.contenu ? normalize(d.type_document, b.contenu).contenu : d.contenu;
  const numero = d.version_courante + 1;
  const updated = await db.transaction(async (trx) => {
    const [u] = await trx('documents').where({ id: d.id }).update({ titre: b.titre || d.titre, contenu: JSON.stringify(contenu), confidentialite: b.confidentialite || d.confidentialite, version_courante: numero, updated_at: trx.fn.now() }).returning('*');
    await trx('document_versions').insert({ document_id: d.id, numero, titre: u.titre, contenu: JSON.stringify(contenu), commentaire: b.commentaire || (d.statut === 'A_CORRIGER' ? 'Correction' : 'Mise à jour'), created_by: req.ctx.userId });
    await addHistory('DOCUMENT', d.id, req.ctx.userId, { action: 'NOUVELLE_VERSION', commentaire: `Version ${numero}${b.commentaire ? ` — ${b.commentaire}` : ''}` }, trx);
    return u;
  });
  await audit(req, { action: 'MODIFICATION', module: 'documents', entite: 'document', entiteId: d.id, avant: { version: d.version_courante }, apres: { version: numero } });
  res.json(updated);
});

function visa(ctx, type) {
  const a = ctx.agent;
  return { userId: ctx.userId, nom: a ? [a.prenom, a.nom].filter(Boolean).join(' ') : ctx.username, role: ctx.primaryRole, libelle: ROLE_LIBELLES[ctx.primaryRole], type, date: new Date().toISOString() };
}

async function move(req, d, patch, action, commentaire, notifyTo, notifType, titre) {
  const [u] = await db('documents').where({ id: d.id }).update({ ...patch, updated_at: db.fn.now() }).returning('*');
  await addHistory('DOCUMENT', d.id, req.ctx.userId, { action, ancien: d.statut, nouveau: u.statut, commentaire });
  const auditAction = { VALIDATION: 'VALIDATION', VISA: 'VALIDATION', PUBLICATION: 'VALIDATION', TRANSMISSION: 'TRANSMISSION', ARCHIVAGE: 'ARCHIVAGE' }[action] || 'MODIFICATION';
  await audit(req, { action: auditAction, module: 'documents', entite: 'document', entiteId: d.id, avant: { statut: d.statut, detenteur: d.detenteur_user_id }, apres: { statut: u.statut, detenteur: u.detenteur_user_id }, message: action });
  if (notifyTo) await notify(notifyTo, { type: notifType, titre: `${titre} : ${d.titre}`, message: commentaire || d.reference, lien: `/documents/${d.id}`, expediteur: req.ctx.userId, confidentiel: d.confidentialite !== 'ORDINAIRE' });
  return u;
}

router.post('/:id/transmettre', requirePerm('documents.rediger', 'documents.examiner'), validate({ params: idParam, body: z.object({ commentaire: z.string().trim().max(2000).optional() }) }), async (req, res) => {
  const d = await loadEntity(req.ctx, 'DOCUMENT', req.valid.params.id, 'write');
  const acts = actionsFor(req.ctx, d);
  if (!acts.transmettre) throw forbidden('Vous ne pouvez pas transmettre ce document dans son état actuel.');
  if (d.auteur_user_id === req.ctx.userId) {
    const { missing } = normalize(d.type_document, d.contenu);
    if (missing.length) throw badRequest(`Rubriques obligatoires à compléter avant transmission : ${missing.join(', ')}.`);
  }
  const [sup] = await directContacts(req.ctx, 'ASCENDANT');
  if (!sup) throw badRequest('Aucun supérieur hiérarchique direct actif n’a été trouvé pour la transmission.');
  if (sup.primaryRole === 'SECRETAIRE_GENERAL') throw badRequest('Les documents de service sont validés par le Directeur.');
  const visas = [...(d.visas || [])];
  if (d.auteur_user_id !== req.ctx.userId && d.statut === 'EN_RELECTURE') visas.push(visa(req.ctx, 'RELECTURE'));
  const u = await move(req, d, { statut: 'EN_RELECTURE', niveau_actuel: NIVEAU[sup.primaryRole], detenteur_user_id: sup.userId, visas: JSON.stringify(visas) }, 'TRANSMISSION',
    `Transmis à ${sup.nomComplet} (${sup.roleLibelle})${req.valid.body.commentaire ? ` — ${req.valid.body.commentaire}` : ''}`, sup.userId, 'DOCUMENT_A_EXAMINER', 'Document à examiner');
  res.json(u);
});

router.post('/:id/retourner', requirePerm('documents.examiner'), validate({ params: idParam, body: z.object({ commentaire: z.string().trim().min(3).max(5000) }) }), async (req, res) => {
  const d = await loadEntity(req.ctx, 'DOCUMENT', req.valid.params.id);
  if (!actionsFor(req.ctx, d).retourner) throw forbidden('Seul le détenteur actuel peut retourner ce document pour correction.');
  await db('document_comments').insert({ document_id: d.id, version_numero: d.version_courante, user_id: req.ctx.userId, type: 'CORRECTION', texte: req.valid.body.commentaire });
  res.json(await move(req, d, { statut: 'A_CORRIGER', niveau_actuel: 'AUTEUR', detenteur_user_id: d.auteur_user_id }, 'RETOUR_CORRECTION', req.valid.body.commentaire, d.auteur_user_id, 'DOCUMENT_RETOURNE', 'Document retourné pour correction'));
});

async function viser(req, res) {
  const d = await loadEntity(req.ctx, 'DOCUMENT', req.valid.params.id);
  if (!actionsFor(req.ctx, d).viser) throw forbidden('Le visa revient au Chef de Division, ou au Chef du Bureau Secrétariat de Direction, détenteur du document.');
  const visas = [...(d.visas || []), visa(req.ctx, 'VISA')];
  res.json(await move(req, d, { statut: 'VISE', visas: JSON.stringify(visas) }, 'VISA', req.valid.body.commentaire || 'Document visé', d.auteur_user_id, 'DOCUMENT_VALIDE', 'Document visé'));
}
const visaSchema = { params: idParam, body: z.object({ commentaire: z.string().trim().max(2000).optional() }) };
router.post('/:id/viser', requirePerm('documents.viser'), validate(visaSchema), viser);
router.post('/:id/valider-division', requirePerm('documents.viser'), validate(visaSchema), viser); // ancienne adresse

router.post('/:id/valider', requirePerm('documents.valider_final'), validate({ params: idParam, body: z.object({ commentaire: z.string().trim().max(2000).optional() }) }), async (req, res) => {
  const d = await loadEntity(req.ctx, 'DOCUMENT', req.valid.params.id);
  if (!actionsFor(req.ctx, d).valider) throw forbidden('Validation définitive réservée au Directeur détenteur du document.');
  const { missing } = normalize(d.type_document, d.contenu);
  if (missing.length) throw badRequest(`Rubriques obligatoires manquantes : ${missing.join(', ')}.`);
  const visas = [...(d.visas || []), visa(req.ctx, 'SIGNATURE')];
  res.json(await move(req, d, { statut: 'VALIDE', niveau_actuel: 'DIRECTION', visas: JSON.stringify(visas), valide_par: req.ctx.userId, valide_at: db.fn.now() }, 'VALIDATION', req.valid.body.commentaire || 'Validé et signé par le Directeur', d.auteur_user_id, 'DOCUMENT_VALIDE', 'Document validé'));
});

router.post('/:id/rejeter', requirePerm('documents.valider_final'), validate({ params: idParam, body: z.object({ commentaire: z.string().trim().min(3).max(5000) }) }), async (req, res) => {
  const d = await loadEntity(req.ctx, 'DOCUMENT', req.valid.params.id);
  if (!actionsFor(req.ctx, d).rejeter) throw forbidden();
  await db('document_comments').insert({ document_id: d.id, version_numero: d.version_courante, user_id: req.ctx.userId, type: 'CORRECTION', texte: req.valid.body.commentaire });
  res.json(await move(req, d, { statut: 'REJETE' }, 'REJET', req.valid.body.commentaire, d.auteur_user_id, 'DOCUMENT_RETOURNE', 'Document rejeté'));
});

/** Comptes concernés par une diffusion : agents affectés aux structures choisies (ou à toute la Direction). */
async function destinatairesDiffusion(diffusion, divisions, bureaux) {
  const q = db('users as u').join('affectations as a', function j() { this.on('a.agent_id', 'u.agent_id').andOn('a.est_active', db.raw('true')); })
    .where('u.statut', 'ACTIF');
  if (diffusion === 'STRUCTURES') q.where((w) => { w.whereIn('a.division_id', divisions.length ? divisions : [-1]).orWhereIn('a.bureau_id', bureaux.length ? bureaux : [-1]); });
  return q.distinct().pluck('u.id');
}

router.post('/:id/publier', requirePerm('documents.publier'), validate({ params: idParam, body: z.object({
  diffusion: z.enum(['DIRECTION', 'STRUCTURES']),
  divisions: z.array(z.coerce.number().int().positive()).max(20).optional().default([]),
  bureaux: z.array(z.coerce.number().int().positive()).max(30).optional().default([]),
  sg: z.boolean().optional().default(false),
  commentaire: z.string().trim().max(2000).optional(),
}) }), async (req, res) => {
  const d = await loadEntity(req.ctx, 'DOCUMENT', req.valid.params.id);
  if (!actionsFor(req.ctx, d).publier) throw badRequest('Seul un document validé peut être publié, par le Directeur.');
  const b = req.valid.body;
  const divisions = [...new Set(b.divisions)];
  const bureaux = [...new Set(b.bureaux)];
  if (b.diffusion === 'STRUCTURES') {
    if (!divisions.length && !bureaux.length) throw badRequest('Choisissez au moins une structure destinataire.');
    if ((await db('divisions').whereIn('id', divisions).count('* as n').first()).n != divisions.length
      || (await db('bureaux').whereIn('id', bureaux).count('* as n').first()).n != bureaux.length) throw badRequest('Structure inconnue.');
  }
  const noms = b.diffusion === 'DIRECTION' ? ['toute la Direction'] : [
    ...await db('divisions').whereIn('id', divisions).pluck('nom'), ...await db('bureaux').whereIn('id', bureaux).pluck('nom')];
  const libelle = `Diffusion : ${noms.join(', ')}${b.sg ? ' ; Secrétaire Général' : ''}${b.commentaire ? ` — ${b.commentaire}` : ''}`;
  await db.transaction(async (trx) => {
    await trx('document_diffusions').where({ document_id: d.id }).del();
    if (b.diffusion === 'STRUCTURES') {
      await trx('document_diffusions').insert([...divisions.map((x) => ({ document_id: d.id, division_id: x })), ...bureaux.map((x) => ({ document_id: d.id, bureau_id: x }))]);
    }
  });
  const u = await move(req, d, { statut: 'PUBLIE', diffusion: b.diffusion, diffusion_sg: b.sg, publie_par: req.ctx.userId, publie_at: db.fn.now() }, 'PUBLICATION', libelle, null);
  const dest = new Set(await destinatairesDiffusion(b.diffusion, divisions, bureaux));
  if (b.sg) (await db('users as u').join('user_roles as ur', 'ur.user_id', 'u.id').join('roles as r', 'r.id', 'ur.role_id').where('r.code', 'SECRETAIRE_GENERAL').where('u.statut', 'ACTIF').pluck('u.id')).forEach((x) => dest.add(x));
  dest.delete(req.ctx.userId);
  if (dest.size) await notify([...dest], { type: 'DOCUMENT_VALIDE', titre: `Document publié : ${d.titre}`, message: d.reference, lien: `/documents/${d.id}`, expediteur: req.ctx.userId, confidentiel: d.confidentialite !== 'ORDINAIRE' });
  res.json(u);
});

router.post('/:id/archiver', requirePerm('documents.archiver'), validate({ params: idParam }), async (req, res) => {
  const d = await loadEntity(req.ctx, 'DOCUMENT', req.valid.params.id);
  if (!['VALIDE', 'PUBLIE', 'REJETE'].includes(d.statut)) throw badRequest('Seul un document validé, publié ou rejeté peut être archivé.');
  res.json(await move(req, d, { statut: 'ARCHIVE', archived_at: db.fn.now() }, 'ARCHIVAGE', 'Document archivé', null));
});

router.post('/:id/commentaires', requirePerm('documents.consulter'), validate({ params: idParam, body: z.object({ texte: z.string().trim().min(2).max(5000) }) }), async (req, res) => {
  const d = await loadEntity(req.ctx, 'DOCUMENT', req.valid.params.id);
  if (!actionsFor(req.ctx, d).commenter) throw forbidden();
  const [c] = await db('document_comments').insert({ document_id: d.id, version_numero: d.version_courante, user_id: req.ctx.userId, texte: req.valid.body.texte }).returning('*');
  await audit(req, { action: 'CREATION', module: 'documents', entite: 'commentaire', entiteId: c.id });
  const to = [d.auteur_user_id, d.detenteur_user_id].filter((x) => x !== req.ctx.userId);
  await notify(to, { type: 'DOCUMENT_A_EXAMINER', titre: `Nouveau commentaire : ${d.titre}`, message: req.valid.body.texte.slice(0, 200), lien: `/documents/${d.id}`, expediteur: req.ctx.userId, confidentiel: d.confidentialite !== 'ORDINAIRE' });
  res.status(201).json(c);
});

// ─── Exports ────────────────────────────────────────────────────────────────
function renderValue(s, v) {
  if (s.type === 'list') return (v || []).map((x) => `• ${x}`).join('\n');
  if (s.type === 'date') return pdf.fmtDate(v);
  return v;
}

router.get('/:id/export/:format', requirePerm('exports.generer'), validate({ params: z.object({ id: z.coerce.number().int(), format: z.enum(['pdf', 'docx', 'xlsx']) }) }), async (req, res) => {
  const d = await detail(req.ctx, req.valid.params.id);
  const t = d.type;
  const meta = [['Référence', d.reference], ['Auteur', d.auteur_nom], ['Structure', d.bureau_nom || d.division_nom || 'Direction'], ['Version', d.version_courante], ['Statut', STATUT_LIBELLES[d.statut]], ['Confidentialité', d.confidentialite]];
  await audit(req, { action: 'EXPORT', module: 'documents', entite: 'document', entiteId: d.id, message: req.valid.params.format.toUpperCase() });
  const fname = `${d.reference.replace(/\//g, '-')}`;
  const visas = (d.visas || []).map((v) => ({ ...v, libelle: v.type === 'VALIDATION_DIVISION' ? 'Chef de Division' : v.libelle }));
  if (d.publie_at) meta.push(['Publication', `${pdf.fmtDateTime(d.publie_at)} — ${d.diffusion === 'DIRECTION' ? 'toute la Direction' : d.diffusions.map((x) => x.nom).join(', ')}${d.diffusion_sg ? ' ; Secrétaire Général' : ''}`]);
  if (req.valid.params.format === 'docx') {
    const buf = await buildDocx({ titre: `${t.libelle.toUpperCase()} — ${d.titre}`, reference: d.reference, meta, sections: t.sections.map((s) => ({ label: s.label, type: s.type, columns: s.columns, value: s.type === 'date' ? pdf.fmtDate(d.contenu[s.key]) : d.contenu[s.key] })), visas });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="${fname}.docx"`);
    return res.send(buf);
  }
  if (req.valid.params.format === 'xlsx') {
    const tables = t.sections.filter((s) => s.type === 'table');
    const sheets = tables.length
      ? tables.map((s) => ({ name: s.label, titre: `${t.libelle} — ${d.titre}`, sousTitre: `${d.reference} — ${s.label}`, columns: s.columns.map((c) => ({ header: c.label, key: c.key, width: 22 })), rows: d.contenu[s.key] || [] }))
      : [{ name: t.libelle, titre: `${t.libelle} — ${d.titre}`, sousTitre: d.reference, columns: [{ header: 'Rubrique', key: 'label', width: 30 }, { header: 'Contenu', key: 'value', width: 90 }], rows: t.sections.map((s) => ({ label: s.label, value: renderValue(s, d.contenu[s.key]) })) }];
    return sendWorkbook(res, `${fname}.xlsx`, sheets);
  }
  const { doc, finish } = pdf.createPdf(res, { filename: `${fname}.pdf`, titre: `${t.libelle.toUpperCase()}`, sousTitre: d.titre, reference: d.reference });
  pdf.keyValues(doc, meta);
  for (const s of t.sections) {
    if (s.type === 'table') {
      doc.font('Helvetica-Bold').fontSize(10.5).fillColor(pdf.BLUE).text(s.label).fillColor('#000').moveDown(0.3);
      pdf.table(doc, s.columns.map((c) => ({ header: c.label, key: c.key, width: 1 })), d.contenu[s.key] || []);
    } else pdf.section(doc, s.label, renderValue(s, d.contenu[s.key]));
  }
  if (visas.length) pdf.signatureBlock(doc, visas);
  return finish();
});

module.exports = router;

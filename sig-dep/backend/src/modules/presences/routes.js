'use strict';
/**
 * Présences hebdomadaires.
 * Workflow : Brouillon → Vérifiée → Soumise (verrouillage automatique) → Verrouillée.
 * Une liste soumise ou verrouillée n’est plus modifiable (contrôle API + déclencheur PostgreSQL).
 * Toute correction passe par un rectificatif lié à la liste originale.
 */
const express = require('express');
const { z } = require('zod');
const db = require('../../db/knex');
const validate = require('../../middleware/validate');
const { requirePerm } = require('../../middleware/auth');
const { audit } = require('../../services/audit');
const { notify } = require('../../services/notifications');
const { directeursActifs } = require('../../services/alertes');
const { addHistory, getHistory } = require('../../services/history');
const { scopePresences } = require('../../services/access');
const pdf = require('../../services/pdf');
const { sendWorkbook } = require('../../services/excel');
const { notFound, badRequest, forbidden } = require('../../utils/errors');
const { DEP_NOM } = require('../../constants');

const router = express.Router();
const idParam = z.object({ id: z.coerce.number().int().positive() });
const JOURS = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi'];
const VALEURS = ['PRESENT', 'ABSENT', 'RETARD', 'CONGE', 'MISSION', 'MALADIE'];
const CODES = { PRESENT: 'P', ABSENT: 'A', RETARD: 'R', CONGE: 'C', MISSION: 'M', MALADIE: 'MA' };
const STATUT_LIBELLES = { BROUILLON: 'Brouillon', VERIFIEE: 'Vérifiée', SOUMISE: 'Soumise', VERROUILLEE: 'Verrouillée' };

function isoWeek(d) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return { annee: date.getUTCFullYear(), semaine: Math.ceil(((date - yearStart) / 86400000 + 1) / 7) };
}

function listQueryBase() {
  return db('presence_sheets as s')
    .leftJoin('bureaux as b', 'b.id', 's.bureau_id').leftJoin('divisions as d', 'd.id', 's.division_id')
    .leftJoin('users as u', 'u.id', 's.created_by')
    .select('s.*', 'b.nom as bureau_nom', 'b.est_secretariat_direction', 'd.nom as division_nom', 'u.username as createur',
      db.raw('(SELECT count(*) FROM presence_entries e WHERE e.sheet_id = s.id)::int as nb_agents'));
}

async function loadSheet(ctx, id) {
  const exists = await db('presence_sheets').where({ id }).first();
  if (!exists) throw notFound('Liste de présence introuvable.');
  const row = await scopePresences(listQueryBase().where('s.id', id), ctx).first();
  if (!row) throw forbidden('Cette liste de présence est hors de votre périmètre administratif.', 'HORS_PERIMETRE');
  return row;
}

/** Peut préparer/modifier la liste : créateur, Chef du Bureau concerné, ou désignation Direction. */
function canEdit(ctx, s) {
  if (ctx.perimetre === 'SUPERVISION_GLOBALE') return false;
  if (s.created_by === ctx.userId) return true;
  if (s.structure_type === 'BUREAU' && ctx.can('presences.saisir') && ctx.perimetre === 'BUREAU' && ctx.bureauId === s.bureau_id) return true;
  return ctx.can('presences.preparer_direction');
}

function canVerify(ctx, s) {
  if (!ctx.can('presences.verifier') && !ctx.can('presences.preparer_direction')) return false;
  if (s.structure_type === 'DIRECTION') return ctx.can('presences.preparer_direction');
  if (ctx.perimetre === 'BUREAU') return ctx.bureauId === s.bureau_id || ctx.can('presences.preparer_direction');
  if (ctx.perimetre === 'DIVISION') return ctx.divisionId === s.division_id;
  return false;
}

async function eligibleAgents(structureType, bureauId) {
  const q = db('affectations as a').join('agents as ag', 'ag.id', 'a.agent_id')
    .leftJoin('bureaux as b', 'b.id', 'a.bureau_id').leftJoin('divisions as d', 'd.id', 'a.division_id')
    .leftJoin('grades as g', 'g.id', 'ag.grade_id')
    .where('a.est_active', true).whereNull('ag.archived_at')
    .select('ag.id', 'ag.matricule', 'ag.nom', 'ag.postnom', 'ag.prenom', 'g.libelle as grade', 'b.nom as bureau_nom', 'd.nom as division_nom', 'a.niveau')
    .orderBy(['ag.nom', 'ag.prenom']);
  if (structureType === 'BUREAU') q.where('a.bureau_id', bureauId);
  return q;
}

router.get('/', requirePerm('presences.consulter', 'presences.preparer_direction'), validate({ query: z.object({ statut: z.enum(Object.keys(STATUT_LIBELLES)).optional(), bureau_id: z.coerce.number().int().optional(), annee: z.coerce.number().int().optional() }) }), async (req, res) => {
  const { statut, bureau_id: bureauId, annee } = req.valid.query;
  const q = scopePresences(listQueryBase(), req.ctx).orderBy('s.semaine_debut', 'desc').orderBy('s.id', 'desc');
  if (statut) q.where('s.statut', statut);
  if (bureauId) q.where('s.bureau_id', bureauId);
  if (annee) q.where('s.annee', annee);
  res.json({ data: await q.limit(300) });
});

/** Présences personnelles de l’Agent connecté. */
router.get('/moi', async (req, res) => {
  if (!req.ctx.agentId) return res.json({ data: [] });
  const rows = await db('presence_entries as e').join('presence_sheets as s', 's.id', 'e.sheet_id')
    .where('e.agent_id', req.ctx.agentId).whereIn('s.statut', ['SOUMISE', 'VERROUILLEE'])
    .select('e.*', 's.reference', 's.semaine_debut', 's.semaine_fin', 's.statut', 's.est_rectificatif').orderBy('s.semaine_debut', 'desc').limit(52);
  return res.json({ data: rows });
});

router.get('/agents-eligibles', requirePerm('presences.saisir', 'presences.preparer_direction'), validate({ query: z.object({ structure_type: z.enum(['BUREAU', 'DIRECTION']), bureau_id: z.coerce.number().int().optional() }) }), async (req, res) => {
  const { structure_type: st, bureau_id: bureauId } = req.valid.query;
  if (st === 'DIRECTION' && !req.ctx.can('presences.preparer_direction')) throw forbidden();
  const bid = st === 'BUREAU' ? (bureauId || req.ctx.bureauId) : null;
  if (st === 'BUREAU' && bid !== req.ctx.bureauId && !req.ctx.can('presences.preparer_direction')) throw forbidden('Bureau hors de votre périmètre.', 'HORS_PERIMETRE');
  res.json({ data: await eligibleAgents(st, bid) });
});

router.post('/', requirePerm('presences.saisir', 'presences.preparer_direction'), validate({ body: z.object({
  structure_type: z.enum(['BUREAU', 'DIRECTION']),
  bureau_id: z.coerce.number().int().positive().optional().nullable(),
  semaine_debut: z.string().date(),
  agent_ids: z.array(z.coerce.number().int().positive()).optional(),
  observations: z.string().trim().max(3000).optional().nullable(),
}) }), async (req, res) => {
  const b = req.valid.body;
  const monday = new Date(`${b.semaine_debut}T00:00:00Z`);
  if (monday.getUTCDay() !== 1) throw badRequest('La semaine doit commencer un lundi.');
  const dep = await db('directions').where({ code: 'DEP' }).first();
  let bureau = null;
  if (b.structure_type === 'BUREAU') {
    const bid = b.bureau_id || req.ctx.bureauId;
    bureau = await db('bureaux').where({ id: bid, actif: true }).first();
    if (!bureau) throw badRequest('Bureau inconnu.');
    const own = req.ctx.can('presences.saisir') && req.ctx.perimetre === 'BUREAU' && req.ctx.bureauId === bureau.id;
    if (!own && !req.ctx.can('presences.preparer_direction')) throw forbidden('Vous ne pouvez créer que la liste de présence de votre propre Bureau.', 'HORS_PERIMETRE');
  } else if (!req.ctx.can('presences.preparer_direction')) {
    throw forbidden('La préparation des listes de la Direction relève du Bureau Secrétariat de Direction sur désignation du Directeur.');
  }
  const eligible = await eligibleAgents(b.structure_type, bureau ? bureau.id : null);
  const ids = b.agent_ids && b.agent_ids.length ? b.agent_ids : eligible.map((a) => a.id);
  const allowed = new Set(eligible.map((a) => a.id));
  if (ids.some((x) => !allowed.has(x))) throw badRequest('Certains Agents sélectionnés ne sont pas affectés à cette structure.');
  if (!ids.length) throw badRequest('Aucun Agent à inscrire sur la liste.');
  const fin = new Date(monday); fin.setUTCDate(fin.getUTCDate() + 4);
  const { annee, semaine } = isoWeek(new Date(monday.getUTCFullYear(), monday.getUTCMonth(), monday.getUTCDate()));
  const reference = `DEP/PRES/${annee}/S${String(semaine).padStart(2, '0')}/${bureau ? bureau.code : 'DIRECTION'}`;
  const sheet = await db.transaction(async (trx) => {
    const [s] = await trx('presence_sheets').insert({
      reference, structure_type: b.structure_type, direction_id: dep.id,
      division_id: bureau ? bureau.division_id : null, bureau_id: bureau ? bureau.id : null,
      semaine_debut: b.semaine_debut, semaine_fin: fin.toISOString().slice(0, 10), annee, numero_semaine: semaine,
      observations: b.observations, created_by: req.ctx.userId,
    }).returning('*');
    await trx('presence_entries').insert(ids.map((agent_id) => ({ sheet_id: s.id, agent_id })));
    await addHistory('PRESENCE', s.id, req.ctx.userId, { action: 'CREATION', nouveau: 'BROUILLON' }, trx);
    return s;
  });
  await audit(req, { action: 'CREATION', module: 'presences', entite: 'presence_sheet', entiteId: sheet.id, apres: sheet });
  res.status(201).json(sheet);
});

async function sheetDetail(ctx, id) {
  const s = await loadSheet(ctx, id);
  const entries = await db('presence_entries as e').join('agents as ag', 'ag.id', 'e.agent_id').leftJoin('grades as g', 'g.id', 'ag.grade_id')
    .where('e.sheet_id', id).select('e.*', 'ag.matricule', 'ag.nom', 'ag.postnom', 'ag.prenom', 'g.libelle as grade').orderBy(['ag.nom', 'ag.prenom']);
  const [historique, rectificatifs] = await Promise.all([
    getHistory('PRESENCE', id),
    db('presence_sheets').where({ rectifie_sheet_id: id }).select('id', 'reference', 'statut', 'created_at'),
  ]);
  const original = s.rectifie_sheet_id ? await db('presence_sheets').where({ id: s.rectifie_sheet_id }).first('id', 'reference', 'statut') : null;
  const totaux = Object.fromEntries(VALEURS.map((v) => [v, 0]));
  for (const e of entries) for (const j of JOURS) totaux[e[j]] += 1;
  return { ...s, entries, historique, rectificatifs, original, totaux };
}

router.get('/:id', validate({ params: idParam }), async (req, res) => {
  const d = await sheetDetail(req.ctx, req.valid.params.id);
  const locked = ['SOUMISE', 'VERROUILLEE'].includes(d.statut);
  res.json({
    ...d,
    actions: {
      modifier: !locked && canEdit(req.ctx, d),
      verifier: d.statut === 'BROUILLON' && canVerify(req.ctx, d),
      soumettre: d.statut === 'VERIFIEE' && canEdit(req.ctx, d) && (req.ctx.can('presences.soumettre') || req.ctx.can('presences.preparer_direction')),
      verrouiller: d.statut === 'SOUMISE' && req.ctx.can('presences.verrouiller'),
      rectifier: locked && canEdit(req.ctx, d),
      supprimer: d.statut === 'BROUILLON' && d.created_by === req.ctx.userId,
    },
  });
});

function assertEditable(s) {
  if (['SOUMISE', 'VERROUILLEE'].includes(s.statut)) {
    throw badRequest('Liste soumise ou verrouillée : elle n’est plus modifiable. Créez un rectificatif.');
  }
}

router.put('/:id/entries', validate({ params: idParam, body: z.object({
  entries: z.array(z.object({
    agent_id: z.coerce.number().int().positive(),
    ...Object.fromEntries(JOURS.map((j) => [j, z.enum(VALEURS)])),
    observation: z.string().trim().max(500).optional().nullable(),
  })).min(1).max(500),
  observations: z.string().trim().max(3000).optional().nullable(),
}) }), async (req, res) => {
  const s = await loadSheet(req.ctx, req.valid.params.id);
  assertEditable(s);
  if (!canEdit(req.ctx, s)) throw forbidden('Vous ne pouvez pas modifier cette liste.');
  const current = new Set((await db('presence_entries').where({ sheet_id: s.id }).pluck('agent_id')));
  const b = req.valid.body;
  if (b.entries.some((e) => !current.has(e.agent_id))) throw badRequest('Agent non inscrit sur cette liste.');
  await db.transaction(async (trx) => {
    for (const e of b.entries) {
      await trx('presence_entries').where({ sheet_id: s.id, agent_id: e.agent_id }).update({ ...Object.fromEntries(JOURS.map((j) => [j, e[j]])), observation: e.observation ?? null, updated_at: trx.fn.now() });
    }
    const patch = { updated_at: trx.fn.now() };
    if (b.observations !== undefined) patch.observations = b.observations;
    if (s.statut === 'VERIFIEE') Object.assign(patch, { statut: 'BROUILLON', verified_by: null, verified_at: null });
    await trx('presence_sheets').where({ id: s.id }).update(patch);
    await addHistory('PRESENCE', s.id, req.ctx.userId, { action: 'SAISIE', ancien: s.statut, nouveau: patch.statut || s.statut, commentaire: s.statut === 'VERIFIEE' ? 'Modification après vérification : retour en brouillon' : null }, trx);
  });
  await audit(req, { action: 'MODIFICATION', module: 'presences', entite: 'presence_sheet', entiteId: s.id, message: `Saisie de ${b.entries.length} ligne(s)` });
  res.json(await sheetDetail(req.ctx, s.id));
});

router.put('/:id/agents', validate({ params: idParam, body: z.object({ agent_ids: z.array(z.coerce.number().int().positive()).min(1).max(500) }) }), async (req, res) => {
  const s = await loadSheet(req.ctx, req.valid.params.id);
  if (s.statut !== 'BROUILLON') throw badRequest('La sélection des Agents n’est modifiable qu’à l’état Brouillon.');
  if (!canEdit(req.ctx, s)) throw forbidden();
  const eligible = new Set((await eligibleAgents(s.structure_type, s.bureau_id)).map((a) => a.id));
  const wanted = [...new Set(req.valid.body.agent_ids)];
  if (wanted.some((x) => !eligible.has(x))) throw badRequest('Certains Agents ne sont pas affectés à cette structure.');
  await db.transaction(async (trx) => {
    await trx('presence_entries').where({ sheet_id: s.id }).whereNotIn('agent_id', wanted).del();
    const existing = new Set(await trx('presence_entries').where({ sheet_id: s.id }).pluck('agent_id'));
    const add = wanted.filter((x) => !existing.has(x));
    if (add.length) await trx('presence_entries').insert(add.map((agent_id) => ({ sheet_id: s.id, agent_id })));
    await addHistory('PRESENCE', s.id, req.ctx.userId, { action: 'SELECTION_AGENTS', commentaire: `${wanted.length} agent(s)` }, trx);
  });
  await audit(req, { action: 'MODIFICATION', module: 'presences', entite: 'presence_sheet', entiteId: s.id, message: 'Sélection des Agents' });
  res.json(await sheetDetail(req.ctx, s.id));
});

router.post('/:id/verifier', validate({ params: idParam }), async (req, res) => {
  const s = await loadSheet(req.ctx, req.valid.params.id);
  if (s.statut !== 'BROUILLON') throw badRequest('Seule une liste à l’état Brouillon peut être vérifiée.');
  if (!canVerify(req.ctx, s)) throw forbidden('Vous n’êtes pas habilité à vérifier cette liste.');
  await db('presence_sheets').where({ id: s.id }).update({ statut: 'VERIFIEE', verified_by: req.ctx.userId, verified_at: db.fn.now(), updated_at: db.fn.now() });
  await addHistory('PRESENCE', s.id, req.ctx.userId, { action: 'VERIFICATION', ancien: 'BROUILLON', nouveau: 'VERIFIEE' });
  await audit(req, { action: 'VALIDATION', module: 'presences', entite: 'presence_sheet', entiteId: s.id, avant: { statut: s.statut }, apres: { statut: 'VERIFIEE' }, message: 'Vérification' });
  res.json(await sheetDetail(req.ctx, s.id));
});

router.post('/:id/soumettre', requirePerm('presences.soumettre', 'presences.preparer_direction'), validate({ params: idParam }), async (req, res) => {
  const s = await loadSheet(req.ctx, req.valid.params.id);
  if (s.statut !== 'VERIFIEE') throw badRequest('La liste doit être vérifiée avant sa soumission au Directeur.');
  if (!canEdit(req.ctx, s)) throw forbidden();
  await db('presence_sheets').where({ id: s.id }).update({ statut: 'SOUMISE', submitted_by: req.ctx.userId, submitted_at: db.fn.now(), updated_at: db.fn.now() });
  await addHistory('PRESENCE', s.id, req.ctx.userId, { action: 'SOUMISSION', ancien: 'VERIFIEE', nouveau: 'SOUMISE', commentaire: 'Soumise au Directeur — liste verrouillée en écriture' });
  await audit(req, { action: 'TRANSMISSION', module: 'presences', entite: 'presence_sheet', entiteId: s.id, avant: { statut: s.statut }, apres: { statut: 'SOUMISE' } });
  const directeurs = await directeursActifs();
  await notify(directeurs, { type: 'PRESENCE', titre: `Liste de présence soumise : ${s.reference}`, lien: `/presences/${s.id}`, expediteur: req.ctx.userId });
  res.json(await sheetDetail(req.ctx, s.id));
});

router.post('/:id/verrouiller', requirePerm('presences.verrouiller'), validate({ params: idParam }), async (req, res) => {
  const s = await loadSheet(req.ctx, req.valid.params.id);
  if (s.statut !== 'SOUMISE') throw badRequest('Seule une liste soumise peut être verrouillée.');
  await db('presence_sheets').where({ id: s.id }).update({ statut: 'VERROUILLEE', locked_by: req.ctx.userId, locked_at: db.fn.now() });
  await addHistory('PRESENCE', s.id, req.ctx.userId, { action: 'VERROUILLAGE', ancien: 'SOUMISE', nouveau: 'VERROUILLEE', commentaire: 'Réception par le Directeur' });
  await audit(req, { action: 'VALIDATION', module: 'presences', entite: 'presence_sheet', entiteId: s.id, avant: { statut: 'SOUMISE' }, apres: { statut: 'VERROUILLEE' } });
  res.json(await sheetDetail(req.ctx, s.id));
});

router.post('/:id/rectificatif', validate({ params: idParam, body: z.object({ motif: z.string().trim().min(5).max(2000) }) }), async (req, res) => {
  const orig = await loadSheet(req.ctx, req.valid.params.id);
  if (!['SOUMISE', 'VERROUILLEE'].includes(orig.statut)) throw badRequest('Un rectificatif ne concerne qu’une liste soumise ou verrouillée. Modifiez directement le brouillon.');
  if (!canEdit(req.ctx, orig)) throw forbidden('Vous ne pouvez pas établir de rectificatif pour cette liste.');
  const rootId = orig.rectifie_sheet_id || orig.id;
  const n = Number((await db('presence_sheets').where({ rectifie_sheet_id: rootId }).count('* as n').first()).n) + 1;
  const root = await db('presence_sheets').where({ id: rootId }).first();
  const rect = await db.transaction(async (trx) => {
    const [s] = await trx('presence_sheets').insert({
      reference: `${root.reference}-R${n}`, structure_type: orig.structure_type, direction_id: orig.direction_id,
      division_id: orig.division_id, bureau_id: orig.bureau_id, semaine_debut: orig.semaine_debut, semaine_fin: orig.semaine_fin,
      annee: orig.annee, numero_semaine: orig.numero_semaine, est_rectificatif: true, rectifie_sheet_id: rootId,
      motif_rectification: req.valid.body.motif, observations: orig.observations, created_by: req.ctx.userId,
    }).returning('*');
    const entries = await trx('presence_entries').where({ sheet_id: orig.id });
    if (entries.length) await trx('presence_entries').insert(entries.map((e) => ({ sheet_id: s.id, agent_id: e.agent_id, ...Object.fromEntries(JOURS.map((j) => [j, e[j]])), observation: e.observation })));
    await addHistory('PRESENCE', s.id, req.ctx.userId, { action: 'CREATION_RECTIFICATIF', nouveau: 'BROUILLON', commentaire: req.valid.body.motif, details: { original: orig.reference } }, trx);
    await addHistory('PRESENCE', rootId, req.ctx.userId, { action: 'RECTIFICATIF', commentaire: `Rectificatif ${s.reference} : ${req.valid.body.motif}` }, trx);
    return s;
  });
  await audit(req, { action: 'CREATION', module: 'presences', entite: 'presence_sheet', entiteId: rect.id, apres: rect, message: `Rectificatif de ${orig.reference}` });
  res.status(201).json(rect);
});

router.delete('/:id', validate({ params: idParam }), async (req, res) => {
  const s = await loadSheet(req.ctx, req.valid.params.id);
  if (s.statut !== 'BROUILLON' || s.created_by !== req.ctx.userId) throw forbidden('Seul le créateur peut supprimer une liste à l’état Brouillon.');
  await db.transaction(async (trx) => {
    await trx('presence_entries').where({ sheet_id: s.id }).del();
    await trx('presence_sheets').where({ id: s.id }).del();
  });
  await audit(req, { action: 'SUPPRESSION', module: 'presences', entite: 'presence_sheet', entiteId: s.id, avant: s });
  res.json({ message: 'Brouillon supprimé.' });
});

router.get('/:id/export/:format', requirePerm('exports.generer'), validate({ params: z.object({ id: z.coerce.number().int().positive(), format: z.enum(['pdf', 'xlsx']) }) }), async (req, res) => {
  const d = await sheetDetail(req.ctx, req.valid.params.id);
  const structure = d.structure_type === 'DIRECTION' ? DEP_NOM : `${d.bureau_nom}${d.est_secretariat_direction ? ' (Bureau directement rattaché au Directeur)' : d.division_nom ? ` — ${d.division_nom}` : ''}`;
  const titre = `LISTE DE PRÉSENCE HEBDOMADAIRE${d.est_rectificatif ? ' — RECTIFICATIF' : ''}`;
  const sousTitre = `${structure} — Semaine ${d.numero_semaine} du ${pdf.fmtDate(d.semaine_debut)} au ${pdf.fmtDate(d.semaine_fin)} — Statut : ${STATUT_LIBELLES[d.statut]}`;
  const columns = [
    { header: 'N°', value: (r) => d.entries.indexOf(r) + 1, width: 5 },
    { header: 'Matricule', key: 'matricule', width: 13 },
    { header: 'Nom, postnom et prénom', value: (r) => [r.nom, r.postnom, r.prenom].filter(Boolean).join(' '), width: 30 },
    { header: 'Grade', key: 'grade', width: 20 },
    ...JOURS.map((j) => ({ header: j.charAt(0).toUpperCase() + j.slice(1), value: (r) => CODES[r[j]], width: 9, align: 'center' })),
    { header: 'Observation', key: 'observation', width: 24 },
  ];
  await audit(req, { action: 'EXPORT', module: 'presences', entite: 'presence_sheet', entiteId: d.id, message: req.valid.params.format.toUpperCase() });
  const legende = 'Légende : P = Présent · A = Absent · R = Retard · C = Congé · M = Mission · MA = Maladie';
  if (req.valid.params.format === 'xlsx') {
    return sendWorkbook(res, `presence-${d.id}.xlsx`, [{ name: 'Présences', titre, sousTitre: `${sousTitre} — ${legende}`, columns, rows: d.entries }]);
  }
  const { doc, finish } = pdf.createPdf(res, { filename: `presence-${d.id}.pdf`, titre, sousTitre, reference: d.reference, landscape: true });
  if (d.est_rectificatif) pdf.keyValues(doc, [['Rectificatif de', d.original ? d.original.reference : ''], ['Motif', d.motif_rectification]]);
  pdf.table(doc, columns, d.entries);
  doc.fontSize(8).fillColor('#555').text(legende);
  doc.text(`Totaux (agent-jours) : ${Object.entries(d.totaux).map(([k, v]) => `${CODES[k]} = ${v}`).join(' · ')}`).fillColor('#000');
  if (d.observations) pdf.section(doc, 'Observations', d.observations);
  pdf.signatureBlock(doc, [{ libelle: 'Établie par' }, { libelle: 'Vérifiée par' }, { libelle: 'Le Directeur' }]);
  return finish();
});

module.exports = router;

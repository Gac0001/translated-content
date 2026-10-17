'use strict';
/**
 * Anciennes listes de présence hebdomadaires par Bureau (format antérieur à la version 1.38),
 * conservées en lecture seule : consultation et export. Les présences se tiennent désormais en
 * listes journalières (routes.js).
 */
const express = require('express');
const { z } = require('zod');
const db = require('../../db/knex');
const validate = require('../../middleware/validate');
const { requirePerm } = require('../../middleware/auth');
const { audit } = require('../../services/audit');
const { getHistory } = require('../../services/history');
const { scopePresences } = require('../../services/access');
const pdf = require('../../services/pdf');
const { sendWorkbook } = require('../../services/excel');
const { notFound, forbidden } = require('../../utils/errors');
const { DEP_NOM } = require('../../constants');

const router = express.Router();
const idParam = z.object({ id: z.coerce.number().int().positive() });
const JOURS = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi'];
const VALEURS = ['PRESENT', 'ABSENT', 'RETARD', 'CONGE', 'MISSION', 'MALADIE'];
const CODES = { PRESENT: 'P', ABSENT: 'A', RETARD: 'R', CONGE: 'C', MISSION: 'M', MALADIE: 'MA' };
const STATUT_LIBELLES = { BROUILLON: 'Brouillon', VERIFIEE: 'Vérifiée', SOUMISE: 'Soumise', VERROUILLEE: 'Verrouillée' };

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

router.get('/', requirePerm('presences.consulter', 'presences.preparer_direction'), validate({ query: z.object({ statut: z.enum(Object.keys(STATUT_LIBELLES)).optional(), bureau_id: z.coerce.number().int().optional(), annee: z.coerce.number().int().optional() }) }), async (req, res) => {
  const { statut, bureau_id: bureauId, annee } = req.valid.query;
  const q = scopePresences(listQueryBase(), req.ctx).orderBy('s.semaine_debut', 'desc').orderBy('s.id', 'desc');
  if (statut) q.where('s.statut', statut);
  if (bureauId) q.where('s.bureau_id', bureauId);
  if (annee) q.where('s.annee', annee);
  res.json({ data: await q.limit(300) });
});

/** Présences personnelles de l’Agent connecté. */
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
  res.json({
    ...d,
    actions: {
      modifier: false, verifier: false, soumettre: false, verrouiller: false, rectifier: false, supprimer: false,
    },
  });
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

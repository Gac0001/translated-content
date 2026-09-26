'use strict';
/**
 * Rapports périodiques (mensuel, trimestriel, annuel) et statistiques de performance,
 * limités au périmètre de l’utilisateur. Exports PDF et Excel.
 */
const express = require('express');
const { z } = require('zod');
const db = require('../../db/knex');
const validate = require('../../middleware/validate');
const { requirePerm } = require('../../middleware/auth');
const { audit } = require('../../services/audit');
const { performanceParStructure } = require('../../services/stats');
const pdf = require('../../services/pdf');
const { sendWorkbook } = require('../../services/excel');
const { forbidden } = require('../../utils/errors');
const { DEP_NOM } = require('../../constants');

const router = express.Router();
const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

const query = z.object({
  periode: z.enum(['MENSUEL', 'TRIMESTRIEL', 'ANNUEL']).default('MENSUEL'),
  annee: z.coerce.number().int().min(2020).max(2100).default(new Date().getFullYear()),
  mois: z.coerce.number().int().min(1).max(12).optional(),
  trimestre: z.coerce.number().int().min(1).max(4).optional(),
});

function range({ periode, annee, mois, trimestre }) {
  const pad = (n) => String(n).padStart(2, '0');
  if (periode === 'ANNUEL') return { du: `${annee}-01-01`, au: `${annee}-12-31`, libelle: `Année ${annee}` };
  if (periode === 'TRIMESTRIEL') {
    const t = trimestre || Math.floor(new Date().getMonth() / 3) + 1;
    const m1 = (t - 1) * 3 + 1;
    const last = new Date(annee, m1 + 2, 0).getDate();
    return { du: `${annee}-${pad(m1)}-01`, au: `${annee}-${pad(m1 + 2)}-${last}`, libelle: `${t}${t === 1 ? 'er' : 'e'} trimestre ${annee}` };
  }
  const m = mois || new Date().getMonth() + 1;
  return { du: `${annee}-${pad(m)}-01`, au: `${annee}-${pad(m)}-${new Date(annee, m, 0).getDate()}`, libelle: `${MOIS[m - 1]} ${annee}` };
}

async function buildReport(ctx, q) {
  const r = range(q);
  const scope = {};
  if (ctx.perimetre === 'DIVISION') scope.divisionId = ctx.divisionId;
  else if (ctx.perimetre === 'BUREAU') scope.bureauId = ctx.bureauId;
  else if (!['DIRECTION', 'SUPERVISION_GLOBALE'].includes(ctx.perimetre)) throw forbidden('Rapports non disponibles pour votre périmètre.');
  const perf = await performanceParStructure({ du: r.du, au: r.au, ...scope });
  const filt = (qb, alias = '') => {
    if (scope.divisionId) qb.where(`${alias}division_id`, scope.divisionId);
    if (scope.bureauId) qb.where(`${alias}bureau_id`, scope.bureauId);
    return qb;
  };
  const [courriers, pip, pres] = await Promise.all([
    ['DIRECTION', 'SUPERVISION_GLOBALE'].includes(ctx.perimetre)
      ? db('courriers').whereBetween('date_enregistrement', [r.du, r.au]).select('sens').count('* as n').groupBy('sens') : [],
    filt(db('pip_projects')).whereBetween('created_at', [r.du, db.raw('?::date + 1', [r.au])]).select('statut').count('* as n').sum('cout_total as cout').groupBy('statut'),
    filt(db('presence_entries as e').join('presence_sheets as s', 's.id', 'e.sheet_id'), 's.').whereBetween('s.semaine_debut', [r.du, r.au])
      .whereIn('s.statut', ['SOUMISE', 'VERROUILLEE']).where('s.est_rectificatif', false).select('e.lundi', 'e.mardi', 'e.mercredi', 'e.jeudi', 'e.vendredi'),
  ]);
  const presTot = {};
  for (const e of pres) for (const j of ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi']) presTot[e[j]] = (presTot[e[j]] || 0) + 1;
  const lignes = [];
  for (const d of perf.divisions) {
    lignes.push({ niveau: 'Division', rang: 'DIVISION', structure: d.nom, ...d });
    for (const b of d.bureaux) lignes.push({ niveau: '— Bureau', rang: 'BUREAU', structure: b.nom, ...b });
  }
  for (const b of perf.bureauxRattachesDirection) lignes.push({ niveau: 'Bureau rattaché au Directeur', rang: 'BUREAU', structure: b.nom, ...b });
  return {
    periode: { ...r, type: q.periode }, perimetre: ctx.perimetre, performance: perf, lignes,
    courriers: Object.fromEntries(courriers.map((c) => [c.sens, Number(c.n)])),
    pip: pip.map((p) => ({ statut: p.statut, nombre: Number(p.n), cout: Number(p.cout || 0) })),
    presences: presTot,
  };
}

router.get('/activites', requirePerm('rapports.consulter'), validate({ query }), async (req, res) => {
  res.json(await buildReport(req.ctx, req.valid.query));
});

const COLS = [
  { header: 'Niveau', key: 'niveau', width: 22 }, { header: 'Structure', key: 'structure', width: 40 }, { header: 'Agents', key: 'agents', width: 8 },
  { header: 'Tâches', key: 'taches', width: 8 }, { header: 'Terminées', key: 'tachesTerminees', width: 10 }, { header: 'En retard', key: 'tachesEnRetard', width: 10 },
  { header: 'Instructions', key: 'instructions', width: 11 }, { header: 'Exécutées', key: 'instructionsExecutees', width: 10 },
  { header: 'Documents', key: 'documents', width: 10 }, { header: 'Validés', key: 'documentsValides', width: 9 },
  { header: 'Taux d’exécution', value: (r) => (r.tauxExecution === null ? '—' : `${r.tauxExecution} %`), width: 14 },
];

router.get('/activites/export/:format', requirePerm('rapports.consulter'), requirePerm('exports.generer'), validate({ params: z.object({ format: z.enum(['pdf', 'xlsx']) }), query }), async (req, res) => {
  const rep = await buildReport(req.ctx, req.valid.query);
  const titre = `Rapport ${rep.periode.type.toLowerCase()} d’activités — ${rep.periode.libelle}`;
  await audit(req, { action: 'EXPORT', module: 'rapports', message: `${titre} (${req.valid.params.format})` });
  if (req.valid.params.format === 'xlsx') {
    return sendWorkbook(res, `rapport-${rep.periode.type.toLowerCase()}-${rep.periode.du}.xlsx`, [
      { name: 'Performance', titre, sousTitre: `Période du ${pdf.fmtDate(rep.periode.du)} au ${pdf.fmtDate(rep.periode.au)}`, columns: COLS, rows: rep.lignes },
      { name: 'Présences', titre: 'Synthèse des présences (agent-jours)', columns: [{ header: 'Statut', key: 'k', width: 20 }, { header: 'Nombre', key: 'v', width: 12 }], rows: Object.entries(rep.presences).map(([k, v]) => ({ k, v })) },
      { name: 'PIP', titre: 'Fiches PIP de la période', columns: [{ header: 'Statut', key: 'statut', width: 20 }, { header: 'Nombre', key: 'nombre', width: 10 }, { header: 'Coût cumulé', key: 'cout', width: 18 }], rows: rep.pip },
    ]);
  }
  const { doc, finish } = pdf.createPdf(res, { filename: `rapport-${rep.periode.type.toLowerCase()}-${rep.periode.du}.pdf`, titre: titre.toUpperCase(), sousTitre: `${DEP_NOM} — du ${pdf.fmtDate(rep.periode.du)} au ${pdf.fmtDate(rep.periode.au)}`, landscape: true });
  doc.font('Helvetica-Bold').fontSize(10.5).fillColor(pdf.BLUE).text('1. Performance par structure').fillColor('#000').moveDown(0.3);
  doc.font('Helvetica').fontSize(8).fillColor('#555').text('Les Divisions et les Bureaux directement rattachés au Directeur sont présentés séparément ; le rang organique de chaque structure est indiqué dans la colonne « Niveau ».').fillColor('#000').moveDown(0.3);
  pdf.table(doc, COLS, rep.lignes, { fontSize: 7.5 });
  doc.font('Helvetica-Bold').fontSize(10.5).fillColor(pdf.BLUE).text('2. Présences (agent-jours)').fillColor('#000').moveDown(0.3);
  pdf.table(doc, [{ header: 'Statut', key: 'k' }, { header: 'Nombre', key: 'v' }], Object.entries(rep.presences).map(([k, v]) => ({ k, v })));
  if (Object.keys(rep.courriers).length) {
    doc.font('Helvetica-Bold').fontSize(10.5).fillColor(pdf.BLUE).text('3. Courriers enregistrés').fillColor('#000').moveDown(0.3);
    pdf.table(doc, [{ header: 'Sens', key: 'k' }, { header: 'Nombre', key: 'v' }], Object.entries(rep.courriers).map(([k, v]) => ({ k, v })));
  }
  doc.font('Helvetica-Bold').fontSize(10.5).fillColor(pdf.BLUE).text('4. Projets PIP').fillColor('#000').moveDown(0.3);
  pdf.table(doc, [{ header: 'Statut', key: 'statut' }, { header: 'Nombre', key: 'nombre' }, { header: 'Coût cumulé', value: (p) => p.cout.toLocaleString('fr-FR') }], rep.pip);
  return finish();
});

module.exports = router;

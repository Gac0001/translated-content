'use strict';
/**
 * Exploitation des données sectorielles : calcul des indicateurs et tableaux croisés.
 * Seules les réponses contrôlées des campagnes validées entrent dans les calculs.
 */
const ExcelJS = require('exceljs');
const db = require('../db/knex');

const CALCULS = { SOMME: 'Somme', MOYENNE: 'Moyenne', RATIO: 'Ratio', NOMBRE: 'Nombre de répondants', PART: 'Part des répondants (%)' };
const vide = (v) => v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length);
const nombre = (v) => (vide(v) || typeof v === 'boolean' || !Number.isFinite(Number(v)) ? null : Number(v));

/** Réponses exploitables d’un questionnaire (toutes versions), avec province et catégorie. */
async function jeu({ questionnaireId, campagneId } = {}) {
  const q = db('sect_reponses as r').join('sect_campagnes as c', 'c.id', 'r.campagne_id').join('sect_questionnaire_versions as v', 'v.id', 'c.version_id')
    .join('sect_acteurs as a', 'a.id', 'r.acteur_id').join('sect_zones as z', 'z.id', 'a.zone_id').join('sect_categories as g', 'g.id', 'a.categorie_id')
    .where({ 'c.statut': 'VALIDEE', 'r.statut': 'CONTROLEE' })
    .select('r.valeurs', 'r.acteur_id', 'c.id as campagne_id', 'c.periode', 'c.periode_debut', 'c.reference as campagne_reference', 'a.zone_id', 'z.libelle as zone', 'z.ordre as zone_ordre', 'a.categorie_id', 'g.libelle as categorie', 'g.ordre as categorie_ordre')
    .orderBy('c.periode_debut');
  if (questionnaireId) q.where('v.questionnaire_id', questionnaireId);
  if (campagneId) q.where('c.id', campagneId);
  return q;
}

/** La valeur répond-elle à l’option retenue (choix, choix multiple ou Oui/Non) ? */
function correspond(v, choix) {
  if (vide(v)) return false;
  if (typeof v === 'boolean') return (choix.toLowerCase() === 'oui') === v;
  if (Array.isArray(v)) return v.includes(choix);
  return String(v) === choix;
}

/** Valeur d’un indicateur sur un ensemble de réponses ; n : nombre de répondants pris en compte. */
function calculer(ind, rows) {
  const facteur = Number(ind.facteur) || 1;
  const arrondi = (x) => (x === null ? null : Math.round(x * 10 ** ind.decimales) / 10 ** ind.decimales);
  switch (ind.calcul) {
    case 'SOMME': case 'MOYENNE': {
      const vals = rows.map((r) => nombre(r.valeurs[ind.question])).filter((x) => x !== null);
      if (!vals.length) return { valeur: null, n: 0 };
      const s = vals.reduce((a, b) => a + b, 0);
      return { valeur: arrondi(ind.calcul === 'SOMME' ? s : s / vals.length), n: vals.length };
    }
    case 'RATIO': {
      const paires = rows.map((r) => [nombre(r.valeurs[ind.question]), nombre(r.valeurs[ind.question_denominateur])]).filter(([a, b]) => a !== null && b !== null);
      const den = paires.reduce((s, [, b]) => s + b, 0);
      if (!paires.length || den === 0) return { valeur: null, n: paires.length };
      return { valeur: arrondi((paires.reduce((s, [a]) => s + a, 0) / den) * facteur), n: paires.length };
    }
    case 'NOMBRE': {
      const ok = rows.filter((r) => (!ind.question ? true : ind.valeur_choix ? correspond(r.valeurs[ind.question], ind.valeur_choix) : !vide(r.valeurs[ind.question])));
      return { valeur: ok.length, n: rows.length };
    }
    case 'PART': {
      const repondu = rows.filter((r) => !vide(r.valeurs[ind.question]));
      if (!repondu.length) return { valeur: null, n: 0 };
      return { valeur: arrondi((repondu.filter((r) => correspond(r.valeurs[ind.question], ind.valeur_choix)).length / repondu.length) * 100), n: repondu.length };
    }
    default: return { valeur: null, n: 0 };
  }
}

function grouper(rows, cle, libelle, ordre) {
  const m = new Map();
  for (const r of rows) {
    if (!m.has(r[cle])) m.set(r[cle], { id: r[cle], libelle: r[libelle], ordre: r[ordre], rows: [] });
    m.get(r[cle]).rows.push(r);
  }
  return [...m.values()].sort((a, b) => a.ordre - b.ordre || String(a.libelle).localeCompare(b.libelle));
}

/** Série d’un indicateur : une valeur par campagne validée, détaillée par province et catégorie. */
async function serie(ind) {
  const rows = await jeu({ questionnaireId: ind.questionnaire_id });
  return grouper(rows, 'campagne_id', 'periode', 'periode_debut').map((p) => ({
    campagne_id: p.id, periode: p.libelle, campagne_reference: p.rows[0].campagne_reference, ...calculer(ind, p.rows),
    zones: grouper(p.rows, 'zone_id', 'zone', 'zone_ordre').map((g) => ({ libelle: g.libelle, ...calculer(ind, g.rows) })),
    categories: grouper(p.rows, 'categorie_id', 'categorie', 'categorie_ordre').map((g) => ({ libelle: g.libelle, ...calculer(ind, g.rows) })),
  }));
}

/** Vérifie la définition d’un indicateur au regard des questions publiées du questionnaire. */
async function verifierDefinition(b) {
  const versions = await db('sect_questionnaire_versions').where({ questionnaire_id: b.questionnaire_id, statut: 'PUBLIEE' });
  if (!versions.length) return 'Le questionnaire n’a aucune version publiée.';
  const questions = new Map();
  for (const v of versions) for (const q of v.questions) questions.set(q.code, q);
  const type = (c) => questions.get(c)?.type;
  const numerique = (c) => ['NOMBRE', 'ENTIER'].includes(type(c));
  if (['SOMME', 'MOYENNE', 'RATIO'].includes(b.calcul) && !numerique(b.question)) return 'Choisissez une question numérique du questionnaire.';
  if (b.calcul === 'RATIO' && !numerique(b.question_denominateur)) return 'Choisissez une question numérique pour le dénominateur.';
  if (b.calcul === 'PART' || (b.calcul === 'NOMBRE' && b.question)) {
    const q = questions.get(b.question);
    if (!q) return 'Question inconnue dans le questionnaire.';
    if (b.calcul === 'PART' && !['CHOIX', 'CHOIX_MULTIPLE', 'OUI_NON'].includes(q.type)) return 'Une part de répondants porte sur une question de choix ou Oui/Non.';
    if (b.valeur_choix) {
      const options = q.type === 'OUI_NON' ? ['Oui', 'Non'] : q.options || [];
      if (!options.includes(b.valeur_choix)) return `Option inconnue : choisissez parmi ${options.join(', ')}.`;
    }
  }
  return null;
}

// ─── Tableaux croisés ───────────────────────────────────────────────────────
/**
 * Dimensions : 'zone', 'categorie' ou 'q:CODE' (question de choix ou Oui/Non) ; mesure : 'NOMBRE'
 * (répondants) ou 'SOMME:CODE' / 'MOYENNE:CODE' (question numérique).
 */
function modalites(rows, dim, questions) {
  if (dim === 'zone') return grouper(rows, 'zone_id', 'zone', 'zone_ordre').map((g) => ({ libelle: g.libelle, test: (r) => r.zone_id === g.id }));
  if (dim === 'categorie') return grouper(rows, 'categorie_id', 'categorie', 'categorie_ordre').map((g) => ({ libelle: g.libelle, test: (r) => r.categorie_id === g.id }));
  const code = dim.slice(2);
  const q = questions.find((x) => x.code === code);
  if (!q) return null;
  const options = q.type === 'OUI_NON' ? ['Oui', 'Non'] : q.options || [];
  return [...options.map((o) => ({ libelle: o, test: (r) => correspond(r.valeurs[code], o) })), { libelle: 'Sans réponse', test: (r) => vide(r.valeurs[code]) }];
}

function tableau(rows, questions, { lignes, colonnes, mesure }) {
  const L = modalites(rows, lignes, questions);
  const C = colonnes ? modalites(rows, colonnes, questions) : [{ libelle: 'Total', test: () => true }];
  if (!L || !C) return null;
  const [type, code] = mesure.split(':');
  const ind = type === 'NOMBRE' ? { calcul: 'NOMBRE', decimales: 0 } : { calcul: type, question: code, decimales: 2 };
  const v = (f) => calculer(ind, rows.filter(f)).valeur;
  const lignesOut = L.map((l) => ({ libelle: l.libelle, valeurs: C.map((c) => v((r) => l.test(r) && c.test(r))), total: v(l.test) }))
    .filter((l) => !(l.libelle === 'Sans réponse' && !l.total));
  return {
    colonnes: C.map((c) => c.libelle), lignes: lignesOut, totaux: C.map((c) => v(c.test)), total: v(() => true), repondants: rows.length,
  };
}

async function exporterTableau(titre, t) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Tableau');
  ws.addRow([titre]).font = { bold: true, size: 12 };
  const e = ws.addRow(['', ...t.colonnes, ...(t.colonnes.length > 1 ? ['Total'] : [])]);
  e.eachCell((c) => { c.font = { bold: true, color: { argb: 'FFFFFFFF' } }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF17418A' } }; });
  for (const l of t.lignes) ws.addRow([l.libelle, ...l.valeurs, ...(t.colonnes.length > 1 ? [l.total] : [])]);
  ws.addRow(['Total', ...t.totaux, ...(t.colonnes.length > 1 ? [t.total] : [])]).font = { bold: true };
  ws.addRow([`${t.repondants} répondant(s) — réponses contrôlées de campagnes validées`]).font = { italic: true, size: 9 };
  ws.getColumn(1).width = 40;
  for (let i = 2; i <= t.colonnes.length + 2; i += 1) { ws.getColumn(i).width = 16; ws.getColumn(i).numFmt = '#,##0.##'; }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

module.exports = { CALCULS, jeu, calculer, serie, verifierDefinition, tableau, exporterTableau };

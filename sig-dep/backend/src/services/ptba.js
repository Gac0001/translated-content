'use strict';
/**
 * PTBA au format du Ministère de l’Économie Numérique : lecture d’un classeur existant (une
 * feuille par service : programme, objectif global, objectifs spécifiques, activités, tâches,
 * coût, chronogramme mensuel J…D surligné, structure responsable, résultats attendus,
 * indicateurs, source de vérification, source de financement) et production du même format.
 */
const ExcelJS = require('exceljs');
const db = require('../db/knex');

const MOIS = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];
const BLEU = 'FF17418A';
const JAUNE = 'FFFFFF00';

function texte(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') {
    if (v.richText) return v.richText.map((x) => x.text).join('');
    if (v.result !== undefined) return texte(v.result);
    if (v.text) return String(v.text);
    if (v instanceof Date) return v.toISOString().slice(0, 10);
  }
  return String(v);
}
const propre = (v) => texte(v).replace(/\s+/g, ' ').trim();

/** « 37 944 253 376,00 », 15000000, « 0 » → nombre (CDF). */
function montant(v) {
  if (typeof v === 'number') return Math.max(0, Math.round(v * 100) / 100);
  const t = texte(v).replace(/[\s  ]/g, '').replace(/,(\d{1,2})$/, '.$1').replace(/,/g, '');
  const n = Number.parseFloat(t);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : 0;
}

/** Une cellule du chronogramme est cochée si elle contient une marque ou si elle est colorée. */
function cochee(cell) {
  if (propre(cell.value)) return true;
  const f = cell.fill;
  if (!f || f.type !== 'pattern' || f.pattern !== 'solid') return false;
  const c = f.fgColor || {};
  if (c.argb) return !['FFFFFFFF', '00FFFFFF', 'FFFFFF'].includes(c.argb.toUpperCase());
  return c.theme !== undefined && c.theme !== 0 && c.theme !== 1;
}

const apres = (t) => propre(t.replace(/^[^:]*:\s*:?\s*/, ''));

/** Analyse d’une feuille au format PTBA ; null si la feuille n’a pas ce format. */
function analyserFeuille(ws) {
  let entete = null;
  const cols = {};
  for (let r = 1; r <= Math.min(ws.rowCount, 30) && !entete; r += 1) {
    ws.getRow(r).eachCell({ includeEmpty: false }, (c, i) => {
      if (!entete && /activit[ée]s?\s+principales?/i.test(propre(c.value))) entete = r;
    });
  }
  if (!entete) return null;
  ws.getRow(entete).eachCell({ includeEmpty: false }, (c, i) => {
    const t = propre(c.value).toLowerCase();
    if (/^n°|^no$|^n$/.test(t) && !cols.numero) cols.numero = i;
    else if (/activit/.test(t) && !cols.activite) cols.activite = i;
    else if (/^t[âa]ches?/.test(t) && !cols.taches) cols.taches = i;
    else if (/^co[ûu]t/.test(t) && !cols.cout) cols.cout = i;
    else if (/structure/.test(t) && !cols.structure) cols.structure = i;
    else if (/r[ée]sultat/.test(t) && !cols.resultats) cols.resultats = i;
    else if (/indicateur/.test(t) && !cols.indicateur) cols.indicateur = i;
    else if (/v[ée]rification/.test(t) && !cols.verification) cols.verification = i;
    else if (/financement/.test(t) && !cols.financement) cols.financement = i;
  });
  if (!cols.activite || !cols.cout) return null;
  const moisCols = Array.from({ length: 12 }, (_, k) => cols.cout + 1 + k);
  // En-tête de la feuille : programme, objectif global
  const feuille = { programme: '', objectif_global: '', objectifs: [] };
  for (let r = 1; r < entete; r += 1) {
    const t = propre(ws.getRow(r).getCell(cols.numero || 1).value) || propre(ws.getRow(r).getCell(1).value) || propre(ws.getRow(r).getCell(2).value);
    if (/^programme\s*:/i.test(t)) feuille.programme = apres(t);
    if (/^objectif global/i.test(t)) feuille.objectif_global = apres(t);
  }
  // Les trois lignes d’en-tête (libellés, trimestres, mois) précèdent les données.
  let debut = entete + 1;
  while (debut <= entete + 3) {
    const c = propre(ws.getRow(debut).getCell(cols.cout + 1).value);
    if (/^(t1|j)$/i.test(c) || /activit/i.test(propre(ws.getRow(debut).getCell(cols.activite).value))) debut += 1; else break;
  }
  let courant = null;
  let vides = 0;
  for (let r = debut; r <= ws.rowCount && vides < 8; r += 1) {
    const row = ws.getRow(r);
    const premier = [cols.numero, cols.activite, 1, 2].filter(Boolean).map((i) => propre(row.getCell(i).value)).find(Boolean) || '';
    if (/^objectif sp[ée]cifique/i.test(premier)) {
      courant = { libelle: apres(premier), lignes: [] };
      feuille.objectifs.push(courant);
      vides = 0;
      continue;
    }
    const activite = propre(row.getCell(cols.activite).value);
    if (!activite) { vides += 1; continue; }
    // Sous-totaux du modèle (« S/TOTAL ») ignorés ; le total général clôt la feuille.
    const libelles = [activite, premier, cols.taches ? propre(row.getCell(cols.taches).value) : ''];
    if (libelles.some((t) => /^(s\s*\/\s*|sous[-\s]?)total/i.test(t))) continue;
    if (libelles.some((t) => /^total/i.test(t))) break;
    vides = 0;
    if (!courant) { courant = { libelle: '', lignes: [] }; feuille.objectifs.push(courant); }
    courant.lignes.push({
      numero: cols.numero ? propre(row.getCell(cols.numero).value).slice(0, 20) || null : null,
      activite,
      taches: cols.taches ? texte(row.getCell(cols.taches).value).trim() || null : null,
      cout: montant(row.getCell(cols.cout).value),
      mois: moisCols.map((c, k) => (cochee(row.getCell(c)) ? k + 1 : null)).filter(Boolean),
      structure_responsable: cols.structure ? propre(row.getCell(cols.structure).value).slice(0, 200) || null : null,
      resultats_attendus: cols.resultats ? propre(row.getCell(cols.resultats).value) || null : null,
      indicateur: cols.indicateur ? propre(row.getCell(cols.indicateur).value) || null : null,
      source_verification: cols.verification ? propre(row.getCell(cols.verification).value) || null : null,
      source_financement: cols.financement ? propre(row.getCell(cols.financement).value).slice(0, 200) || null : null,
    });
  }
  feuille.objectifs = feuille.objectifs.filter((o) => o.lignes.length);
  return feuille.objectifs.length ? feuille : null;
}

/** Analyse d’un classeur : une entrée par feuille au format PTBA (les autres sont signalées). */
async function analyser(source) {
  const wb = new ExcelJS.Workbook();
  if (Buffer.isBuffer(source)) await wb.xlsx.load(source); else await wb.xlsx.readFile(source);
  const feuilles = [];
  const ignorees = [];
  wb.eachSheet((ws) => {
    const f = analyserFeuille(ws);
    if (!f) { ignorees.push(ws.name); return; }
    const sigle = ws.name.replace(/^\s*(ptab|ptba)\s+/i, '').trim().toUpperCase().slice(0, 30);
    const lignes = f.objectifs.flatMap((o) => o.lignes);
    feuilles.push({ feuille: ws.name, sigle, ...f, nb_lignes: lignes.length, cout_total: lignes.reduce((s, l) => s + l.cout, 0) });
  });
  return { feuilles, ignorees };
}

/** Coût prévu par trimestre : le coût d’une ligne est réparti sur ses mois cochés (sinon à parts égales). */
function coutParTrimestre(lignes) {
  const t = [0, 0, 0, 0];
  for (const l of lignes) {
    const mois = l.mois && l.mois.length ? l.mois : [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
    const part = Number(l.cout) / mois.length;
    for (const m of mois) t[Math.floor((m - 1) / 3)] += part;
  }
  return t.map((x) => Math.round(x));
}

async function charger(id) {
  const p = await db('ptba as p').join('exercices as e', 'e.id', 'p.exercice_id').join('plan_services as s', 's.id', 'p.service_id')
    .leftJoin('plan_programmes as g', 'g.id', 'p.programme_id').where('p.id', id)
    .first('p.*', 'e.annee', 's.sigle as service_sigle', 's.libelle as service_libelle', 'g.code as programme_code', 'g.libelle as programme_libelle');
  if (!p) return null;
  const objectifs = await db('ptba_objectifs').where({ ptba_id: id }).orderBy(['ordre', 'id']);
  const lignes = await db('ptba_lignes as l').leftJoin('plan_actions as a', 'a.id', 'l.action_id').where('l.ptba_id', id)
    .orderBy(['l.ordre', 'l.id']).select('l.*', 'a.code as action_code', 'a.libelle as action_libelle');
  const suivis = lignes.length ? await db('ptba_suivi').whereIn('ligne_id', lignes.map((l) => l.id)) : [];
  for (const l of lignes) {
    l.cout = Number(l.cout);
    l.suivi = suivis.filter((s) => s.ligne_id === l.id).map((s) => ({ ...s, montant_engage: Number(s.montant_engage), montant_decaisse: Number(s.montant_decaisse) })).sort((a, b) => a.trimestre - b.trimestre);
  }
  return { ...p, objectifs, lignes };
}

/** Exécution d’un ensemble de lignes : dernier suivi trimestriel de chaque ligne. */
function execution(lignes) {
  const cout = lignes.reduce((s, l) => s + Number(l.cout), 0);
  let engage = 0; let decaisse = 0; let physique = 0; let suivies = 0;
  for (const l of lignes) {
    const dernier = (l.suivi || []).reduce((d, s) => (!d || s.trimestre > d.trimestre ? s : d), null);
    if (dernier) { engage += Number(dernier.montant_engage); decaisse += Number(dernier.montant_decaisse); suivies += 1; }
    physique += (dernier ? dernier.taux_physique : 0) * (cout ? Number(l.cout) : 1);
  }
  return {
    cout, engage, decaisse, lignes: lignes.length, suivies,
    tauxPhysique: lignes.length ? Math.round(physique / (cout || lignes.length)) : 0,
    tauxFinancier: cout ? Math.round((decaisse / cout) * 1000) / 10 : 0,
  };
}

// ─── Export au format du Ministère ──────────────────────────────────────────
const bord = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };

function feuillePtba(wb, p, nomFeuille) {
  const ws = wb.addWorksheet(nomFeuille.slice(0, 31), { pageSetup: { orientation: 'landscape', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
  const N = 21;
  ws.columns = [
    { width: 5 }, { width: 34 }, { width: 40 }, { width: 16 },
    ...Array.from({ length: 12 }, () => ({ width: 3.2 })),
    { width: 16 }, { width: 28 }, { width: 26 }, { width: 22 }, { width: 16 },
  ];
  const titre = (r, t, opts = {}) => {
    ws.mergeCells(r, 1, r, N);
    const c = ws.getCell(r, 1);
    c.value = t;
    c.font = { bold: true, size: opts.size || 11, color: opts.couleur ? { argb: opts.couleur } : undefined };
    c.alignment = { horizontal: opts.centre ? 'center' : 'left', vertical: 'middle', wrapText: true };
  };
  titre(1, 'Plan de Travail Annuel Budgétisé', { size: 14, centre: true, couleur: BLEU });
  titre(2, 'Ministère : ÉCONOMIE NUMÉRIQUE');
  titre(3, 'Secrétariat : SECRÉTARIAT GÉNÉRAL AU NUMÉRIQUE');
  titre(4, `Programme : ${p.programme_libelle || '—'}`);
  titre(5, `Objectif global : ${p.objectif_global || '—'}`);
  ws.getRow(5).height = 30;
  titre(6, `Exercice ${p.annee} — ${p.service_sigle} (${p.service_libelle}) — ${p.reference}`);
  // En-têtes sur trois lignes, comme le modèle
  const h = 7;
  const fixes = [[1, 'N°'], [2, 'Activités principales'], [3, 'Tâches'], [4, 'Coût en CDF'], [17, 'Structures responsables'], [18, 'Résultats attendus'], [19, 'Indicateurs de réalisation'], [20, 'Source / moyen de vérification'], [21, 'Source de financement']];
  for (const [c, t] of fixes) { ws.mergeCells(h, c, h + 2, c); ws.getCell(h, c).value = t; }
  ws.mergeCells(h, 5, h, 16); ws.getCell(h, 5).value = 'Chronogramme';
  for (let k = 0; k < 4; k += 1) { ws.mergeCells(h + 1, 5 + k * 3, h + 1, 7 + k * 3); ws.getCell(h + 1, 5 + k * 3).value = `T${k + 1}`; }
  MOIS.forEach((m, k) => { ws.getCell(h + 2, 5 + k).value = m; });
  for (let r = h; r <= h + 2; r += 1) {
    for (let c = 1; c <= N; c += 1) {
      const cell = ws.getCell(r, c);
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 9 };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BLEU } };
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      cell.border = bord;
    }
  }
  let r = h + 3;
  let n = 0;
  const groupes = [...p.objectifs.map((o) => ({ o, lignes: p.lignes.filter((l) => l.objectif_id === o.id) })), { o: null, lignes: p.lignes.filter((l) => !l.objectif_id) }].filter((g) => g.lignes.length);
  groupes.forEach((g, gi) => {
    if (g.o) {
      ws.mergeCells(r, 1, r, N);
      const c = ws.getCell(r, 1);
      c.value = `Objectif spécifique ${gi + 1} : ${g.o.libelle}`;
      c.font = { bold: true }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDCE6F2' } }; c.border = bord;
      c.alignment = { wrapText: true, vertical: 'middle' };
      r += 1;
    }
    for (const l of g.lignes) {
      n += 1;
      const row = ws.getRow(r);
      row.values = [l.numero || n, l.activite, l.taches || '', Number(l.cout), ...Array(12).fill(''), l.structure_responsable || '', l.resultats_attendus || '', l.indicateur || '', l.source_verification || '', l.source_financement || ''];
      for (let c = 1; c <= N; c += 1) {
        const cell = row.getCell(c);
        cell.border = bord;
        cell.alignment = { vertical: 'top', wrapText: c !== 4 && (c < 5 || c > 16), horizontal: c === 4 ? 'right' : undefined };
        cell.font = { size: 9 };
      }
      row.getCell(4).numFmt = '#,##0';
      for (const m of l.mois || []) row.getCell(4 + m).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: JAUNE } };
      r += 1;
    }
  });
  const total = ws.getRow(r);
  ws.mergeCells(r, 1, r, 3);
  total.getCell(1).value = 'TOTAL';
  total.getCell(4).value = p.lignes.reduce((s, l) => s + Number(l.cout), 0);
  total.getCell(4).numFmt = '#,##0';
  for (let c = 1; c <= N; c += 1) { total.getCell(c).font = { bold: true }; total.getCell(c).border = bord; }
  ws.views = [{ state: 'frozen', ySplit: h + 2 }];
  return ws;
}

async function classeur(ptbaIds, { synthese = false } = {}) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'SIG-DEP';
  const tous = [];
  for (const id of ptbaIds) tous.push(await charger(id));
  if (synthese && tous.length) {
    const ws = wb.addWorksheet('Synthèse');
    ws.columns = [{ header: 'Service', width: 14 }, { header: 'Intitulé', width: 40 }, { header: 'Programme', width: 30 }, { header: 'Statut', width: 12 }, { header: 'Lignes', width: 8 },
      { header: 'Coût total (CDF)', width: 20 }, { header: 'T1', width: 16 }, { header: 'T2', width: 16 }, { header: 'T3', width: 16 }, { header: 'T4', width: 16 }];
    ws.getRow(1).eachCell((c) => { c.font = { bold: true, color: { argb: 'FFFFFFFF' } }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BLEU } }; });
    const cumul = [0, 0, 0, 0, 0];
    for (const p of tous) {
      const t = coutParTrimestre(p.lignes);
      const cout = p.lignes.reduce((x, l) => x + Number(l.cout), 0);
      [cout, ...t].forEach((v, i) => { cumul[i] += v; });
      ws.addRow([p.service_sigle, p.service_libelle, p.programme_libelle || '', p.statut, p.lignes.length, cout, ...t]);
    }
    const tot = ws.addRow(['TOTAL', '', '', '', tous.reduce((x, p) => x + p.lignes.length, 0), ...cumul]);
    tot.font = { bold: true };
    for (const c of [6, 7, 8, 9, 10]) ws.getColumn(c).numFmt = '#,##0';
  }
  for (const p of tous) feuillePtba(wb, p, `PTBA ${p.service_sigle}`);
  return wb;
}

module.exports = { analyser, analyserFeuille, montant, coutParTrimestre, charger, execution, classeur, MOIS };

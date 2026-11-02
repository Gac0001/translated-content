'use strict';
/**
 * Fiche PIP — classeur du Ministère du Plan (six feuilles « Feuil1 » à « Feuil6 »), à l’export comme à
 * l’import (cahier des charges, annexe 6). L’export reprend les libellés et les cellules du modèle ;
 * un tableau plus long que celui du modèle insère des lignes. L’import repère chaque rubrique par son
 * libellé, et non par sa position : un classeur rempli à la main, avec des lignes en plus ou en moins,
 * reste lisible.
 */
const ExcelJS = require('exceljs');
const { normalize, synthese, dureeMois } = require('../modules/pip/model');

const COLS = 'ABCDEFGHIJKLM';
const col = (lettre) => COLS.indexOf(lettre) + 1;
const MOIS_EN = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MOIS_FR = ['janv', 'févr', 'mars', 'avr', 'mai', 'juin', 'juil', 'août', 'sept', 'oct', 'nov', 'déc'];

// ─── Export ──────────────────────────────────────────────────────────────────
const GRAS = { bold: true };
const BORD = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
const MONTANT = '#,##0';

function feuille(wb, nom, largeurs, ident, orientation = 'portrait') {
  const ws = wb.addWorksheet(nom, { pageSetup: { paperSize: 9, orientation, fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
  largeurs.forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  ws.properties.defaultRowHeight = 15;
  if (ident) {
    // Le modèle du Ministère du Plan a son propre en-tête : seul le pied de page officiel s’imprime.
    const e = (t) => String(t).replace(/&/g, '&&');
    ws.headerFooter = { oddFooter: `&C&8 ${e(ident.adresse)}&R&8 &P/&N` };
  }
  return ws;
}

/** Écrit une valeur ; `opts` : gras, montant, date, retour à la ligne, bordure. */
function ecrire(ws, adresse, valeur, opts = {}) {
  if (valeur === undefined || valeur === null || valeur === '') { if (!opts.bordure) return; }
  const c = ws.getCell(adresse);
  if (valeur !== undefined && valeur !== null && valeur !== '') c.value = valeur;
  const font = { name: 'Calibri', size: 10, ...(opts.gras ? GRAS : {}), ...(opts.taille ? { size: opts.taille } : {}), ...(opts.italique ? { italic: true } : {}) };
  c.font = font;
  if (opts.montant) c.numFmt = MONTANT;
  if (opts.date) c.numFmt = 'mmm-yy';
  if (opts.bordure) c.border = BORD;
  c.alignment = { vertical: 'top', wrapText: !!opts.wrap, horizontal: opts.centre ? 'center' : opts.montant ? 'right' : undefined };
}

const dateExcel = (iso) => (iso ? new Date(`${String(iso).slice(0, 10)}T00:00:00Z`) : null);
const somme = (vals) => vals.reduce((s, v) => s + (Number(v) || 0), 0);

function feuil1(wb, d, ident) {
  const ws = feuille(wb, 'Feuil1', [22, 18, 24, 24, 26, 16, 18], ident, 'landscape');
  const i = d.identification; const r = d.rattachement; const j = d.justification;
  ecrire(ws, 'F1', 'République Démocratique du Congo', { gras: true });
  ecrire(ws, 'E2', 'Ministère du Plan', { gras: true });
  ecrire(ws, 'C3', 'Direction de la Programmation et Budgétisation', { gras: true });
  ecrire(ws, 'D4', 'FICHE DE PROJET', { gras: true, taille: 13 });
  ecrire(ws, 'D5', 'Etape :', { gras: true });
  ecrire(ws, 'E5', `${i.etape === 'Identification' ? '* ' : ''}Identification`);
  ecrire(ws, 'G5', `${i.etape === 'Sélection' ? '* ' : ''}Sélection`);
  const lignes = [
    ['C6', 'Ministère / Institution :', 'D6', i.ministere], ['C7', 'Service / Société d\'Etat :', 'D7', i.service],
    ['B8', 'N° projet :', 'C8', i.numero_projet], ['D8', 'Libellé :', 'E8', i.libelle], ['B9', 'Compétence :', 'C9', i.competence],
    ['B10', 'Province :', 'C10', i.province_competence], ['E10', 'Secteur prioritaire :', 'F10', i.secteur_prioritaire],
    ['A11', 'Secteur du projet', 'D11', i.secteur], ['F11', 'Ss-secteur', 'G11', i.sous_secteur],
    ['A12', 'Nature d\'investissement', 'D12', i.nature_investissement], ['A13', 'Province', 'D13', i.province],
    ['A14', 'Ville/Territoire', 'D14', i.ville_territoire], ['A15', 'Commune/Secteur/Chefferie', 'D15', i.commune],
    ['B17', '- Pilier', 'C17', r.pnsd_pilier], ['B18', '- Thématique', 'C18', r.pnsd_thematique], ['B19', '- Domaine', 'C19', r.pnsd_domaine],
    ['B20', '- Objectif spécifique', 'C20', r.pnsd_objectif], ['B22', '- Programme budg.', 'C22', r.strategie_programme], ['B23', '- Action', 'C23', r.strategie_action],
    ['B25', '- Problème identifié', 'C25', j.probleme], ['B26', '- Situation actuelle', 'C26', j.situation_actuelle], ['B27', '- Situation visée', 'C27', j.situation_visee],
  ];
  for (const [la, l, va, v] of lignes) { ecrire(ws, la, l); ecrire(ws, va, v, { wrap: true }); }
  for (const [a, t] of [['A16', 'Rattachement PNSD'], ['A21', 'Rattachement stratégie sectorielle'], ['A24', 'Justification du projet']]) ecrire(ws, a, t, { gras: true });
  for (const n of [8, 25, 26, 27]) ws.mergeCells(`${n === 8 ? 'E' : 'C'}${n}:G${n}`);
  for (const n of [17, 18, 19, 20, 22, 23]) ws.mergeCells(`C${n}:G${n}`);
  for (const n of [25, 26, 27]) ws.getRow(n).height = 60;
}

function feuil2(wb, d, ident) {
  const ws = feuille(wb, 'Feuil2', [26, 22, 90], ident);
  const o = d.objectifs;
  let n = 1;
  ecrire(ws, `A${n}`, 'Objectifs visés', { gras: true }); n += 1;
  ecrire(ws, `A${n}`, 'Objectif global'); ecrire(ws, `B${n}`, o.objectif_global, { wrap: true }); ws.mergeCells(`B${n}:C${n}`); n += 1;
  const os = o.objectifs_specifiques;
  for (let k = 0; k < Math.max(3, os.length); k += 1) { ecrire(ws, `A${n}`, `Objectif spécifique ${k + 1}`); ecrire(ws, `B${n}`, os[k], { wrap: true }); ws.mergeCells(`B${n}:C${n}`); n += 1; }
  ecrire(ws, `A${n}`, 'Résultats attendus', { gras: true }); n += 1;
  for (let k = 0; k < Math.max(3, o.resultats.length); k += 1) { ecrire(ws, `B${n}`, `- Résultat ${k + 1}`); ecrire(ws, `C${n}`, o.resultats[k], { wrap: true }); n += 1; }
  for (const [titre, desc, genre] of [['Bénéficiaires directs', o.directs_descriptif, o.directs_genre], ['Bénéficiaires indirects', o.indirects_descriptif, o.indirects_genre]]) {
    ecrire(ws, `A${n}`, titre, { gras: true }); n += 1;
    ecrire(ws, `B${n}`, '- Descriptif'); ecrire(ws, `C${n}`, desc, { wrap: true }); n += 1;
    ecrire(ws, `B${n}`, '- Aspect Genre'); ecrire(ws, `C${n}`, genre, { wrap: true }); n += 1;
  }
  ecrire(ws, `A${n}`, 'Effets/Impacts', { gras: true }); n += 1;
  for (let k = 0; k < Math.max(3, o.effets.length); k += 1) { ecrire(ws, `B${n}`, `- Effet / Impact ${k + 1}`); ecrire(ws, `C${n}`, o.effets[k], { wrap: true }); n += 1; }
}

function feuil3(wb, d, sy, ident) {
  const ws = feuille(wb, 'Feuil3', [44, 4, 20, 10, 16, 3, 16, 10, 16, 3, 16, 20, 8], ident, 'landscape');
  const c = d.calendrier;
  const a0 = sy.anneeDebut;
  ecrire(ws, 'C1', 'Date de début prévue'); ecrire(ws, 'D1', dateExcel(c.date_debut), { date: true });
  ecrire(ws, 'G1', 'Date de fin prévue'); ecrire(ws, 'H1', dateExcel(c.date_fin), { date: true });
  ecrire(ws, 'L1', 'Durée prévue (en mois)'); ecrire(ws, 'M1', c.duree_mois);
  const colonnes = ['E', 'G', 'I', 'K'];
  let n = 2;
  const bloc = (titre, entetes, lignes, cles, min) => {
    ecrire(ws, `A${n}`, titre, { gras: true, wrap: true });
    entetes.forEach((e, k) => ecrire(ws, `${colonnes[k]}${n}`, e, { gras: true, centre: true }));
    n += 1;
    for (let k = 0; k < Math.max(min, lignes.length); k += 1) {
      const l = lignes[k];
      ecrire(ws, `A${n}`, l ? `${k + 1}- ${l[cles[0]] || ''}` : `${k + 1}-`, { wrap: true });
      if (l) cles.slice(1).forEach((cle, m) => ecrire(ws, `${colonnes[m]}${n}`, l[cle], { wrap: true }));
      n += 1;
    }
  };
  bloc('Principales activités (planning)', a0 ? [a0, a0 + 1, a0 + 2, a0 + 3] : ['Année 1', 'Année 2', 'Année 3', 'Année 4'], c.activites, ['activite', 'annee1', 'annee2', 'annee3', 'annee4'], 5);
  bloc('Indicateurs de résultats', ['Année 1', 'Année 2', 'Année 3', 'Autres'], c.indicateurs_resultats, ['indicateur', 'annee1', 'annee2', 'annee3', 'autres'], 3);
  bloc('Indicateurs d\'effets / impacts (Formule de calcul)', [a0 ? `Réf ${a0 - 1}` : 'Réf', 'Année 1', 'Année 2', 'Année 3'], c.indicateurs_effets, ['indicateur', 'reference', 'annee1', 'annee2', 'annee3'], 2);
}

/** Tableau chiffré avec colonne et ligne de totaux (formules, avec leur résultat). */
function tableauChiffre(ws, n, lignes, cle, colonnes, { min, total = true, extra } = {}) {
  const debut = n;
  for (let k = 0; k < Math.max(min, lignes.length); k += 1) {
    const l = lignes[k] || {};
    ecrire(ws, `A${n}`, `${k + 1}- ${l[cle] || ''}`.trim(), { wrap: true });
    if (extra) ecrire(ws, `${extra.col}${n}`, l[extra.cle]);
    colonnes.forEach(([lettre, k2]) => ecrire(ws, `${lettre}${n}`, l[k2], { montant: true, bordure: true }));
    if (total) {
      const vals = colonnes.map(([, k2]) => l[k2]);
      ws.getCell(`H${n}`).value = { formula: `SUM(${colonnes[0][0]}${n}:${colonnes[colonnes.length - 1][0]}${n})`, result: somme(vals) };
      ecrire(ws, `H${n}`, undefined, { montant: true, bordure: true });
    }
    n += 1;
  }
  ecrire(ws, `C${n}`, 'Total', { gras: true });
  const toutes = total ? [...colonnes, ['H', null]] : colonnes;
  for (const [lettre, k2] of toutes) {
    const res = k2 ? somme(lignes.map((l) => l[k2])) : somme(lignes.map((l) => somme(colonnes.map(([, x]) => l[x]))));
    ws.getCell(`${lettre}${n}`).value = { formula: `SUM(${lettre}${debut}:${lettre}${n - 1})`, result: res };
    ecrire(ws, `${lettre}${n}`, undefined, { montant: true, bordure: true, gras: true });
  }
  return n + 1;
}

function feuil4(wb, d, sy, ident) {
  const ws = feuille(wb, 'Feuil4', [40, 6, 16, 18, 18, 18, 18, 20], ident);
  const f = d.financier; const ins = d.institutionnel;
  const a0 = sy.anneeDebut;
  ecrire(ws, 'A1', 'Aspect financier', { gras: true }); ecrire(ws, 'G1', '(en CDF)', { italique: true });
  ecrire(ws, 'A2', 'Coût du Projet :', { gras: true }); ecrire(ws, 'D2', sy.coutTotal, { montant: true, gras: true }); ecrire(ws, 'E2', '(prévisionnel)', { italique: true });
  ecrire(ws, 'A3', 'Répartition des coûts par grandes masses', { gras: true });
  let n = 4;
  ecrire(ws, `A${n}`, 'Rubriques', { gras: true });
  ['D', 'E', 'F', 'G'].forEach((l, k) => ecrire(ws, `${l}${n}`, a0 ? a0 + k : `Année ${k + 1}`, { gras: true, centre: true }));
  ecrire(ws, `H${n}`, 'Total', { gras: true, centre: true });
  n = tableauChiffre(ws, n + 1, f.couts, 'rubrique', [['D', 'annee1'], ['E', 'annee2'], ['F', 'annee3'], ['G', 'annee4']], { min: 6 });
  // Le coût du projet renvoie au total de la répartition
  ws.getCell('D2').value = { formula: `H${n - 1}`, result: sy.coutTotal };
  ecrire(ws, `A${n}`, 'Plan de financement', { gras: true }); n += 1;
  ecrire(ws, `A${n}`, 'Sources de financement', { gras: true }); ecrire(ws, `C${n}`, 'Prêt / don', { gras: true });
  [a0 || 'Année 1', 'Année 2', 'Année 3', 'Autres', 'Total'].forEach((t, k) => ecrire(ws, `${'DEFGH'[k]}${n}`, t, { gras: true, centre: true }));
  n = tableauChiffre(ws, n + 1, f.financement, 'source', [['D', 'annee1'], ['E', 'annee2'], ['F', 'annee3'], ['G', 'autres']], { min: 4, extra: { col: 'C', cle: 'pret_don' } });
  ecrire(ws, `A${n}`, 'Coûts récurrents après mise en exploitation (par an)', { gras: true }); n += 1;
  ecrire(ws, `A${n}`, 'Rubriques', { gras: true });
  [sy.anneeFin ? sy.anneeFin + 1 : 'Année 1', 'Année 2', 'Année 3', 'Année 4', 'Année std'].forEach((t, k) => ecrire(ws, `${'DEFGH'[k]}${n}`, t, { gras: true, centre: true }));
  n = tableauChiffre(ws, n + 1, f.recurrents, 'rubrique', [['D', 'annee1'], ['E', 'annee2'], ['F', 'annee3'], ['G', 'annee4'], ['H', 'standard']], { min: 3, total: false });
  ecrire(ws, `A${n}`, 'Aspect institutionnel', { gras: true }); n += 1;
  ecrire(ws, `A${n}`, 'Pendant le projet', { gras: true, italique: true }); n += 1;
  ecrire(ws, `A${n}`, '1- Maitre d\'ouvrage'); ecrire(ws, `C${n}`, ins.maitre_ouvrage); n += 1;
  ecrire(ws, `A${n}`, '2- Maitre d’œuvre'); ecrire(ws, `C${n}`, ins.maitre_oeuvre); n += 1;
  ecrire(ws, `A${n}`, 'Après le projet', { gras: true, italique: true }); n += 1;
  ecrire(ws, `A${n}`, 'Structure responsable'); ecrire(ws, `C${n}`, ins.structure_responsable);
}

function feuil5(wb, d, ident) {
  const ws = feuille(wb, 'Feuil5', [44, 6, 12, 22, 18, 18, 18, 20], ident);
  const ins = d.institutionnel;
  ecrire(ws, 'A1', 'Nombre d\'emplois créés', { gras: true }); ecrire(ws, 'C1', ins.emplois); ecrire(ws, 'E1', 'dont femmes'); ecrire(ws, 'F1', ins.emplois_femmes);
  ecrire(ws, 'G2', '(en CDF)', { italique: true });
  ecrire(ws, 'A3', 'Gains économiques estimés', { gras: true });
  ecrire(ws, 'A4', 'Rubriques', { gras: true });
  ['Année 1', 'Année 2', 'Année 3', 'Autres', 'Total'].forEach((t, k) => ecrire(ws, `${'DEFGH'[k]}4`, t, { gras: true, centre: true }));
  let n = tableauChiffre(ws, 5, ins.gains, 'rubrique', [['D', 'annee1'], ['E', 'annee2'], ['F', 'annee3'], ['G', 'autres']], { min: 2 });
  ecrire(ws, `A${n}`, 'Impacts environnementaux', { gras: true }); ecrire(ws, `D${n}`, 'Si négatif, mitigation', { gras: true }); n += 1;
  const deux = (lignes, a, b, min) => {
    for (let k = 0; k < Math.max(min, lignes.length); k += 1) {
      const l = lignes[k] || {};
      ecrire(ws, `A${n}`, `${k + 1}- ${l[a] || ''}`.trim(), { wrap: true }); ecrire(ws, `D${n}`, l[b], { wrap: true }); ws.mergeCells(`D${n}:H${n}`); n += 1;
    }
  };
  deux(ins.impacts_environnementaux, 'impact', 'mitigation', 2);
  ecrire(ws, `A${n}`, 'Risques portant sur la réalisation du projet / Mitigation', { gras: true }); n += 1;
  ecrire(ws, `A${n}`, 'Risques', { gras: true }); ecrire(ws, `D${n}`, 'Mitigations', { gras: true }); n += 1;
  deux(ins.risques, 'risque', 'mitigation', 3);
}

function feuil6(wb, d, ident) {
  const ws = feuille(wb, 'Feuil6', [40, 14, 34, 14, 6, 18], ident);
  const c = d.controle;
  ecrire(ws, 'A1', 'Commentaire libre', { gras: true });
  ecrire(ws, 'A2', c.commentaire, { wrap: true }); ws.mergeCells('A2:F2'); ws.getRow(2).height = 75;
  ecrire(ws, 'A3', 'Si étape de sélection', { italique: true });
  ecrire(ws, 'A4', 'Etudes réalisées', { gras: true });
  ecrire(ws, 'A5', 'Nature de l\'étude', { gras: true }); ecrire(ws, 'D5', 'Date de fin', { gras: true }); ecrire(ws, 'F5', 'Montant', { gras: true });
  let n = 6;
  for (const e of c.etudes) {
    ecrire(ws, `A${n}`, e.nature, { wrap: true }); ecrire(ws, `D${n}`, dateExcel(e.date_fin), { date: true }); ecrire(ws, `F${n}`, e.montant, { montant: true }); n += 1;
  }
  ecrire(ws, `A${n}`, 'Responsable du dossier', { gras: true }); ecrire(ws, `C${n}`, c.responsable); n += 1;
  ecrire(ws, `B${n}`, 'Télephone'); ecrire(ws, `C${n}`, c.telephone); n += 1;
  ecrire(ws, `B${n}`, 'email'); ecrire(ws, `C${n}`, c.email); n += 1;
  ecrire(ws, `B${n}`, 'Date :'); ecrire(ws, `C${n}`, c.date_fiche ? dateExcel(c.date_fiche) : null); if (c.date_fiche) ws.getCell(`C${n}`).numFmt = 'dd/mm/yyyy';
  ecrire(ws, `F${n}`, 'Signature', { gras: true });
}

/** Classeur de la fiche au modèle du Ministère du Plan. */
async function exporter(donnees, ident) {
  const { donnees: d } = normalize(donnees);
  const sy = synthese(d);
  const wb = new ExcelJS.Workbook();
  wb.creator = 'SIG-DEP';
  feuil1(wb, d, ident); feuil2(wb, d, ident); feuil3(wb, d, sy, ident); feuil4(wb, d, sy, ident); feuil5(wb, d, ident); feuil6(wb, d, ident);
  return wb.xlsx.writeBuffer();
}

// ─── Import ──────────────────────────────────────────────────────────────────
const texte = (v) => {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    if (v.richText) return v.richText.map((t) => t.text).join('');
    if ('result' in v) return texte(v.result);
    if (v.text) return String(v.text);
    return '';
  }
  return String(v).trim();
};
const sansAccents = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, ' ').trim();

/** Montant écrit en nombre ou en texte (« 15,000,000,000 », « 1 500 000 », « 2,5 »). */
function montant(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return v;
  if (typeof v === 'object' && 'result' in v) return montant(v.result);
  let s = texte(v).replace(/[\s  ]/g, '').replace(/(CDF|FC|USD|\$)/gi, '');
  if (!s) return null;
  if (/^-?\d{1,3}([,.]\d{3})+$/.test(s)) s = s.replace(/[,.]/g, '');
  else s = s.replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Date d’un classeur : date Excel, « Jan-25 », « janv.-2025 », « 01/2025 », « 2025-01-15 ». */
function dateDe(v, finDeMois = false) {
  if (v === null || v === undefined || v === '') return null;
  let a; let m; let j = null;
  if (v instanceof Date) { a = v.getUTCFullYear(); m = v.getUTCMonth() + 1; j = finDeMois ? null : v.getUTCDate(); }
  else if (typeof v === 'number') { const d = new Date(Math.round((v - 25569) * 86400000)); a = d.getUTCFullYear(); m = d.getUTCMonth() + 1; }
  else {
    const s = sansAccents(texte(v));
    let x = s.match(/^(\d{4})-(\d{2})(?:-(\d{2}))?/);
    if (x) { a = +x[1]; m = +x[2]; j = x[3] ? +x[3] : null; }
    else if ((x = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/))) { a = +x[3] < 100 ? 2000 + +x[3] : +x[3]; m = +x[2]; j = +x[1]; }
    else if ((x = s.match(/^(\d{1,2})[/-](\d{4})$/))) { a = +x[2]; m = +x[1]; }
    else if ((x = s.match(/^([a-z]+)\.?[\s-]*(\d{2,4})$/))) {
      const nom = x[1].slice(0, 3);
      const idx = MOIS_EN.findIndex((k) => k === nom) >= 0 ? MOIS_EN.findIndex((k) => k === nom) : MOIS_FR.findIndex((k) => sansAccents(k).slice(0, 3) === nom);
      if (idx < 0) return null;
      a = +x[2] < 100 ? 2000 + +x[2] : +x[2]; m = idx + 1;
    } else return null;
  }
  if (!a || !m || m > 12) return null;
  if (!j) j = finDeMois ? new Date(Date.UTC(a, m, 0)).getUTCDate() : 1;
  return `${a}-${String(m).padStart(2, '0')}-${String(j).padStart(2, '0')}`;
}

/** Lignes d’une feuille : [{ n, cellules: [{ c, v, t }] }] (cellules non vides). */
function lignesDe(ws) {
  const out = [];
  ws.eachRow({ includeEmpty: false }, (row, n) => {
    const cellules = [];
    row.eachCell({ includeEmpty: false }, (cell, c) => { if (cell.isMerged && cell.master !== cell) return; /* cellule fusionnée : seule la première compte */ const t = texte(cell.value); if (t !== '') cellules.push({ c, v: cell.value, t }); });
    if (cellules.length) out.push({ n, cellules });
  });
  return out;
}

const LIBELLES = [
  'ministere / institution', 'service / societe', 'n° projet', 'libelle :', 'competence', 'province :', 'secteur prioritaire', 'secteur du projet', 'ss-secteur',
  "nature d'investissement", 'province', 'ville/territoire', 'commune/secteur', '- pilier', '- thematique', '- domaine', '- objectif specifique', '- programme budg', '- action',
  '- probleme', '- situation actuelle', '- situation visee', 'etape :', 'dont femmes', 'telephone', 'email', 'date :', 'signature',
];
const estLibelle = (t) => {
  const s = sansAccents(t).replace(/\s*:\s*$/, '');
  return LIBELLES.some((l) => { const x = l.replace(/\s*:\s*$/, ''); return s === x || (x.length > 12 && s.startsWith(x)); });
};

/** Valeur qui suit un libellé sur sa ligne (la cellule suivante non vide qui n’est pas un autre libellé). */
function valeurApres(lignes, motif, { brut = false } = {}) {
  for (const l of lignes) {
    const i = l.cellules.findIndex((x) => motif.test(sansAccents(x.t)));
    if (i < 0) continue;
    const suivante = l.cellules[i + 1];
    if (!suivante || estLibelle(suivante.t)) return brut ? null : '';
    return brut ? suivante.v : suivante.t;
  }
  return brut ? null : '';
}
const ligneOu = (lignes, motif, apres = 0) => lignes.find((l) => l.n > apres && l.cellules.some((x) => motif.test(sansAccents(x.t))));
const sansNumero = (t) => String(t || '').replace(/^\s*\d+\s*[-.)]\s*/, '').trim();
const cellule = (l, c) => (l.cellules.find((x) => x.c === c) || {});

/** Lignes d’un tableau entre deux repères ; chaque ligne → objet via `lire`. */
function tableau(lignes, debut, fin, lire) {
  if (!debut) return [];
  return lignes.filter((l) => l.n > debut.n && (!fin || l.n < fin.n)).map(lire).filter(Boolean);
}

function lireFeuil1(L, alertes) {
  const etape = L.some((l) => l.cellules.some((x) => /^\*\s*s[eé]lection/i.test(x.t))) ? 'Sélection' : 'Identification';
  const identification = {
    etape,
    ministere: valeurApres(L, /^ministere \/ institution/), service: valeurApres(L, /^service \/ societe/),
    numero_projet: valeurApres(L, /^n° projet/), libelle: valeurApres(L, /^libelle\s*:/), competence: '',
    province_competence: valeurApres(L, /^province\s*:/), secteur_prioritaire: valeurApres(L, /^secteur prioritaire/),
    secteur: valeurApres(L, /^secteur du projet/), sous_secteur: valeurApres(L, /^ss-secteur/), nature_investissement: valeurApres(L, /^nature d'investissement/),
    province: valeurApres(L, /^province$/), ville_territoire: valeurApres(L, /^ville\/territoire/), commune: valeurApres(L, /^commune\/secteur/),
  };
  const comp = sansAccents(valeurApres(L, /^competence/));
  identification.competence = /provinc/.test(comp) ? 'Pouvoir provincial' : 'Pouvoir central';
  if (comp && !/central|provinc/.test(comp)) alertes.push(`Compétence « ${valeurApres(L, /^competence/)} » non reconnue : « Pouvoir central » retenu.`);
  return {
    identification,
    rattachement: {
      pnsd_pilier: valeurApres(L, /^- pilier/), pnsd_thematique: valeurApres(L, /^- thematique/), pnsd_domaine: valeurApres(L, /^- domaine/),
      pnsd_objectif: valeurApres(L, /^- objectif specifique/), strategie_programme: valeurApres(L, /^- programme budg/), strategie_action: valeurApres(L, /^- action/),
    },
    justification: { probleme: valeurApres(L, /^- probleme/), situation_actuelle: valeurApres(L, /^- situation actuelle/), situation_visee: valeurApres(L, /^- situation visee/) },
  };
}

function lireFeuil2(L) {
  const liste = (motif) => L.filter((l) => l.cellules.some((x) => motif.test(sansAccents(x.t)))).map((l) => { const i = l.cellules.findIndex((x) => motif.test(sansAccents(x.t))); return (l.cellules[i + 1] || {}).t || ''; }).filter(Boolean);
  const dir = ligneOu(L, /^beneficiaires directs/); const ind = ligneOu(L, /^beneficiaires indirects/); const eff = ligneOu(L, /^effets/);
  const bloc = (debut, fin, motif) => { const l = L.find((x) => debut && x.n > debut.n && (!fin || x.n < fin.n) && x.cellules.some((y) => motif.test(sansAccents(y.t)))); if (!l) return ''; const i = l.cellules.findIndex((y) => motif.test(sansAccents(y.t))); return (l.cellules[i + 1] || {}).t || ''; };
  return {
    objectif_global: valeurApres(L, /^objectif global/),
    objectifs_specifiques: liste(/^objectif specifique \d/),
    resultats: liste(/^- resultat \d/),
    directs_descriptif: bloc(dir, ind, /^- descriptif/), directs_genre: bloc(dir, ind, /^- aspect genre/),
    indirects_descriptif: bloc(ind, eff, /^- descriptif/), indirects_genre: bloc(ind, eff, /^- aspect genre/),
    effets: liste(/^- effet/),
  };
}

function lireFeuil3(L) {
  const dateDebut = dateDe(valeurApres(L, /^date de debut/, { brut: true }));
  const dateFin = dateDe(valeurApres(L, /^date de fin/, { brut: true }), true);
  const act = ligneOu(L, /^principales activites/); const res = ligneOu(L, /^indicateurs de resultats/); const eff = ligneOu(L, /^indicateurs d'effets/);
  // Colonnes des années : celles de la ligne d’en-tête du bloc, dans l’ordre
  const colonnes = (entete) => entete.cellules.filter((x) => x.c > 1).map((x) => x.c);
  const lire = (entete, cles) => (l) => {
    const libelle = sansNumero((l.cellules.find((x) => x.c === 1) || {}).t);
    const cols = colonnes(entete);
    const r = { [cles[0]]: libelle };
    cles.slice(1).forEach((k, i) => { r[k] = cols[i] ? (cellule(l, cols[i]).t || null) : null; });
    return Object.values(r).some((v) => v) ? r : null;
  };
  return {
    date_debut: dateDebut, date_fin: dateFin, duree_mois: dureeMois(dateDebut, dateFin) ?? montant(valeurApres(L, /^duree prevue/, { brut: true })),
    activites: tableau(L, act, res, lire(act, ['activite', 'annee1', 'annee2', 'annee3', 'annee4'])),
    indicateurs_resultats: res ? tableau(L, res, eff, lire(res, ['indicateur', 'annee1', 'annee2', 'annee3', 'autres'])) : [],
    indicateurs_effets: eff ? tableau(L, eff, null, lire(eff, ['indicateur', 'reference', 'annee1', 'annee2', 'annee3'])) : [],
  };
}

/** Lignes chiffrées d’un tableau, de l’en-tête jusqu’à la ligne « Total ». */
function chiffres(L, entete, cles, { libelle = 'rubrique', extra } = {}) {
  if (!entete) return [];
  const total = L.find((l) => l.n > entete.n && l.cellules.some((x) => /^total$/i.test(x.t)));
  // Colonnes chiffrées : en-tête à partir de la colonne D (C : « Prêt / don »)
  const cols = entete.cellules.filter((x) => x.c >= 4).map((x) => x.c);
  return tableau(L, entete, total, (l) => {
    const r = { [libelle]: sansNumero(cellule(l, 1).t) || null };
    if (extra) r[extra] = cellule(l, 3).t || null;
    cles.forEach((k, i) => { r[k] = cols[i] ? montant(cellule(l, cols[i]).v) : null; });
    return r[libelle] || cles.some((k) => r[k] !== null) ? r : null;
  });
}

function lireFeuil4(L) {
  const rep = ligneOu(L, /^repartition des couts/); const plan = ligneOu(L, /^plan de financement/); const rec = ligneOu(L, /^couts recurrents/);
  const enteteCouts = ligneOu(L, /^rubriques$/, rep ? rep.n : 0);
  const enteteFin = ligneOu(L, /^sources de financement/, plan ? plan.n : 0);
  const enteteRec = rec ? ligneOu(L, /^rubriques$/, rec.n) : null;
  return {
    financier: {
      couts: chiffres(L, enteteCouts, ['annee1', 'annee2', 'annee3', 'annee4']).filter((r) => r.rubrique),
      financement: chiffres(L, enteteFin, ['annee1', 'annee2', 'annee3', 'autres'], { libelle: 'source', extra: 'pret_don' }).filter((r) => r.source || ['annee1', 'annee2', 'annee3', 'autres'].some((k) => r[k])),
      recurrents: chiffres(L, enteteRec, ['annee1', 'annee2', 'annee3', 'annee4', 'standard']).filter((r) => r.rubrique),
    },
    institutionnel: {
      maitre_ouvrage: valeurApres(L, /maitre d'ouvrage/), maitre_oeuvre: valeurApres(L, /maitre d'(œ|oe)uvre/),
      structure_responsable: valeurApres(L, /^structure responsable/),
    },
  };
}

function lireFeuil5(L) {
  const gains = ligneOu(L, /^gains economiques/); const env = ligneOu(L, /^impacts environnementaux/); const risq = ligneOu(L, /^risques portant/);
  const enteteGains = gains ? ligneOu(L, /^rubriques$/, gains.n) : null;
  const enteteRisques = risq ? ligneOu(L, /^risques$/, risq.n) : null;
  const deux = (debut, fin, a, b) => tableau(L, debut, fin, (l) => {
    const x = sansNumero(cellule(l, 1).t); const y = (l.cellules.find((c) => c.c >= 4) || {}).t || null;
    return x || y ? { [a]: x || null, [b]: y } : null;
  });
  return {
    emplois: montant(valeurApres(L, /^nombre d'emplois/, { brut: true })), emplois_femmes: montant(valeurApres(L, /^dont femmes/, { brut: true })),
    gains: chiffres(L, enteteGains, ['annee1', 'annee2', 'annee3', 'autres']).filter((r) => r.rubrique),
    impacts_environnementaux: deux(env, risq, 'impact', 'mitigation'),
    risques: deux(enteteRisques || risq, null, 'risque', 'mitigation'),
  };
}

function lireFeuil6(L) {
  const com = ligneOu(L, /^commentaire libre/); const sel = ligneOu(L, /^si etape de selection|^etudes realisees/);
  const entete = ligneOu(L, /^nature de l'etude/); const resp = ligneOu(L, /^responsable du dossier/);
  const commentaire = com ? L.filter((l) => l.n > com.n && (!sel || l.n < sel.n)).map((l) => l.cellules.map((x) => x.t).join(' ')).join('\n') : '';
  const etudes = entete ? tableau(L, entete, resp, (l) => {
    const nature = cellule(l, 1).t; if (!nature) return null;
    return { nature, date_fin: dateDe(cellule(l, 4).v), montant: montant(cellule(l, 6).v) };
  }) : [];
  return {
    commentaire, etudes,
    responsable: valeurApres(L, /^responsable du dossier/), telephone: valeurApres(L, /^telephone/), email: valeurApres(L, /^email|^courriel/),
    date_fiche: dateDe(valeurApres(L, /^date\s*:/, { brut: true })),
  };
}

/**
 * Lit un classeur au modèle du Ministère du Plan. Renvoie la fiche normalisée, les rubriques
 * manquantes, les incohérences et les alertes de lecture.
 */
async function analyser(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const alertes = [];
  const feuilles = wb.worksheets.filter((w) => w.state !== 'hidden');
  if (feuilles.length < 6) alertes.push(`Le classeur compte ${feuilles.length} feuille(s) ; le modèle du Ministère du Plan en compte six : les rubriques absentes restent vides.`);
  const L = feuilles.slice(0, 6).map(lignesDe);
  while (L.length < 6) L.push([]);
  if (!L[0].some((l) => l.cellules.some((x) => /fiche de projet/i.test(x.t)))) alertes.push('La première feuille ne porte pas le titre « FICHE DE PROJET » : vérifiez qu’il s’agit bien du modèle du Ministère du Plan.');
  const f1 = lireFeuil1(L[0], alertes); const f4 = lireFeuil4(L[3]); const f5 = lireFeuil5(L[4]);
  const brut = {
    ...f1,
    objectifs: lireFeuil2(L[1]),
    calendrier: lireFeuil3(L[2]),
    financier: f4.financier,
    institutionnel: { ...f4.institutionnel, ...f5 },
    controle: lireFeuil6(L[5]),
  };
  // Montant « Coût du projet » de la feuille 4, comparé à la somme de la répartition
  const coutAnnonce = montant(valeurApres(L[3], /^cout du projet/, { brut: true }));
  const r = normalize(brut);
  if (coutAnnonce !== null && Math.abs(coutAnnonce - r.synthese.coutTotal) > 0.5) {
    alertes.push(`Le coût du projet indiqué (${coutAnnonce.toLocaleString('fr-FR')} CDF) diffère de la somme de la répartition par grandes masses (${r.synthese.coutTotal.toLocaleString('fr-FR')} CDF) : la somme est retenue.`);
  }
  if (!r.donnees.calendrier.date_debut && L[2].length) alertes.push('Date de début prévue illisible : à saisir.');
  return { ...r, alertes };
}

module.exports = { exporter, analyser, montant, dateDe };

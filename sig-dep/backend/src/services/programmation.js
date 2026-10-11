'use strict';
/**
 * Données et documents de programmation : cadre de performance, crédits, et production du
 * Projet Annuel de Performance (PAP, Word), du Rapport Annuel de Performance (RAP, Word) et du
 * Cadre de Dépenses à Moyen Terme (CDMT, Excel), selon le plan du PAP du Ministère.
 */
const ExcelJS = require('exceljs');
const {
  Document, Packer, Paragraph, TextRun, AlignmentType, Table, TableRow, TableCell, WidthType, HeadingLevel, ShadingType, PageOrientation, PageBreak,
} = require('docx');
const db = require('../db/knex');
const ptba = require('./ptba');
const cadrage = require('./cadrage');

const BLEU = '0B3D6E';
const fmt = (n) => (n === null || n === undefined || n === '' ? '—' : Math.round(Number(n)).toLocaleString('fr-FR').replace(/ | /g, ' '));
const fmtVal = (v) => (v === null || v === undefined ? '—' : String(Number(v)).replace('.', ','));

// ─── Données ────────────────────────────────────────────────────────────────
async function cadre(annees) {
  const [programmes, actions, objectifs, indicateurs] = await Promise.all([
    db('plan_programmes').where({ actif: true }).orderBy(['ordre', 'code']),
    db('plan_actions').where({ actif: true }).orderBy(['programme_id', 'code']),
    db('plan_objectifs').where({ actif: true }).orderBy(['programme_id', 'ordre', 'id']),
    db('plan_indicateurs').where({ actif: true }).orderBy(['objectif_id', 'ordre', 'id']),
  ]);
  const valeurs = indicateurs.length ? await db('plan_indicateur_valeurs').whereIn('indicateur_id', indicateurs.map((i) => i.id)).whereIn('annee', annees) : [];
  for (const i of indicateurs) {
    i.valeurs = {};
    for (const v of valeurs.filter((x) => x.indicateur_id === i.id)) i.valeurs[`${v.type}:${v.annee}`] = { valeur: Number(v.valeur), commentaire: v.commentaire };
  }
  for (const o of objectifs) o.indicateurs = indicateurs.filter((i) => i.objectif_id === o.id);
  return {
    programmes: programmes.map((p) => ({ ...p, actions: actions.filter((a) => a.programme_id === p.id), objectifs: objectifs.filter((o) => o.programme_id === p.id) })),
    objectifsMinistere: objectifs.filter((o) => !o.programme_id),
  };
}

async function credits(annees) {
  const [postes, rows] = await Promise.all([
    db('plan_postes_budgetaires').orderBy(['axe', 'ordre']),
    db('plan_credits').whereIn('annee', annees),
  ]);
  return { postes, credits: rows.map((r) => ({ ...r, montant: Number(r.montant) })) };
}

/**
 * Les crédits saisis par action détaillent ceux du programme : les totaux par programme, rubrique
 * et titre ne retiennent que les montants du programme ; le tableau par action, ceux des actions.
 */
const auProgramme = (rows) => rows.filter((r) => !r.action_id);

/** Somme des crédits filtrés. */
function somme(rows, f) {
  const s = rows.filter(f).reduce((x, r) => x + r.montant, 0);
  return rows.some(f) ? s : null;
}

// ─── Word ───────────────────────────────────────────────────────────────────
const para = (text, o = {}) => new Paragraph({ alignment: o.align, spacing: { after: o.after ?? 100 }, heading: o.heading, children: [new TextRun({ text: String(text ?? ''), bold: o.bold, size: o.size || 21, color: o.color, italics: o.italics })] });
const titre = (text, niveau = 1) => new Paragraph({
  heading: niveau === 1 ? HeadingLevel.HEADING_1 : niveau === 2 ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_3,
  spacing: { before: 240, after: 120 }, children: [new TextRun({ text, bold: true, size: niveau === 1 ? 28 : niveau === 2 ? 24 : 22, color: BLEU })],
});
const texte = (t) => String(t || '').split('\n').filter((l) => l.trim()).map((l) => para(l, { align: AlignmentType.JUSTIFIED }));
const legende = (t) => para(t, { bold: true, size: 19, after: 60 });

function tableau(entetes, lignes, { largeurs } = {}) {
  const cellule = (t, o = {}) => new TableCell({
    shading: o.entete ? { type: ShadingType.SOLID, color: BLEU, fill: BLEU } : o.fond ? { type: ShadingType.SOLID, color: o.fond, fill: o.fond } : undefined,
    columnSpan: o.span,
    width: o.largeur ? { size: o.largeur, type: WidthType.PERCENTAGE } : undefined,
    children: [new Paragraph({ alignment: o.droite ? AlignmentType.RIGHT : undefined, children: [new TextRun({ text: String(t ?? ''), bold: o.entete || o.gras, color: o.entete ? 'FFFFFF' : undefined, size: 17 })] })],
  });
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      ...entetes.map((ligne) => new TableRow({ tableHeader: true, children: ligne.map((c) => cellule(c.t ?? c, { entete: true, span: c.span })) })),
      ...lignes.map((l) => new TableRow({
        children: (l.cells || l).map((c, i) => (l.titre ? cellule(c, { gras: true, fond: 'DCE6F2', span: l.span })
          : cellule(c, { droite: typeof c === 'string' && /^[\d\s—,%-]+$/.test(c) && i > 0, gras: l.gras, largeur: largeurs && largeurs[i] }))),
      })),
    ],
  });
}

function tableauPerformance(objectifs, A) {
  const ans = { realisations: [A - 4, A - 3, A - 2], encours: A - 1, cibles: [A, A + 1, A + 2] };
  const lignes = [];
  objectifs.forEach((o, oi) => {
    lignes.push({ titre: true, span: 10, cells: [`Objectif ${oi + 1} : ${o.libelle}`] });
    o.indicateurs.forEach((i, ii) => {
      const v = (type, an) => fmtVal(i.valeurs[`${type}:${an}`]?.valeur);
      const enCours = i.valeurs[`REALISATION:${ans.encours}`] ? v('REALISATION', ans.encours) : v('REALISATION_S1', ans.encours);
      lignes.push([String(ii + 1), i.libelle, i.unite, ...ans.realisations.map((an) => v('REALISATION', an)), enCours, ...ans.cibles.map((an) => v('CIBLE', an))]);
      const notes = [i.source && `Source : ${i.source}`, i.mode_calcul && `Mode de calcul : ${i.mode_calcul}`, i.commentaire && `Commentaires : ${i.commentaire}`].filter(Boolean);
      if (notes.length) lignes.push({ titre: false, span: 10, cells: [notes.join(' — ')], gras: false, notes: true });
    });
  });
  // Les lignes de notes s’étendent sur toute la largeur
  return tableau([
    [{ t: 'N°' }, { t: 'Indicateurs' }, { t: 'Unité de mesure' }, { t: 'Réalisations', span: 3 }, { t: 'Exercice en cours' }, { t: 'Cibles', span: 3 }],
    ['', '', '', ...ans.realisations.map(String), `${ans.encours}`, ...ans.cibles.map(String)],
  ], lignes.map((l) => (l.notes ? { titre: true, span: 10, cells: l.cells } : l)));
}

function colonnesCredits(A) {
  return [
    [{ t: '' }, { t: `Réalisations ${A - 2}`, span: 2 }, { t: `Exercice en cours ${A - 1}`, span: 2 }, { t: `Prévisions ${A}` }],
    ['', 'Crédits votés (CDF)', 'Exécution (CDF)', 'Crédits votés (CDF)', 'Exécution à fin juin (CDF)', 'Crédits (CDF)'],
  ];
}

function ligneCredits(libelle, rows, f, A, gras) {
  const cell = (an, type) => fmt(somme(rows, (r) => r.annee === an && r.type === type && f(r)));
  return { gras, cells: [libelle, cell(A - 2, 'VOTE'), cell(A - 2, 'EXECUTE'), cell(A - 1, 'VOTE'), cell(A - 1, 'EXECUTE_S1'), cell(A, 'PREVISION')] };
}

/** PAP : plafonds du CBMT applicable comparés aux prévisions de l’exercice. */
async function tableauCadrage(A) {
  const c = await cadrage.controle(A);
  if (!c) return [];
  const y = c.annees.find((x) => x.annee === A);
  if (!y) return [];
  return [
    legende(`Tableau 5 : Respect des plafonds du CBMT ${c.cbmt.periode}${c.cbmt.statut === 'VALIDE' ? '' : ' (cadrage non validé)'} — exercice ${A}`),
    tableau([['Rubrique', 'Plafond CBMT (CDF)', `Prévision ${A} (CDF)`, 'Écart (CDF)']], [
      ...y.lignes.map((l) => [l.libelle, fmt(l.plafond), fmt(l.prevision), l.ecart === null ? '—' : `${l.depasse ? 'Dépassement ' : ''}${fmt(l.ecart)}`]),
      { gras: true, cells: ['Total', fmt(y.total.plafond), fmt(y.total.prevision), y.total.ecart === null ? '—' : fmt(y.total.ecart)] },
    ]),
  ];
}

/** PAP : actions prioritaires du CBMT rattachées au programme. */
function actionsPrioritaires(cbmt, programmeId) {
  const actions = ((cbmt && cbmt.contenu && cbmt.contenu.actions) || []).filter((a) => a.programme_id === programmeId);
  if (!actions.length) return [];
  return [titre('Actions prioritaires retenues par le cadrage budgétaire', 3), ...actions.map((a) => para(`• ${a.libelle}`))];
}

async function pap(doc) {
  const A = doc.annee;
  const c = doc.contenu || {};
  const { programmes, objectifsMinistere } = await cadre([A - 4, A - 3, A - 2, A - 1, A, A + 1, A + 2]);
  const { postes, credits: tous } = await credits([A - 2, A - 1, A]);
  const rows = auProgramme(tous);
  const rubriques = postes.filter((p) => p.axe === 'RUBRIQUE');
  const titres = postes.filter((p) => p.axe === 'TITRE');
  const cbmtPap = await cadrage.cbmtPour(A);
  const corps = [
    para('RÉPUBLIQUE DÉMOCRATIQUE DU CONGO', { align: AlignmentType.CENTER, bold: true, color: BLEU }),
    para(c.ministere || 'ÉCONOMIE NUMÉRIQUE', { align: AlignmentType.CENTER, bold: true, size: 36, color: BLEU, after: 0 }),
    para(c.section ? `(Section ${c.section})` : '', { align: AlignmentType.CENTER, size: 24 }),
    para(`PROJET ANNUEL DE PERFORMANCE ${A}`, { align: AlignmentType.CENTER, bold: true, size: 32, after: 400 }),
    ...(c.responsable ? [para(`Responsable : ${c.responsable}`, { align: AlignmentType.CENTER, italics: true })] : []),
    new Paragraph({ children: [new PageBreak()] }),
    titre('1. Présentation stratégique du Ministère'),
    titre('1.1. Missions et organisation du Ministère', 2),
    titre('Missions du Ministère', 3), ...texte(c.missions),
    titre('Organisation du Ministère', 3), ...texte(c.organisation),
    titre('1.2. Maquette programmatique', 2),
    legende('Tableau 1 : Maquette programmatique du Ministère'),
    tableau([['Code', 'Programme / Action', 'Services normatifs', 'Opérateurs']], programmes.flatMap((p) => [
      { titre: true, span: 4, cells: [`Programme ${p.code} : ${p.libelle}`] },
      ...p.actions.map((a) => [a.code, a.libelle, a.services_normatifs || '', a.operateurs || '']),
    ])),
    titre('1.3. Performances antérieures et perspectives', 2),
    titre('Performances antérieures', 3), ...texte(c.performances_anterieures),
    titre('Perspectives', 3), ...texte(c.perspectives),
    titre('1.4. Objectifs et indicateurs les plus représentatifs de la politique du Ministère', 2),
    legende('Tableau 2 : Cadre de performance des objectifs les plus représentatifs du Ministère'),
    tableauPerformance(objectifsMinistere, A),
    titre('1.5. Présentation des crédits du Ministère', 2),
    legende('Tableau 3 : Évolution des crédits par programme'),
    tableau(colonnesCredits(A), [
      ...programmes.map((p) => ligneCredits(`${p.code} — ${p.libelle}`, rows, (r) => r.programme_id === p.id && rubriques.some((x) => x.id === r.poste_id), A)),
      ligneCredits('Total', rows, (r) => rubriques.some((x) => x.id === r.poste_id), A, true),
    ]),
    legende('Tableau 4 : Évolution des crédits par rubrique budgétaire'),
    tableau(colonnesCredits(A), [
      ...rubriques.map((x) => ligneCredits(x.libelle, rows, (r) => r.poste_id === x.id, A)),
      ligneCredits('Total', rows, (r) => rubriques.some((x) => x.id === r.poste_id), A, true),
    ]),
    ...(await tableauCadrage(A)),
    new Paragraph({ children: [new PageBreak()] }),
    titre('2. Présentation des programmes'),
  ];
  programmes.forEach((p, pi) => {
    const tp = (c.programmes || {})[p.id] || {};
    corps.push(
      titre(`2.${pi + 1}. Programme ${p.code} : ${p.libelle}`, 2),
      titre('Périmètre du programme', 3), ...texte(tp.perimetre),
      titre('Stratégie du programme', 3), ...texte(tp.strategie || p.objectif_global),
      titre('Objectifs et indicateurs de performance', 3),
      ...p.objectifs.map((o, oi) => para(`Objectif ${oi + 1}. ${o.libelle}`)),
      legende(`Cadre de performance du programme ${p.libelle}`),
      tableauPerformance(p.objectifs, A),
      ...actionsPrioritaires(cbmtPap, p.id),
      titre('Crédits du programme par rubrique budgétaire', 3),
      tableau(colonnesCredits(A), [...rubriques.map((x) => ligneCredits(x.libelle, rows, (r) => r.programme_id === p.id && r.poste_id === x.id, A)),
        ligneCredits('Total', rows, (r) => r.programme_id === p.id && rubriques.some((x) => x.id === r.poste_id), A, true)]),
      titre('Crédits du programme par titre', 3),
      tableau(colonnesCredits(A), [...titres.map((x) => ligneCredits(x.libelle, rows, (r) => r.programme_id === p.id && r.poste_id === x.id, A)),
        ligneCredits('Total', rows, (r) => r.programme_id === p.id && titres.some((x) => x.id === r.poste_id), A, true)]),
      titre('Crédits du programme par action', 3),
      tableau(colonnesCredits(A), [...p.actions.map((a) => ligneCredits(`${a.code} — ${a.libelle}`, tous, (r) => r.action_id === a.id && rubriques.some((x) => x.id === r.poste_id), A)),
        ligneCredits('Total des actions', tous, (r) => r.programme_id === p.id && r.action_id && rubriques.some((x) => x.id === r.poste_id), A, true)]),
    );
  });
  return emballer(`PAP ${A}`, corps);
}

async function rap(doc) {
  const A = doc.annee;
  const c = doc.contenu || {};
  const { programmes, objectifsMinistere } = await cadre([A]);
  const { postes, credits: tous } = await credits([A]);
  const rows = auProgramme(tous);
  const rubriques = postes.filter((p) => p.axe === 'RUBRIQUE');
  const atteinte = (i) => {
    const cible = i.valeurs[`CIBLE:${A}`]?.valeur; const real = i.valeurs[`REALISATION:${A}`]?.valeur;
    if (cible === undefined || real === undefined) return { cible, real, ecart: null, taux: null };
    const taux = cible ? (i.sens === 'BAISSE' ? (real ? (cible / real) * 100 : 100) : (real / cible) * 100) : null;
    return { cible, real, ecart: real - cible, taux: taux === null ? null : Math.round(taux) };
  };
  const tabPerf = (objectifs) => tableau([['Objectif / indicateur', 'Unité', `Cible ${A}`, `Réalisation ${A}`, 'Écart', 'Taux d’atteinte', 'Commentaire']],
    objectifs.flatMap((o) => [{ titre: true, span: 7, cells: [o.libelle] }, ...o.indicateurs.map((i) => {
      const t = atteinte(i);
      return [i.libelle, i.unite, fmtVal(t.cible), fmtVal(t.real), t.ecart === null ? '—' : fmtVal(Math.round(t.ecart * 100) / 100), t.taux === null ? '—' : `${t.taux} %`, i.valeurs[`REALISATION:${A}`]?.commentaire || ''];
    })]));
  const ptbaIds = await db('ptba as p').join('exercices as e', 'e.id', 'p.exercice_id').where({ 'e.annee': A, 'p.statut': 'VALIDE' }).pluck('p.id');
  const services = [];
  for (const id of ptbaIds) { const p = await ptba.charger(id); services.push({ sigle: p.service_sigle, ...ptba.execution(p.lignes) }); }
  const corps = [
    para('RÉPUBLIQUE DÉMOCRATIQUE DU CONGO', { align: AlignmentType.CENTER, bold: true, color: BLEU }),
    para(c.ministere || 'ÉCONOMIE NUMÉRIQUE', { align: AlignmentType.CENTER, bold: true, size: 36, color: BLEU, after: 0 }),
    para(`RAPPORT ANNUEL DE PERFORMANCE ${A}`, { align: AlignmentType.CENTER, bold: true, size: 32, after: 400 }),
    titre('1. Synthèse'), ...texte(c.synthese),
    titre('2. Résultats des objectifs les plus représentatifs du Ministère'), tabPerf(objectifsMinistere),
    titre('3. Résultats par programme'),
    ...programmes.flatMap((p) => [titre(`Programme ${p.code} : ${p.libelle}`, 2), tabPerf(p.objectifs), ...texte(((c.programmes || {})[p.id] || {}).analyse)]),
    titre('4. Exécution budgétaire'),
    legende(`Crédits votés et exécutés en ${A} par programme`),
    tableau([['Programme', 'Crédits votés (CDF)', 'Exécution (CDF)', 'Taux d’exécution']], [
      ...programmes.map((p) => {
        const v = somme(rows, (r) => r.programme_id === p.id && r.type === 'VOTE' && rubriques.some((x) => x.id === r.poste_id));
        const e = somme(rows, (r) => r.programme_id === p.id && r.type === 'EXECUTE' && rubriques.some((x) => x.id === r.poste_id));
        return [`${p.code} — ${p.libelle}`, fmt(v), fmt(e), v ? `${Math.round((e / v) * 1000) / 10} %` : '—'];
      }),
    ]),
    legende(`Exécution des PTBA validés en ${A}`),
    tableau([['Service', 'Coût programmé (CDF)', 'Décaissé (CDF)', 'Exécution financière', 'Exécution physique']],
      services.map((s) => [s.sigle, fmt(s.cout), fmt(s.decaisse), `${s.tauxFinancier} %`, `${s.tauxPhysique} %`])),
    titre('5. Difficultés rencontrées et perspectives'), ...texte(c.difficultes), ...texte(c.perspectives),
  ];
  return emballer(`RAP ${A}`, corps);
}

async function emballer(nom, children) {
  const d = new Document({
    creator: 'SIG-DEP', title: nom,
    styles: { default: { document: { run: { font: 'Calibri' } } } },
    sections: [{ properties: { page: { size: { orientation: PageOrientation.PORTRAIT } } }, children }],
  });
  return Packer.toBuffer(d);
}

/** CDMT : crédits votés de l’exercice et projections des trois années suivantes, par programme et rubrique. */
async function cdmt(doc) {
  const A = doc.annee;
  const { programmes } = await cadre([A]);
  const { postes, credits: tous } = await credits([A - 1, A, A + 1, A + 2, A + 3]);
  const rows = auProgramme(tous);
  const rubriques = postes.filter((p) => p.axe === 'RUBRIQUE');
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(`CDMT ${A}-${A + 2}`.slice(0, 31));
  ws.mergeCells(1, 1, 1, 7);
  ws.getCell(1, 1).value = `CADRE DE DÉPENSES À MOYEN TERME ${A + 1}-${A + 3} — ÉCONOMIE NUMÉRIQUE (en CDF)`;
  ws.getCell(1, 1).font = { bold: true, size: 13 };
  const entete = ws.addRow(['Programme', 'Rubrique', `Votés ${A - 1}`, `Prévisions ${A}`, `Projection ${A + 1}`, `Projection ${A + 2}`, `Projection ${A + 3}`]);
  ws.getRow(2).height = 22;
  entete.eachCell((cell) => { cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }; cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF17418A' } }; });
  const val = (f, an, type) => somme(rows, (r) => r.annee === an && r.type === type && f(r));
  for (const p of programmes) {
    for (const x of rubriques) {
      const f = (r) => r.programme_id === p.id && r.poste_id === x.id;
      ws.addRow([`${p.code} — ${p.libelle}`, x.libelle, val(f, A - 1, 'VOTE'), val(f, A, 'PREVISION'), val(f, A + 1, 'PREVISION'), val(f, A + 2, 'PREVISION'), val(f, A + 3, 'PREVISION')]);
    }
    const f = (r) => r.programme_id === p.id && rubriques.some((x) => x.id === r.poste_id);
    const t = ws.addRow([`${p.code} — ${p.libelle}`, 'Total programme', val(f, A - 1, 'VOTE'), val(f, A, 'PREVISION'), val(f, A + 1, 'PREVISION'), val(f, A + 2, 'PREVISION'), val(f, A + 3, 'PREVISION')]);
    t.font = { bold: true };
  }
  const f = (r) => rubriques.some((x) => x.id === r.poste_id);
  const tot = ws.addRow(['TOTAL MINISTÈRE', '', val(f, A - 1, 'VOTE'), val(f, A, 'PREVISION'), val(f, A + 1, 'PREVISION'), val(f, A + 2, 'PREVISION'), val(f, A + 3, 'PREVISION')]);
  tot.font = { bold: true };
  ws.columns.forEach((col, i) => { col.width = i === 0 ? 40 : i === 1 ? 44 : 18; if (i > 1) col.numFmt = '#,##0'; });
  const c = await cadrage.controle(A);
  if (c) feuilleCadrage(wb, c);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

const ENTETE = (row) => row.eachCell((cell) => { cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }; cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF17418A' } }; cell.alignment = { wrapText: true, vertical: 'middle' }; });

/** Feuille « Respect du CBMT » : plafonds, prévisions et écarts par année et rubrique. */
function feuilleCadrage(wb, c) {
  const ws = wb.addWorksheet('Respect du CBMT');
  ws.addRow([`RESPECT DES PLAFONDS DU CBMT ${c.cbmt.periode} (${c.cbmt.reference}${c.cbmt.statut === 'VALIDE' ? '' : ', non validé'}) — en CDF`]).font = { bold: true, size: 12 };
  ENTETE(ws.addRow(['Rubrique', ...c.annees.flatMap((y) => [`Plafond ${y.annee}`, `Prévision ${y.annee}`, `Écart ${y.annee}`])]));
  const rub = c.annees[0].lignes.map((l) => l.code);
  rub.forEach((code, k) => {
    const r = ws.addRow([c.annees[0].lignes[k].libelle, ...c.annees.flatMap((y) => { const l = y.lignes.find((x) => x.code === code); return [l.plafond, l.prevision, l.ecart]; })]);
    c.annees.forEach((y, i) => { if (y.lignes.find((x) => x.code === code).depasse) r.getCell(4 + i * 3).font = { bold: true, color: { argb: 'FFB91C1C' } }; });
  });
  const t = ws.addRow(['Total', ...c.annees.flatMap((y) => [y.total.plafond, y.total.prevision, y.total.ecart])]);
  t.font = { bold: true };
  ws.addRow(['Un écart négatif (en rouge) signale une prévision supérieure au plafond.']).font = { italic: true, size: 9 };
  ws.columns.forEach((col, i) => { col.width = i === 0 ? 46 : 18; if (i > 0) col.numFmt = '#,##0'; });
}

/** Fiche de cadrage du CBMT (Excel) : hypothèses, plafonds et respect, actions prioritaires. */
async function cbmt(doc) {
  const c = doc.contenu || {};
  const annees = Array.from({ length: cadrage.DUREE }, (_, i) => doc.annee + i);
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Cadrage');
  ws.addRow([`CADRE BUDGÉTAIRE À MOYEN TERME ${annees[0]}-${annees[annees.length - 1]} — ÉCONOMIE NUMÉRIQUE`]).font = { bold: true, size: 13 };
  ws.addRow([`${doc.reference}${c.source ? ` — source : ${c.source}` : ''}${c.date_publication ? ` (${c.date_publication})` : ''}`]).font = { italic: true };
  ws.addRow([]);
  ENTETE(ws.addRow(['Hypothèses macroéconomiques', ...annees.map(String)]));
  for (const [k, l] of [['croissance', 'Croissance du PIB réel (%)'], ['inflation', 'Inflation (%)'], ['taux_change', 'Taux de change moyen (CDF pour 1 USD)'], ['pib_nominal', 'PIB nominal (milliards CDF)']]) {
    ws.addRow([l, ...annees.map((a) => c.hypotheses?.[a]?.[k] ?? null)]);
  }
  ws.addRow([]);
  if (c.orientations) { ws.addRow(['Orientations du secteur']).font = { bold: true }; ws.addRow([c.orientations]).alignment = { wrapText: true }; ws.addRow([]); }
  ws.columns.forEach((col, i) => { col.width = i === 0 ? 46 : 18; if (i > 0) col.numFmt = '#,##0.##'; });
  feuilleCadrage(wb, await cadrage.controle(doc.annee, db, doc));
  const wa = wb.addWorksheet('Actions prioritaires');
  ENTETE(wa.addRow(['N°', 'Action prioritaire du secteur', 'Programme', 'Projets PIP']));
  const progs = await db('plan_programmes').select('id', 'code', 'libelle');
  const pips = await db('pip_projects').select('id', 'code', 'intitule');
  (c.actions || []).forEach((a, i) => {
    const p = progs.find((x) => x.id === a.programme_id);
    wa.addRow([i + 1, a.libelle, p ? `${p.code} — ${p.libelle}` : '—', a.pips.map((id) => pips.find((x) => x.id === id)?.code).filter(Boolean).join(', ') || '—']).alignment = { wrapText: true, vertical: 'top' };
  });
  [6, 70, 40, 30].forEach((w, i) => { wa.getColumn(i + 1).width = w; });
  return Buffer.from(await wb.xlsx.writeBuffer());
}

module.exports = { cadre, credits, pap, rap, cdmt, cbmt, somme };

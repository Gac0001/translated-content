'use strict';
/**
 * Évaluation des politiques (cahier, §§ 34 et 51) : pièces rédigées et production du dossier.
 *  - note de présentation (contexte, présentation du Ministère, résumé, perspectives, attentes),
 *    avec un résumé chiffré proposé à partir des annexes ;
 *  - lettre de transmission au Secrétaire Général (modèle de la correspondance, numérotée à la
 *    signature du Directeur) ;
 *  - contrôle avant soumission ; report des projections de l’annexe II dans le CDS-MT ;
 *  - exports : dossier complet en PDF, annexes en Excel (taux et totaux en formules).
 */
const ExcelJS = require('exceljs');
const db = require('../db/knex');
const evaluation = require('./evaluation');
const officiel = require('./entete');

const NOTE = [
  ['contexte', 'Contexte'],
  ['presentation', 'Présentation du Ministère'],
  ['resume', 'Résumé de l’évaluation'],
  ['perspectives', 'Perspectives'],
  ['attentes', 'Attentes'],
];
const PIECES = [
  'Note de présentation',
  'Annexe I : politiques sectorielles de l’exercice',
  'Annexe II : projection des actions sur trois ans',
  'Annexes III et IV : politique salariale (effectifs par grade) et états de la Direction des Ressources Humaines',
  'Annexe V : niveau d’exécution des dépenses',
];

const fmt = (n) => (n === null || n === undefined || n === '' ? '—' : Math.round(Number(n)).toLocaleString('fr-FR').replace(/\s/g, ' '));
const pct = (n) => (n === null || n === undefined ? '—' : `${String(n).replace('.', ',')} %`);
const renseigne = (v) => typeof v === 'string' ? v.trim().length > 0 : v !== null && v !== undefined;

/** Résumé chiffré proposé pour la note, d’après les annexes du dossier. */
function resumePropose(e, d) {
  const { I, II, III, V } = d.annexes;
  const reconduites = I.lignes.filter((l) => l.valeurs.reconduction === true).length;
  const totaux = I.lignes.filter((l) => l.valeurs.niveau_physique === 'TOTAL').length;
  return [
    `Au titre de l’exercice ${e.annee}, ${I.lignes.length} action(s) ou projet(s) ont été évalués : prévision de ${fmt(I.totaux.prevision)} CDF, exécution financière de ${fmt(I.totaux.execution)} CDF, soit un taux d’exécution de ${pct(I.totaux.taux)}. ${totaux} action(s) ont été totalement exécutées ; ${reconduites} sont proposées à la reconduction.`,
    `Les dépenses engagées s’élèvent à ${fmt(V.totaux.engage)} CDF pour une dotation de ${fmt(V.totaux.dotation)} CDF (${pct(V.totaux.pourcentage)}), dont ${fmt(V.totaux.paye)} CDF payés et ${fmt(V.totaux.non_paye)} CDF restant à payer.`,
    `L’effectif affecté est de ${III.totaux.affecte} agent(s) pour un effectif organique de ${III.totaux.organique}.`,
    `La projection ${d.projection[0]}-${d.projection[2]} porte sur ${II.lignes.length} action(s) pour un montant total de ${fmt(II.totaux.total)} CDF.`,
  ].join('\n\n');
}

/** Lettre de transmission : contenu enregistré complété des valeurs par défaut. */
function lettre(e) {
  const l = e.lettre || {};
  return {
    destinataire: 'Monsieur le Secrétaire Général au Numérique', adresse: 'à Kinshasa/Gombe',
    objet: `Transmission du dossier d’évaluation des politiques sectorielles et budgétaires — exercice ${e.annee}`,
    references: `Convocation : ${e.convocation_reference}`,
    formule_appel: 'Monsieur le Secrétaire Général,',
    corps: `Faisant suite à la convocation du Ministère du Budget relative à l’évaluation des politiques sectorielles et budgétaires de l’exercice ${e.annee}, j’ai l’honneur de vous transmettre, en annexe à la présente, le dossier du Ministère préparé par la Direction d’Études et Planification.\n\nCe dossier comprend la note de présentation et les annexes I à V ; les états de la Direction des Ressources Humaines relatifs aux primes et aux salaires y sont joints.`,
    formule_finale: 'Veuillez agréer, Monsieur le Secrétaire Général, l’expression de ma haute considération.',
    pieces: PIECES, copies: [],
    ...l,
  };
}

/** Points bloquant la soumission : erreurs des annexes, note incomplète, lettre incomplète. */
function bloquants(e, d) {
  const out = [];
  if (d.controle.erreurs) out.push(`${d.controle.erreurs} erreur(s) à corriger dans les annexes.`);
  for (const [k, l] of NOTE) if (!renseigne((e.note || {})[k])) out.push(`Note de présentation : rubrique « ${l} » non rédigée.`);
  const lt = lettre(e);
  for (const [k, l] of [['destinataire', 'destinataire'], ['objet', 'objet'], ['corps', 'corps']]) if (!renseigne(lt[k])) out.push(`Lettre de transmission : ${l} manquant.`);
  return out;
}

/** Pseudo-document de correspondance pour la mise en page et la numérotation de la lettre. */
function documentLettre(e) {
  return {
    contenu: { ...lettre(e), signataire: 'Directeur' }, numero_officiel: e.numero_lettre, numerote_at: e.numerote_at,
    identite_version_id: e.identite_version_id, auteur_user_id: e.prepare_par,
  };
}

/** Report des projections de l’annexe II dans le CDS-MT (à la transmission, en ajout seul). */
async function reporterCdsmt(trx, e, d, userId) {
  const lignes = [];
  for (const l of d.annexes.II.lignes) {
    d.projection.forEach((annee, i) => {
      const montant = Number(l.valeurs[`montant_${i + 1}`]) || 0;
      if (montant > 0) {
        lignes.push({
          evaluation_id: e.id, cle: l.cle || `LIGNE:${l.id}`, action: l.valeurs.action, annee, montant,
          etude_faisabilite: l.valeurs.etude_faisabilite ?? null, objectif_pag: l.valeurs.objectif_pag || null, reporte_par: userId,
        });
      }
    });
  }
  if (lignes.length) await trx('cdsmt_projections').insert(lignes);
  return lignes.length;
}

/** CDS-MT : projections reportées par action et par année (dernier dossier transmis pour chaque année). */
async function cdsmt() {
  const rows = await db('cdsmt_projections as c').join('evaluations as e', 'e.id', 'c.evaluation_id')
    .orderBy('e.annee', 'desc').orderBy('c.id').select('c.*', 'e.annee as exercice', 'e.reference');
  // Une projection plus récente (dossier d’un exercice ultérieur) remplace la précédente pour la même action et la même année.
  const retenues = new Map();
  for (const r of rows) {
    const k = `${r.cle}|${r.annee}`;
    if (!retenues.has(k)) retenues.set(k, r);
  }
  const annees = [...new Set([...retenues.values()].map((r) => r.annee))].sort();
  const actions = new Map();
  for (const r of retenues.values()) {
    if (!actions.has(r.cle)) actions.set(r.cle, { cle: r.cle, action: r.action, objectif_pag: r.objectif_pag, etude_faisabilite: r.etude_faisabilite, source: r.reference, exercice: r.exercice, montants: {} });
    actions.get(r.cle).montants[r.annee] = Number(r.montant);
  }
  const lignes = [...actions.values()].sort((a, b) => a.action.localeCompare(b.action, 'fr', { numeric: true }));
  return { annees, lignes, totaux: Object.fromEntries(annees.map((a) => [a, lignes.reduce((t, l) => t + (l.montants[a] || 0), 0)])) };
}

// ─── Colonnes des annexes (exports) ─────────────────────────────────────────
function colonnes(code, projection) {
  const NIV = evaluation.NIVEAUX;
  const oui = (v) => (v === true ? 'Oui' : v === false ? 'Non' : '');
  if (code === 'I') {
    return [
      { h: 'Action ou projet', k: 'action', w: 34 }, { h: 'Prévision (CDF)', k: 'prevision', m: true, w: 16 }, { h: 'Exécution financière (CDF)', k: 'execution', m: true, w: 16 },
      { h: 'Taux d’exécution', calc: 'taux', f: (c) => `IF(${c.prevision}=0,"",${c.execution}/${c.prevision})`, p: true, w: 11 },
      { h: 'Exécution physique (%)', k: 'taux_physique', w: 11 }, { h: 'Niveau physique', k: 'niveau_physique', v: (x) => NIV[x] || '', w: 12 },
      { h: 'Cible ou bénéficiaires', k: 'cible', w: 26 }, { h: 'Reconduction', k: 'reconduction', v: oui, w: 11 },
    ];
  }
  if (code === 'II') {
    return [
      { h: 'Action', k: 'action', w: 34 },
      ...projection.map((a, i) => ({ h: `${a} (CDF)`, k: `montant_${i + 1}`, m: true, w: 15 })),
      { h: 'Total (CDF)', calc: 'total', f: (c) => `${c.montant_1}+${c.montant_2}+${c.montant_3}`, m: true, w: 16 },
      { h: 'Étude de faisabilité', k: 'etude_faisabilite', v: oui, w: 11 }, { h: 'Objectif visé (PAG)', k: 'objectif_pag', w: 26 }, { h: 'Impact environnemental', k: 'impact_environnemental', w: 20 },
    ];
  }
  if (code === 'V') {
    return [
      { h: 'Programme', k: 'programme', w: 34 }, { h: 'Dotation annuelle (CDF)', k: 'dotation', m: true, w: 16 }, { h: 'Engagé (CDF)', k: 'engage', m: true, w: 16 },
      { h: 'Payé (CDF)', k: 'paye', m: true, w: 16 }, { h: 'Non payé (CDF)', calc: 'non_paye', f: (c) => `${c.engage}-${c.paye}`, m: true, w: 16 },
      { h: 'Engagé / dotation', calc: 'pourcentage', f: (c) => `IF(${c.dotation}=0,"",${c.engage}/${c.dotation})`, p: true, w: 11 }, { h: 'Observation', k: 'observation', w: 30 },
    ];
  }
  return [
    { h: 'Grade', k: 'grade', w: 34 }, { h: 'Organique', k: 'organique', n: true, w: 11 }, { h: 'Affecté', k: 'affecte', n: true, w: 11 },
    { h: 'Écart', calc: 'ecart', f: (c) => `${c.affecte}-${c.organique}`, n: true, w: 9 }, { h: 'Payé', k: 'paye', n: true, w: 11 }, { h: 'Non payé', k: 'non_paye', n: true, w: 11 },
  ];
}

/** Annexes I à V en Excel : une feuille par annexe, taux, écarts et totaux en formules. */
async function excel(e, d) {
  const wb = new ExcelJS.Workbook();
  const BORD = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
  for (const a of Object.values(d.annexes)) {
    const cols = colonnes(a.code, d.projection);
    const ws = officiel.feuilleOfficielle(wb, `Annexe ${a.code}`, cols.length, { largeurs: cols.map((c) => c.w), options: { pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 } } });
    const titre = (texte, font) => { const r = ws.addRow([texte]); ws.mergeCells(r.number, 1, r.number, cols.length); r.getCell(1).alignment = { horizontal: 'center', wrapText: true }; r.getCell(1).font = font; };
    titre(a.titre.toUpperCase(), { bold: true, size: 12, color: { argb: 'FF0B3D6E' } });
    titre(`Évaluation des politiques sectorielles et budgétaires — exercice ${e.annee} — ${e.reference}`, { size: 10, color: { argb: 'FF444444' } });
    ws.addRow([]);
    const h = ws.addRow(cols.map((c) => c.h));
    h.eachCell((cell) => { cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }; cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF17418A' } }; cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }; cell.border = BORD; });
    const premiere = h.number + 1;
    const lettreCol = (i) => ws.getColumn(i + 1).letter;
    for (const l of a.lignes) {
      const r = ws.addRow([]);
      const ref = Object.fromEntries(cols.filter((c) => c.k).map((c) => [c.k, `${lettreCol(cols.indexOf(c))}${r.number}`]));
      cols.forEach((c, i) => {
        const cell = r.getCell(i + 1);
        if (c.calc) cell.value = { formula: c.f(ref), result: l.calculs[c.calc] === null ? '' : c.p ? (l.calculs[c.calc] ?? 0) / 100 : l.calculs[c.calc] };
        else { const v = l.valeurs[c.k]; cell.value = c.v ? c.v(v) : (v ?? ''); }
        cell.border = BORD;
        cell.alignment = { vertical: 'top', wrapText: !c.m && !c.n && !c.p };
        if (c.m) cell.numFmt = '#,##0';
        if (c.p) cell.numFmt = '0.0%';
      });
    }
    const derniere = premiere + a.lignes.length - 1;
    const t = ws.addRow([]);
    const somme = (i) => (a.lignes.length ? { formula: `SUM(${lettreCol(i)}${premiere}:${lettreCol(i)}${derniere})` } : 0);
    const refT = Object.fromEntries(cols.filter((c) => c.k).map((c) => [c.k, `${lettreCol(cols.indexOf(c))}${t.number}`]));
    cols.forEach((c, i) => {
      const cell = t.getCell(i + 1);
      if (i === 0) cell.value = 'TOTAL';
      else if (c.m || c.n) cell.value = c.calc && c.f && !c.p ? { formula: c.f(refT) } : somme(i);
      else if (c.p) cell.value = { formula: c.f(refT) };
      cell.font = { bold: true }; cell.border = BORD; cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDFE8F3' } };
      if (c.m) cell.numFmt = '#,##0';
      if (c.p) cell.numFmt = '0.0%';
    });
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** Dossier complet en PDF (note de présentation, annexes I à V), en réponse HTTP. */
function pdf(res, e, d) {
  const P = require('./pdf');
  const { doc, finish } = P.createPdf(res, {
    filename: `evaluation-politiques-${e.annee}.pdf`, titre: `ÉVALUATION DES POLITIQUES SECTORIELLES ET BUDGÉTAIRES — EXERCICE ${e.annee}`,
    sousTitre: `Dossier du Ministère · ${e.reference}${e.numero_lettre ? ` · transmis par lettre ${e.numero_lettre}` : ''}`, reference: e.reference, landscape: true,
  });
  doc.font('Helvetica-Bold').fontSize(12).fillColor(P.BLUE).text('NOTE DE PRÉSENTATION', { align: 'center' });
  doc.moveDown(0.6);
  NOTE.forEach(([k, l], i) => P.section(doc, `${i + 1}. ${l}`, (e.note || {})[k]));
  for (const a of Object.values(d.annexes)) {
    doc.addPage();
    doc.font('Helvetica-Bold').fontSize(11).fillColor(P.BLUE).text(a.titre.toUpperCase(), { align: 'center' });
    doc.moveDown(0.5).fillColor('#000');
    const cols = colonnes(a.code, d.projection);
    const valeur = (c, l, total) => {
      const v = c.calc ? (total ? a.totaux[c.calc] : l.calculs[c.calc]) : (total ? (c.m || c.n ? a.totaux[c.k] : '') : l.valeurs[c.k]);
      if (c.p) return v === null || v === undefined || v === '' ? '' : pct(v);
      if (c.m) return v === '' ? '' : fmt(v);
      if (c.v && !total) return c.v(v);
      return v ?? '';
    };
    const lignes = [...a.lignes.map((l) => ({ l })), { total: true }];
    P.table(doc, cols.map((c, i) => ({
      header: c.h, width: c.w, align: c.m || c.n || c.p ? 'right' : 'left',
      value: (r) => (r.total ? (i === 0 ? 'TOTAL' : valeur(c, null, true)) : valeur(c, r.l, false)),
    })), lignes, { fontSize: 7.5 });
  }
  return finish();
}

module.exports = { NOTE, PIECES, resumePropose, lettre, bloquants, documentLettre, reporterCdsmt, cdsmt, excel, pdf };

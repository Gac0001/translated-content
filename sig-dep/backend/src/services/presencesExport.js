'use strict';
/**
 * Export du rapport hebdomadaire de présence au format de l’annexe 11 du cahier des charges :
 * « Liste des présences des Cadres / Agents affectés à la Direction d’Études et Planification »,
 * « Semaine du … au … », colonnes N°, nom, postnom et prénom, grade, puis H-A et H-D du lundi au
 * vendredi ; agents regroupés par structure (I. Direction, I.1 Secrétariat de Direction, I.2 …) ;
 * en cas d’absence, le motif remplace les heures ; pied « Pour la DEP ».
 * Valeurs effectives : les rectificatifs validés sont appliqués et signalés par un astérisque.
 */
const ExcelJS = require('exceljs');
const db = require('../db/knex');
const pdf = require('./pdf');
const officiel = require('./entete');
const P = require('./presences');
const { DEP_NOM } = require('../constants');

const fr = (iso) => String(iso).slice(0, 10).split('-').reverse().join('/');
const dateDe = (d) => (d instanceof Date ? d.toLocaleDateString('en-CA', { timeZone: 'Africa/Kinshasa' }) : String(d).slice(0, 10));
const STATUTS = { EN_PREPARATION: 'En préparation', TRANSMIS: 'Transmis au Directeur', VERROUILLE: 'Verrouillé', REJETE: 'Rejeté' };

/** Données du rapport : pour chaque catégorie, groupes de structure et agents avec leurs cinq jours. */
async function donneesSemaine(s) {
  const jours = P.joursOuvrables(s.semaine_debut);
  const feries = await P.feries(jours[0], jours[4]);
  const listes = await db('presence_listes').where({ semaine_id: s.id });
  const rects = listes.length ? await db('presence_rectificatifs').whereIn('liste_id', listes.map((l) => l.id)).where({ statut: 'VALIDE' }) : [];
  const categories = [];
  for (const categorie of Object.keys(P.CATEGORIES)) {
    const agents = new Map();
    for (const l of listes.filter((x) => x.categorie === categorie)) {
      const date = dateDe(l.date);
      const lignes = P.appliquerRectificatifs(await P.lignesListe(l.id), rects.filter((r) => r.liste_id === l.id));
      for (const x of lignes) {
        const a = agents.get(x.agent_id) || { agent_id: x.agent_id, nom: x.nom_complet, grade: x.grade_code, structure_code: x.structure_code, structure_libelle: x.structure_libelle, ordre: x.ordre, jours: {} };
        // Regroupement et ordre les plus récents de la semaine
        Object.assign(a, { structure_code: x.structure_code, structure_libelle: x.structure_libelle, grade: x.grade_code, ordre: x.ordre });
        a.jours[date] = { ha: x.heure_arrivee, hd: x.heure_depart, motif: x.motif, retard: x.retard_minutes, rectifiee: !!x.rectifiee };
        agents.set(x.agent_id, a);
      }
    }
    const tri = [...agents.values()].sort((a, b) => a.ordre - b.ordre);
    const groupes = [];
    for (const a of tri) {
      let g = groupes[groupes.length - 1];
      if (!g || g.code !== a.structure_code) { g = { code: a.structure_code, libelle: a.structure_libelle, agents: [] }; groupes.push(g); }
      g.agents.push(a);
    }
    categories.push({ categorie, libelle: P.CATEGORIES[categorie], groupes, total: tri.length });
  }
  return { semaine: s, jours, feries, categories, rectifie: rects.length > 0 };
}

const titreCategorie = (c) => `Liste des présences des ${c.libelle} affectés à la ${DEP_NOM}`;
const periode = (s) => `Semaine du ${fr(s.semaine_debut)} au ${fr(s.semaine_fin)}`;
/** Contenu d’une case : heure (astérisque si rectifiée) ou motif. */
function cases(a, date, ferie) {
  if (ferie) return { fusion: 'Férié' };
  const j = a.jours[date];
  if (!j) return { ha: '', hd: '' };
  const m = j.rectifiee ? '*' : '';
  if (j.motif) return { fusion: `${P.MOTIFS[j.motif]}${m}` };
  return { ha: j.ha ? `${j.ha}${m}` : '', hd: j.hd ? `${j.hd}${m}` : '', retard: j.retard > 0 };
}

// ─── PDF ────────────────────────────────────────────────────────────────────────────────────────
function pdfTableau(doc, d, c) {
  const x0 = doc.page.margins.left;
  const largeur = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const wN = 22; const wNom = 170; const wG = 38;
  const wJ = (largeur - wN - wNom - wG) / 10;
  const pad = 2.5; const hL = 14;
  const cellule = (x, y, w, h, texte, { fond, couleur = '#000', gras = false, align = 'center', taille = 7.5 } = {}) => {
    if (fond) doc.rect(x, y, w, h).fill(fond);
    doc.rect(x, y, w, h).lineWidth(0.4).strokeColor('#8a9bb0').stroke();
    if (texte) doc.font(gras ? 'Helvetica-Bold' : 'Helvetica').fontSize(taille).fillColor(couleur).text(String(texte), x + pad, y + (h - taille) / 2 - 0.5, { width: w - pad * 2, align, lineBreak: false, ellipsis: true });
  };
  const entete = () => {
    pdf.ensureSpace(doc, hL * 4);
    const y = doc.y;
    const f = { fond: pdf.BLUE, couleur: '#fff', gras: true };
    cellule(x0, y, wN, hL * 2, 'N°', f);
    cellule(x0 + wN, y, wNom, hL * 2, 'Nom, postnom et prénom', { ...f, align: 'left' });
    cellule(x0 + wN + wNom, y, wG, hL * 2, 'Grade', f);
    d.jours.forEach((date, i) => {
      const x = x0 + wN + wNom + wG + i * 2 * wJ;
      cellule(x, y, wJ * 2, hL, `${P.JOURS[i]} ${fr(date).slice(0, 5)}`, f);
      cellule(x, y + hL, wJ, hL, 'H-A', f);
      cellule(x + wJ, y + hL, wJ, hL, 'H-D', f);
    });
    doc.y = y + hL * 2;
  };
  entete();
  let n = 0;
  for (const g of c.groupes) {
    if (doc.y + hL * 2 > doc.page.height - doc.page.margins.bottom) { doc.addPage(); entete(); }
    const yg = doc.y;
    cellule(x0, yg, largeur, hL, `${g.code}  ${g.libelle}`, { fond: '#dfe8f3', gras: true, align: 'left' });
    doc.y = yg + hL;
    for (const a of g.agents) {
      if (doc.y + hL > doc.page.height - doc.page.margins.bottom) { doc.addPage(); entete(); }
      n += 1;
      const y = doc.y;
      cellule(x0, y, wN, hL, n);
      cellule(x0 + wN, y, wNom, hL, a.nom, { align: 'left' });
      cellule(x0 + wN + wNom, y, wG, hL, a.grade || '');
      d.jours.forEach((date, i) => {
        const x = x0 + wN + wNom + wG + i * 2 * wJ;
        const v = cases(a, date, d.feries[date]);
        if (v.fusion) cellule(x, y, wJ * 2, hL, v.fusion, { fond: '#f3f4f6', couleur: '#7a1f1f' });
        else { cellule(x, y, wJ, hL, v.ha, { couleur: v.retard ? '#b45309' : '#000', gras: v.retard }); cellule(x + wJ, y, wJ, hL, v.hd); }
      });
      doc.y = y + hL;
    }
  }
  if (!n) doc.font('Helvetica-Oblique').fontSize(9).fillColor('#555').text('Aucun agent dans cette catégorie.', x0 + 4, doc.y + 4);
  doc.x = x0;
  doc.fillColor('#000').moveDown(0.6);
}

function pdfPied(doc, d) {
  pdf.ensureSpace(doc, 45);
  doc.font('Helvetica').fontSize(7.5).fillColor('#444');
  const notes = ['H-A : heure d’arrivée ; H-D : heure de départ ; heure d’arrivée en gras : retard au-delà de la tolérance.'];
  if (d.rectifie) notes.push('* valeur rectifiée par un rectificatif validé par le Directeur (l’original est conservé).');
  doc.text(notes.join(' '), { width: doc.page.width - doc.page.margins.left - doc.page.margins.right });
  doc.moveDown(0.8).font('Helvetica-Bold').fontSize(10).fillColor('#000').text('Pour la DEP', { align: 'right' });
  doc.moveDown(3);
}

function exportPdf(res, d) {
  const s = d.semaine;
  const { doc, finish } = pdf.createPdf(res, {
    filename: `presences-${s.semaine_debut}.pdf`, titre: titreCategorie(d.categories[0]), sousTitre: `${periode(s)} — ${STATUTS[s.statut]}`, reference: s.reference, landscape: true,
  });
  d.categories.forEach((c, i) => {
    if (i > 0) {
      doc.addPage();
      doc.font('Helvetica-Bold').fontSize(13).fillColor(pdf.BLUE).text(titreCategorie(c), { align: 'center' });
      doc.font('Helvetica').fontSize(9.5).fillColor('#555').text(`${periode(s)} — ${STATUTS[s.statut]}`, { align: 'center' }).moveDown(0.8);
    }
    pdfTableau(doc, d, c);
    pdfPied(doc, d);
  });
  return finish();
}

// ─── Excel ──────────────────────────────────────────────────────────────────────────────────────
const BORD = { style: 'thin', color: { argb: 'FF8A9BB0' } };
const BORDS = { top: BORD, bottom: BORD, left: BORD, right: BORD };

function feuille(wb, d, c) {
  const s = d.semaine;
  const ws = officiel.feuilleOfficielle(wb, c.libelle, 13, { largeurs: [5, 34, 8, ...Array(10).fill(8.5)], options: { pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 } } });
  const ligneTitre = (texte, font) => { const r = ws.addRow([texte]); ws.mergeCells(r.number, 1, r.number, 13); r.getCell(1).alignment = { horizontal: 'center' }; r.getCell(1).font = font; return r; };
  ligneTitre(titreCategorie(c), { bold: true, size: 12, color: { argb: 'FF0B3D6E' } });
  ligneTitre(`${periode(s)} — ${STATUTS[s.statut]} — Réf. ${s.reference}`, { size: 10, color: { argb: 'FF444444' } });
  ws.addRow([]);
  const h1 = ws.addRow(['N°', 'Nom, postnom et prénom', 'Grade', ...d.jours.flatMap((date, i) => [`${P.JOURS[i]} ${fr(date).slice(0, 5)}`, null])]);
  const h2 = ws.addRow([null, null, null, ...d.jours.flatMap(() => ['H-A', 'H-D'])]);
  for (let col = 1; col <= 3; col += 1) ws.mergeCells(h1.number, col, h2.number, col);
  d.jours.forEach((_, i) => ws.mergeCells(h1.number, 4 + i * 2, h1.number, 5 + i * 2));
  [h1, h2].forEach((r) => { for (let col = 1; col <= 13; col += 1) { const cell = r.getCell(col); cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }; cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF17418A' } }; cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }; cell.border = BORDS; } });
  let n = 0;
  for (const g of c.groupes) {
    const r = ws.addRow([`${g.code}  ${g.libelle}`]);
    ws.mergeCells(r.number, 1, r.number, 13);
    r.getCell(1).font = { bold: true }; r.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDFE8F3' } }; r.getCell(1).border = BORDS;
    for (const a of g.agents) {
      n += 1;
      const valeurs = [n, a.nom, a.grade || ''];
      const fusions = [];
      d.jours.forEach((date, i) => {
        const v = cases(a, date, d.feries[date]);
        if (v.fusion) { valeurs.push(v.fusion, null); fusions.push(4 + i * 2); } else valeurs.push(v.ha, v.hd);
      });
      const ra = ws.addRow(valeurs);
      fusions.forEach((col) => ws.mergeCells(ra.number, col, ra.number, col + 1));
      for (let col = 1; col <= 13; col += 1) { const cell = ra.getCell(col); cell.border = BORDS; cell.alignment = { horizontal: col === 2 ? 'left' : 'center', vertical: 'middle' }; }
      d.jours.forEach((date, i) => { if (cases(a, date, d.feries[date]).retard) ra.getCell(4 + i * 2).font = { bold: true, color: { argb: 'FFB45309' } }; });
    }
  }
  ws.views = [{ state: 'frozen', ySplit: h2.number, xSplit: 3 }];
  ws.pageSetup.printTitlesRow = `${h1.number}:${h2.number}`;
  ws.addRow([]);
  const note = ws.addRow([`H-A : heure d’arrivée ; H-D : heure de départ ; en gras : retard au-delà de la tolérance.${d.rectifie ? ' * valeur rectifiée (rectificatif validé par le Directeur).' : ''}`]);
  ws.mergeCells(note.number, 1, note.number, 13); note.getCell(1).font = { italic: true, size: 8 };
  ws.addRow([]);
  const pied = ws.addRow([]);
  pied.getCell(10).value = 'Pour la DEP'; ws.mergeCells(pied.number, 10, pied.number, 13);
  pied.getCell(10).font = { bold: true }; pied.getCell(10).alignment = { horizontal: 'center' };
  return ws;
}

async function exportExcel(res, d) {
  const wb = new ExcelJS.Workbook();
  wb.creator = `SIG-DEP — ${DEP_NOM}`;
  wb.created = new Date();
  for (const c of d.categories) feuille(wb, d, c);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="presences-${d.semaine.semaine_debut}.xlsx"`);
  await wb.xlsx.write(res);
  res.end();
}

module.exports = { donneesSemaine, pdf: exportPdf, excel: exportExcel };

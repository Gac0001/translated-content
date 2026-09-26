'use strict';
/**
 * Génération PDF (pdfkit) avec en-tête administratif officiel :
 * République Démocratique du Congo — Secrétariat Général à l’Économie Numérique —
 * Direction d’Études et Planification.
 */
const PDFDocument = require('pdfkit');
const { DEP_NOM, SG_NOM, PAYS } = require('../constants');

const BLUE = '#0b3d6e';
const GREY = '#555555';

function fmtDate(d) {
  if (!d) return '';
  const x = new Date(d);
  return Number.isNaN(x.getTime()) ? String(d) : x.toLocaleDateString('fr-FR', { timeZone: 'Africa/Kinshasa' });
}
function fmtDateTime(d) {
  if (!d) return '';
  return new Date(d).toLocaleString('fr-FR', { timeZone: 'Africa/Kinshasa', dateStyle: 'short', timeStyle: 'short' });
}

function header(doc, { reference } = {}) {
  const x = doc.page.margins.left;
  const w = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  doc.save();
  // Bandeau tricolore sobre (bleu, jaune, rouge)
  doc.rect(x, 28, w, 3).fill('#007fff');
  doc.rect(x, 31, w, 1.5).fill('#f7d618');
  doc.rect(x, 32.5, w, 1.5).fill('#ce1021');
  doc.restore();
  doc.fillColor(BLUE).font('Helvetica-Bold').fontSize(10).text(PAYS.toUpperCase(), x, 42, { width: w, align: 'center' });
  doc.font('Helvetica').fontSize(9).fillColor('#222').text(SG_NOM.toUpperCase(), { width: w, align: 'center' });
  doc.font('Helvetica-Bold').fontSize(9.5).fillColor(BLUE).text(DEP_NOM.toUpperCase(), { width: w, align: 'center' });
  doc.font('Helvetica').fontSize(8).fillColor(GREY).text('(DEP)', { width: w, align: 'center' });
  const endY = doc.y;
  if (reference) doc.fontSize(8).fillColor(GREY).text(`Réf. : ${reference}`, x, 42, { width: w, align: 'right' });
  const y = endY + 6;
  doc.moveTo(x, y).lineTo(x + w, y).lineWidth(0.7).strokeColor(BLUE).stroke();
  doc.y = y + 10;
  doc.x = x;
  doc.fillColor('#000');
}

function footer(doc) {
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const bottom = doc.page.height - 30;
    const oldBottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.fontSize(7.5).fillColor(GREY).font('Helvetica')
      .text(`SIG-DEP — ${DEP_NOM} — Document généré le ${fmtDateTime(new Date())} — Page ${i + 1}/${range.count}`,
        doc.page.margins.left, bottom, { width: doc.page.width - doc.page.margins.left - doc.page.margins.right, align: 'center' });
    doc.page.margins.bottom = oldBottom;
  }
}

/** Crée un PDF diffusé en réponse HTTP. Appeler `finish()` pour terminer. */
function createPdf(res, { filename, titre, sousTitre, reference, landscape = false }) {
  const doc = new PDFDocument({ size: 'A4', layout: landscape ? 'landscape' : 'portrait', margins: { top: 40, bottom: 50, left: 45, right: 45 }, bufferPages: true, info: { Title: titre, Author: `SIG-DEP — ${DEP_NOM}` } });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  doc.pipe(res);
  doc.on('pageAdded', () => header(doc, { reference }));
  header(doc, { reference });
  if (titre) {
    doc.moveDown(0.3).font('Helvetica-Bold').fontSize(13).fillColor(BLUE).text(titre, { align: 'center' });
    if (sousTitre) doc.font('Helvetica').fontSize(9.5).fillColor(GREY).text(sousTitre, { align: 'center' });
    doc.moveDown(0.8).fillColor('#000');
  }
  return { doc, finish: () => { footer(doc); doc.end(); } };
}

function ensureSpace(doc, h) {
  if (doc.y + h > doc.page.height - doc.page.margins.bottom) doc.addPage();
}

function section(doc, titre, texte) {
  ensureSpace(doc, 40);
  doc.font('Helvetica-Bold').fontSize(10.5).fillColor(BLUE).text(titre);
  doc.moveDown(0.2).font('Helvetica').fontSize(9.5).fillColor('#000');
  if (texte !== undefined && texte !== null && texte !== '') doc.text(String(texte), { align: 'justify' });
  else doc.fillColor(GREY).text('—').fillColor('#000');
  doc.moveDown(0.6);
}

function keyValues(doc, pairs) {
  const x = doc.page.margins.left;
  for (const [k, v] of pairs) {
    ensureSpace(doc, 16);
    const y = doc.y;
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#333').text(`${k} :`, x, y, { width: 150 });
    const h1 = doc.y - y;
    doc.font('Helvetica').fillColor('#000').text(v === null || v === undefined || v === '' ? '—' : String(v), x + 155, y, { width: doc.page.width - x - doc.page.margins.right - 155 });
    doc.y = Math.max(doc.y, y + h1) + 2;
    doc.x = x;
  }
  doc.moveDown(0.5);
}

/** Tableau simple avec gestion des sauts de page. columns = [{ header, key, width, align }] (width relatif). */
function table(doc, columns, rows, { fontSize = 8.5 } = {}) {
  const x0 = doc.page.margins.left;
  const totalW = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const sum = columns.reduce((s, c) => s + (c.width || 1), 0);
  const widths = columns.map((c) => ((c.width || 1) / sum) * totalW);
  const pad = 3;
  const drawHeader = () => {
    doc.font('Helvetica-Bold').fontSize(fontSize);
    const h = Math.max(...columns.map((c, i) => doc.heightOfString(c.header, { width: widths[i] - pad * 2 }))) + pad * 2;
    ensureSpace(doc, h + 14);
    const y = doc.y;
    let x = x0;
    doc.rect(x0, y, totalW, h).fill(BLUE);
    columns.forEach((c, i) => { doc.fillColor('#fff').text(c.header, x + pad, y + pad, { width: widths[i] - pad * 2, align: c.align || 'left' }); x += widths[i]; });
    doc.y = y + h;
    doc.fillColor('#000');
  };
  drawHeader();
  rows.forEach((r, ri) => {
    doc.font('Helvetica').fontSize(fontSize);
    const vals = columns.map((c) => { const v = typeof c.value === 'function' ? c.value(r) : r[c.key]; return v === null || v === undefined ? '' : String(v); });
    const h = Math.max(...vals.map((v, i) => doc.heightOfString(v || ' ', { width: widths[i] - pad * 2 }))) + pad * 2;
    if (doc.y + h > doc.page.height - doc.page.margins.bottom) { doc.addPage(); drawHeader(); doc.font('Helvetica').fontSize(fontSize); }
    const y = doc.y;
    if (ri % 2 === 1) doc.rect(x0, y, totalW, h).fill('#eef3f8');
    let x = x0;
    vals.forEach((v, i) => {
      doc.fillColor('#000').text(v, x + pad, y + pad, { width: widths[i] - pad * 2, align: columns[i].align || 'left' });
      doc.rect(x, y, widths[i], h).lineWidth(0.3).strokeColor('#b8c4d0').stroke();
      x += widths[i];
    });
    doc.y = y + h;
  });
  if (!rows.length) doc.font('Helvetica-Oblique').fontSize(9).fillColor(GREY).text('Aucune donnée.', x0 + 4, doc.y + 4).fillColor('#000');
  doc.x = x0;
  doc.moveDown(0.8);
}

function signatureBlock(doc, visas = []) {
  ensureSpace(doc, 90);
  doc.moveDown(1);
  const x0 = doc.page.margins.left;
  const totalW = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const list = visas.length ? visas : [{ libelle: 'Le Directeur', nom: '' }];
  const w = totalW / list.length;
  const y = doc.y;
  list.forEach((v, i) => {
    doc.font('Helvetica-Bold').fontSize(9).text(v.libelle || '', x0 + i * w, y, { width: w, align: 'center' });
    doc.font('Helvetica').fontSize(8).fillColor(GREY).text(v.type ? `${v.type === 'SIGNATURE' ? 'Signé' : 'Visa'} le ${fmtDateTime(v.date)}` : '', x0 + i * w, y + 14, { width: w, align: 'center' });
    doc.fillColor('#000').font('Helvetica-Bold').fontSize(9).text(v.nom || '', x0 + i * w, y + 48, { width: w, align: 'center' });
  });
  doc.y = y + 70;
  doc.x = x0;
}

module.exports = { createPdf, section, keyValues, table, signatureBlock, ensureSpace, fmtDate, fmtDateTime, BLUE };

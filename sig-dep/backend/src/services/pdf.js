'use strict';
/**
 * Génération PDF (pdfkit) avec l’en-tête et le pied de page officiels de la Direction
 * (services/entete.js, identité du Ministère en vigueur ou celle d’un document signé).
 */
const PDFDocument = require('pdfkit');
const { DEP_NOM } = require('../constants');
const identite = require('./identite');
const entete = require('./entete');

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

/** Pieds de page officiels de toutes les pages (numéro de page au-delà d’une page). */
function footer(doc, ident) {
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    entete.pdfPied(doc, ident, { page: i + 1, total: range.count });
  }
}

/**
 * Crée un PDF diffusé en réponse HTTP, avec l’en-tête officiel en première page, un rappel discret
 * sur les suivantes et le pied de page officiel sur chaque page. Appeler `finish()` pour terminer.
 * `variante` : 'DEP' (par défaut) ou 'SG' (document signé par le Secrétaire Général) ;
 * `identiteId` : version de l’identité du Ministère d’un document signé (sinon celle en vigueur).
 */
function createPdf(res, { filename, titre, sousTitre, reference, landscape = false, variante = 'DEP', identiteId = null, referenceSousEntete = true }) {
  const ident = identite.version(identiteId);
  const doc = new PDFDocument({ size: 'A4', layout: landscape ? 'landscape' : 'portrait', margins: { top: 46, bottom: entete.PIED_PDF + 14, left: 45, right: 45 }, bufferPages: true, info: { Title: titre || reference || filename || 'Document', Author: `SIG-DEP — ${DEP_NOM}` } });
  entete.pdfPolices(doc);
  if (res) {
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    doc.pipe(res);
  }
  doc.on('pageAdded', () => { doc.y = Math.max(doc.page.margins.top, entete.pdfRappel(doc, reference)); doc.x = doc.page.margins.left; });
  doc.y = entete.pdfEntete(doc, ident, { variante });
  doc.x = doc.page.margins.left;
  if (reference && referenceSousEntete) doc.font('Helvetica').fontSize(8).fillColor(GREY).text(`Réf. : ${reference}`, { align: 'right' });
  if (titre) {
    doc.moveDown(0.3).font('Helvetica-Bold').fontSize(13).fillColor(BLUE).text(titre, { align: 'center' });
    if (sousTitre) doc.font('Helvetica').fontSize(9.5).fillColor(GREY).text(sousTitre, { align: 'center' });
    doc.moveDown(0.8);
  }
  doc.fillColor('#000').font('Helvetica');
  return { doc, ident, finish: () => { footer(doc, ident); doc.end(); } };
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
    doc.font('Helvetica').fontSize(8).fillColor(GREY).text(v.type ? `${v.type === 'SIGNATURE' ? 'Signé' : v.type === 'RELECTURE' ? 'Relu' : 'Visa'} le ${fmtDateTime(v.date)}` : '', x0 + i * w, y + 14, { width: w, align: 'center' });
    doc.fillColor('#000').font('Helvetica-Bold').fontSize(9).text(v.nom || '', x0 + i * w, y + 48, { width: w, align: 'center' });
  });
  doc.y = y + 70;
  doc.x = x0;
}

module.exports = { createPdf, section, keyValues, table, signatureBlock, ensureSpace, fmtDate, fmtDateTime, BLUE };

'use strict';
/**
 * Export Word (.docx) avec l’en-tête officiel de la Direction en première page, un rappel discret sur
 * les suivantes et le pied de page officiel sur chaque page (services/entete.js) ; polices de l’en-tête
 * incorporées au document.
 */
const { Document, Packer, Paragraph, TextRun, AlignmentType, Table, TableRow, TableCell, WidthType, HeadingLevel, ShadingType } = require('docx');
const { DEP_NOM } = require('../constants');
const identite = require('./identite');
const entete = require('./entete');

function p(text, opts = {}) {
  return new Paragraph({ alignment: opts.align, spacing: { after: opts.after ?? 80 }, children: [new TextRun({ text: String(text ?? ''), bold: opts.bold, size: opts.size, color: opts.color, italics: opts.italics })] });
}

/**
 * Document Word complet : `children` (contenu) habillé de l’en-tête et du pied de page officiels.
 * `variante` : 'DEP' ou 'SG' ; `identiteId` : identité du Ministère d’un document signé.
 */
async function documentWord({ titre, children, variante = 'DEP', reference, identiteId = null, orientation }) {
  const ident = identite.version(identiteId);
  const section = await entete.wordSection(ident, { variante, reference });
  if (orientation) section.properties.page.size = { orientation };
  const doc = new Document({
    creator: `SIG-DEP — ${DEP_NOM}`, title: titre, fonts: entete.wordPolices(),
    styles: { default: { document: { run: { font: 'Calibri' } } } },
    sections: [{ properties: section.properties, headers: section.headers, footers: section.footers, children }],
  });
  return Packer.toBuffer(doc);
}

function table(columns, rows) {
  const cell = (text, header) => new TableCell({
    shading: header ? { type: ShadingType.SOLID, color: '0B3D6E', fill: '0B3D6E' } : undefined,
    children: [new Paragraph({ children: [new TextRun({ text: String(text ?? ''), bold: header, color: header ? 'FFFFFF' : undefined, size: 18 })] })],
  });
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [new TableRow({ tableHeader: true, children: columns.map((c) => cell(c.label, true)) }),
      ...rows.map((r) => new TableRow({ children: columns.map((c) => cell(r[c.key], false)) }))],
  });
}

/** sections : [{ label, type, value, columns }] */
async function buildDocx({ titre, reference, meta = [], sections = [], visas = [], variante, identiteId }) {
  const children = [...(reference ? [p(`Réf. : ${reference}`, { align: AlignmentType.RIGHT, size: 16, after: 120 })] : []), new Paragraph({ heading: HeadingLevel.TITLE, alignment: AlignmentType.CENTER, spacing: { after: 240 }, children: [new TextRun({ text: titre, bold: true, size: 30, color: '0B3D6E' })] })];
  for (const [k, v] of meta) children.push(new Paragraph({ spacing: { after: 40 }, children: [new TextRun({ text: `${k} : `, bold: true, size: 20 }), new TextRun({ text: String(v ?? '—'), size: 20 })] }));
  children.push(p(''));
  for (const s of sections) {
    children.push(new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 200, after: 80 }, children: [new TextRun({ text: s.label, bold: true, size: 22, color: '0B3D6E' })] }));
    if (s.type === 'list') (s.value || []).forEach((x) => children.push(new Paragraph({ bullet: { level: 0 }, children: [new TextRun({ text: String(x), size: 20 })] })));
    else if (s.type === 'table') children.push(table(s.columns, s.value || []));
    else String(s.value ?? '—').split('\n').forEach((line) => children.push(p(line, { size: 20 })));
  }
  if (visas.length) {
    children.push(p(''), new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: 'Visas et signature', bold: true, size: 22, color: '0B3D6E' })] }));
    for (const v of visas) children.push(p(`${v.libelle} — ${v.nom} — ${v.type === 'SIGNATURE' ? 'Signé' : v.type === 'RELECTURE' ? 'Relu' : 'Visa'} le ${new Date(v.date).toLocaleString('fr-FR', { timeZone: 'Africa/Kinshasa' })}`, { size: 18 }));
  }
  return documentWord({ titre, children, reference, variante, identiteId });
}

module.exports = { buildDocx, documentWord, p };

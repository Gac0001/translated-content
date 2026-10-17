'use strict';
/**
 * En-tête et pied de page officiels de la Direction (cahier des charges, section 7 et annexe 12),
 * communs à tous les documents produits : PDF, Word et Excel. Les cartes de service ont leur propre
 * modèle et ne sont pas concernées.
 *
 * En-tête (première page, centré) : sceau aux armoiries (~2,2 cm) ; Ministère en Cooper Hewitt gras
 * 10 pt capitales ; Secrétariat Général et Direction en Great Vibes 14 pt soulignés. Variante « SG »
 * pour les documents signés par le Secrétaire Général. Pages suivantes : rappel discret (Direction et
 * référence).
 * Pied de page (chaque page) : adresse ; courriel • site ; QR code à droite ; bande bleu-jaune-rouge en
 * parts égales sur toute la largeur ; numéro de page au-dessus, à droite, au-delà d’une page.
 */
const QRCode = require('qrcode');
const identite = require('./identite');
const { DEP_NOM } = require('../constants');

const TRICOLORE = ['#0095c9', '#fff24b', '#db3832']; // couleurs officielles de la charte graphique
const GRIS = '#444444';
const MM = 72 / 25.4;

/** Deuxième ligne du pied de page, comme sur le modèle officiel. */
const lignePied = (ident) => `•  E-mail :  ${ident.courriel}      •  ${ident.site_web}`;

/** Lignes de l’en-tête selon la variante (DEP par défaut, SG pour le Secrétaire Général). */
function lignes(ident, variante = 'DEP') {
  return variante === 'SG'
    ? [ident.ministere, ident.secretariat_general, ident.secretaire_general_titre]
    : [ident.ministere, ident.secretariat_general, ident.direction];
}

// ─── PDF (pdfkit) ───────────────────────────────────────────────────────────
const PIED_PDF = 64; // hauteur réservée au pied de page (pt)

function pdfPolices(doc) {
  const f = identite.policesEntete().woff;
  doc.registerFont('CH-Gras', f.cooperGras);
  doc.registerFont('CH', f.cooper);
  doc.registerFont('GreatVibes', f.greatVibes);
}

/** En-tête complet en haut de la page courante ; renvoie l’ordonnée sous l’en-tête. */
function pdfEntete(doc, ident, { variante = 'DEP' } = {}) {
  const W = doc.page.width;
  const [l1, l2, l3] = lignes(ident, variante);
  let y = 22;
  const d = 22 * MM; // diamètre du sceau
  if (ident.sceau) {
    try { doc.image(ident.sceau, (W - d) / 2, y, { fit: [d, d], align: 'center', valign: 'center' }); } catch { /* image illisible : en-tête sans sceau */ }
    y += d + 4;
  }
  doc.font('CH-Gras').fontSize(10).fillColor('#000').text(String(l1).toUpperCase(), 0, y, { width: W, align: 'center', lineBreak: false });
  y += 15;
  for (const l of [l2, l3]) {
    doc.font('GreatVibes').fontSize(14).fillColor('#000').text(l, 0, y, { width: W, align: 'center', underline: true, lineBreak: false });
    y += 19;
  }
  doc.font('Helvetica');
  return y + 6;
}

/** Rappel discret des pages suivantes : Direction et référence du document. */
function pdfRappel(doc, reference) {
  const x = doc.page.margins.left; const w = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  doc.font('Helvetica').fontSize(7.5).fillColor(GRIS).text(`${DEP_NOM}${reference ? ` — ${reference}` : ''}`, x, 22, { width: w, align: 'left', lineBreak: false });
  doc.moveTo(x, 33).lineTo(x + w, 33).lineWidth(0.4).strokeColor('#b8c4d0').stroke();
  doc.fillColor('#000');
  return 42;
}

/** QR code vectoriel (net à l’impression). */
function pdfQr(doc, texte, x, y, taille) {
  const q = QRCode.create(texte || ' ', { errorCorrectionLevel: 'M' });
  const n = q.modules.size; const c = taille / n;
  doc.save().fillColor('#000');
  for (let r = 0; r < n; r += 1) for (let k = 0; k < n; k += 1) if (q.modules.get(r, k)) doc.rect(x + k * c, y + r * c, c + 0.05, c + 0.05).fill();
  doc.restore();
}

/** Pied de page officiel de la page courante. */
function pdfPied(doc, ident, { page = 1, total = 1 } = {}) {
  const W = doc.page.width; const H = doc.page.height;
  const marge = doc.page.margins.bottom;
  doc.page.margins.bottom = 0; // écrire dans la marge sans créer de page
  const bande = 8.5; const qr = 36;
  const yQr = H - bande - 6 - qr;
  if (total > 1) doc.font('Helvetica').fontSize(8).fillColor(GRIS).text(`${page}/${total}`, 0, yQr - 12, { width: W - doc.page.margins.right, align: 'right', lineBreak: false });
  pdfQr(doc, ident.qr_contenu, W - doc.page.margins.right - qr, yQr, qr);
  doc.font('CH').fontSize(8.5).fillColor('#111').text(ident.adresse, 0, yQr + 8, { width: W, align: 'center', lineBreak: false });
  doc.text(lignePied(ident), 0, yQr + 20, { width: W, align: 'center', lineBreak: false });
  TRICOLORE.forEach((c, i) => doc.rect((W / 3) * i, H - bande, W / 3 + 0.5, bande).fill(c));
  doc.fillColor('#000');
  doc.page.margins.bottom = marge;
}

// ─── Word (docx) ────────────────────────────────────────────────────────────
/** Polices incorporées au document Word (OpenType reconstitué). */
function wordPolices() {
  const { CharacterSet } = require('docx');
  const p = identite.policesEntete().otf;
  return [
    { name: 'Cooper Hewitt', data: p.cooperGras, characterSet: CharacterSet.ANSI },
    { name: 'Cooper Hewitt Book', data: p.cooper, characterSet: CharacterSet.ANSI },
    { name: 'Great Vibes', data: p.greatVibes, characterSet: CharacterSet.ANSI },
  ];
}

/** En-têtes (première page complète, suivantes discrètes) et pieds de page d’une section Word. */
async function wordSection(ident, { variante = 'DEP', reference } = {}) {
  const { Header, Footer, Paragraph, TextRun, ImageRun, AlignmentType, Table, TableRow, TableCell, WidthType, ShadingType, BorderStyle, TableLayoutType, VerticalAlign } = require('docx');
  const [l1, l2, l3] = lignes(ident, variante);
  const sansBord = { top: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' }, bottom: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' }, left: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' }, right: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' } };
  const centre = (children, after = 0) => new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after, before: 0 }, children });
  const premiere = [];
  if (ident.sceau) {
    premiere.push(centre([new ImageRun({ type: (ident.sceau_type || '').includes('jpeg') ? 'jpg' : 'png', data: ident.sceau, transformation: { width: 83, height: 83 } })], 40));
  }
  premiere.push(
    centre([new TextRun({ text: String(l1).toUpperCase(), font: 'Cooper Hewitt', size: 20 })], 20), // la police incorporée est la graisse « gras »
    centre([new TextRun({ text: l2, font: 'Great Vibes', size: 28, underline: {} })], 0),
    centre([new TextRun({ text: l3, font: 'Great Vibes', size: 28, underline: {} })], 120),
  );
  const discret = [new Paragraph({ children: [new TextRun({ text: `${DEP_NOM}${reference ? ` — ${reference}` : ''}`, size: 15, color: '444444' })] })];

  const qr = await QRCode.toBuffer(ident.qr_contenu || ' ', { errorCorrectionLevel: 'M', margin: 0, width: 240 });
  const pied = () => [
    new Table({
      width: { size: 9026, type: WidthType.DXA }, columnWidths: [1250, 6526, 1250], layout: TableLayoutType.FIXED,
      borders: { top: sansBord.top, bottom: sansBord.bottom, left: sansBord.left, right: sansBord.right, insideHorizontal: sansBord.top, insideVertical: sansBord.top },
      rows: [new TableRow({
        children: [
          new TableCell({ width: { size: 1250, type: WidthType.DXA }, borders: sansBord, children: [new Paragraph('')] }),
          new TableCell({
            width: { size: 6526, type: WidthType.DXA }, borders: sansBord, verticalAlign: VerticalAlign.CENTER,
            children: [
              centre([new TextRun({ text: ident.adresse, size: 17, font: 'Cooper Hewitt Book' })]),
              centre([new TextRun({ text: lignePied(ident), size: 17, font: 'Cooper Hewitt Book' })]),
            ],
          }),
          new TableCell({ width: { size: 1250, type: WidthType.DXA }, borders: sansBord, children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new ImageRun({ type: 'png', data: qr, transformation: { width: 46, height: 46 } })] })] }),
        ],
      })],
    }),
    // Bande aux trois couleurs nationales, en parts égales
    new Table({
      width: { size: 9026, type: WidthType.DXA }, columnWidths: [3009, 3009, 3008], layout: TableLayoutType.FIXED,
      rows: [new TableRow({
        height: { value: 170, rule: 'exact' },
        children: TRICOLORE.map((c) => new TableCell({ width: { size: 3009, type: WidthType.DXA }, borders: sansBord, shading: { type: ShadingType.SOLID, color: c.slice(1), fill: c.slice(1) }, children: [new Paragraph({ spacing: { after: 0 }, children: [new TextRun({ text: '', size: 2 })] })] })),
      })],
    }),
  ];
  return {
    properties: { titlePage: true, page: { margin: { top: 1000, bottom: 1300, footer: 300 } } },
    headers: { first: new Header({ children: premiere }), default: new Header({ children: discret }) },
    footers: { first: new Footer({ children: pied() }), default: new Footer({ children: pied() }) },
  };
}

// ─── Excel (exceljs) ────────────────────────────────────────────────────────
/**
 * En-tête officiel dans les premières lignes de la feuille (sceau, Ministère, Secrétariat Général,
 * Direction), répété à l’impression ; pied de page officiel dans le pied d’impression.
 * Renvoie le numéro de la première ligne libre sous l’en-tête.
 */
function excelEntete(wb, ws, ident, nbColonnes, { variante = 'DEP' } = {}) {
  const n = Math.max(nbColonnes, 3);
  const [l1, l2, l3] = lignes(ident, variante);
  let ligne = 1;
  if (ident.sceau) {
    try {
      const id = wb.addImage({ buffer: ident.sceau, extension: (ident.sceau_type || '').includes('jpeg') ? 'jpeg' : 'png' });
      ws.getRow(1).height = 48;
      // Centrage du sceau sur la largeur réelle des colonnes fusionnées (en unités de largeur Excel)
      const largeurs = Array.from({ length: n }, (_, i) => ws.getColumn(i + 1).width || 9);
      let reste = largeurs.reduce((a, b) => a + b, 0) / 2 - 58 / 7 / 2; let col = 0;
      while (col < n - 1 && reste > largeurs[col]) { reste -= largeurs[col]; col += 1; }
      const EMU = 9525; // par pixel ; une unité de largeur de colonne Excel ≈ 7 pixels
      ws.addImage(id, { tl: { nativeCol: col, nativeColOff: Math.round(Math.max(0, reste) * 7 * EMU), nativeRow: 0, nativeRowOff: 2 * EMU }, ext: { width: 58, height: 58 }, editAs: 'oneCell' });
      ligne = 2;
    } catch { /* sceau illisible : en-tête texte seul */ }
  }
  const ecrire = (texte, font) => {
    const r = ws.getRow(ligne);
    r.getCell(1).value = texte;
    ws.mergeCells(ligne, 1, ligne, n);
    r.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };
    r.getCell(1).font = font;
    ligne += 1;
  };
  ecrire(String(l1).toUpperCase(), { name: 'Cooper Hewitt', bold: true, size: 10 });
  ecrire(l2, { name: 'Great Vibes', size: 14, underline: true });
  ecrire(l3, { name: 'Great Vibes', size: 14, underline: true });
  const echappe = (t) => String(t).replace(/&/g, '&&');
  // Impression : en-tête complet dans les lignes de la première page, rappel discret sur les suivantes
  // (comme pour les documents) ; pied officiel sur chaque page. Une taille (&8) suivie d’un chiffre se
  // lirait comme une autre taille : une espace les sépare.
  const pied = `&C&8 ${echappe(ident.adresse)}\n${echappe(lignePied(ident))}&R&8 &P/&N`;
  ws.headerFooter = {
    differentFirst: true,
    firstHeader: '', firstFooter: pied,
    oddHeader: `&L&8 ${echappe(DEP_NOM)}`, oddFooter: pied,
  };
  ws.pageSetup.margins = { left: 0.5, right: 0.5, top: 1.1, bottom: 0.8, header: 0.3, footer: 0.3 };
  return ligne + 1;
}

/** Nouvelle feuille Excel habillée de l’en-tête officiel ; les `addRow` suivants s’écrivent dessous. */
function feuilleOfficielle(wb, nom, nbColonnes, { largeurs = [], options = {}, variante } = {}) {
  const ws = wb.addWorksheet(String(nom).slice(0, 31), options);
  largeurs.forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  excelEntete(wb, ws, require('./identite').courante(), nbColonnes, { variante });
  return ws;
}

module.exports = { feuilleOfficielle, lignes, lignePied, pdfPolices, pdfEntete, pdfRappel, pdfPied, pdfQr, PIED_PDF, wordPolices, wordSection, excelEntete, TRICOLORE };

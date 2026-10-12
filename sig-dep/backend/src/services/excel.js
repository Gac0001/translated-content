'use strict';
/**
 * Exports Excel (exceljs) avec l’en-tête officiel de la Direction dans les premières lignes de chaque
 * feuille (répété à l’impression) et le pied de page officiel dans le pied d’impression.
 */
const ExcelJS = require('exceljs');
const { DEP_NOM } = require('../constants');
const identite = require('./identite');
const entete = require('./entete');

function addSheet(wb, { name, titre, sousTitre, columns, rows }) {
  const ws = wb.addWorksheet(name.slice(0, 31), { pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1 } });
  const n = Math.max(columns.length, 3);
  columns.forEach((c, i) => { ws.getColumn(i + 1).width = c.width || 18; });
  let ligne = entete.excelEntete(wb, ws, identite.courante(), n);
  [[titre, { bold: true, size: 13, color: { argb: 'FF0B3D6E' } }], [sousTitre, { size: 10, color: { argb: 'FF444444' } }]].forEach(([t, font]) => {
    if (!t) return;
    const r = ws.getRow(ligne);
    r.getCell(1).value = t;
    ws.mergeCells(ligne, 1, ligne, n);
    r.getCell(1).alignment = { horizontal: 'center' };
    r.getCell(1).font = font;
    ligne += 1;
  });
  const headerRowIdx = ligne + 1;
  const hr = ws.getRow(headerRowIdx);
  columns.forEach((c, i) => {
    const cell = hr.getCell(i + 1);
    cell.value = c.header;
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0B3D6E' } };
    cell.alignment = { vertical: 'middle', wrapText: true };
    ws.getColumn(i + 1).width = c.width || 18;
  });
  rows.forEach((row) => {
    const r = ws.addRow(columns.map((c) => {
      const v = typeof c.value === 'function' ? c.value(row) : row[c.key];
      return v === undefined ? null : v;
    }));
    r.eachCell((cell) => {
      cell.alignment = { vertical: 'top', wrapText: true };
      cell.border = { top: { style: 'thin', color: { argb: 'FFB8C4D0' } }, bottom: { style: 'thin', color: { argb: 'FFB8C4D0' } }, left: { style: 'thin', color: { argb: 'FFB8C4D0' } }, right: { style: 'thin', color: { argb: 'FFB8C4D0' } } };
    });
  });
  ws.views = [{ state: 'frozen', ySplit: headerRowIdx }];
  ws.addRow([]);
  ws.addRow([`Généré par SIG-DEP — ${DEP_NOM} — ${new Date().toLocaleString('fr-FR', { timeZone: 'Africa/Kinshasa' })}`]).font = { italic: true, size: 8, color: { argb: 'FF666666' } };
  ws.pageSetup.printTitlesRow = `${headerRowIdx}:${headerRowIdx}`; // intitulés de colonnes répétés à chaque page
  return ws;
}

async function sendWorkbook(res, filename, sheets) {
  const wb = new ExcelJS.Workbook();
  wb.creator = `SIG-DEP — ${DEP_NOM}`;
  wb.created = new Date();
  for (const s of sheets) addSheet(wb, s);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  await wb.xlsx.write(res);
  res.end();
}

module.exports = { sendWorkbook, addSheet };

'use strict';
/** Exports Excel (exceljs) avec en-tête officiel de la Direction d’Études et Planification. */
const ExcelJS = require('exceljs');
const { DEP_NOM, SG_NOM, PAYS } = require('../constants');

function addSheet(wb, { name, titre, sousTitre, columns, rows }) {
  const ws = wb.addWorksheet(name.slice(0, 31), { pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1 } });
  const n = Math.max(columns.length, 3);
  const lines = [PAYS.toUpperCase(), SG_NOM.toUpperCase(), `${DEP_NOM.toUpperCase()} (DEP)`, '', titre || '', sousTitre || ''];
  lines.forEach((t, i) => {
    const r = ws.getRow(i + 1);
    r.getCell(1).value = t;
    ws.mergeCells(i + 1, 1, i + 1, n);
    r.getCell(1).alignment = { horizontal: 'center' };
    r.getCell(1).font = { bold: i === 2 || i === 4, size: i === 4 ? 13 : 10, color: { argb: i === 2 || i === 4 ? 'FF0B3D6E' : 'FF222222' } };
  });
  const headerRowIdx = lines.length + 1;
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

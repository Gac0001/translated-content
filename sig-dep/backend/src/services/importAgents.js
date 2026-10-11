'use strict';
/**
 * Import du personnel depuis une liste officielle (Word .docx, Excel .xlsx ou CSV).
 *
 * Format reconnu : un tableau avec une ligne d’en-tête (N°, NOM POSTNOM & PRÉNOM, MATRICULE,
 * GRADE ou FONCTION…), des lignes de section donnant la structure (« 1. Bureau Secrétariat de
 * Direction », « 2. Division … », « 2.1. Bureau … ») et une ligne par Agent.
 * Colonnes facultatives : Structure, Sexe, Téléphone, E-mail, ou Nom / Postnom / Prénom séparés.
 *
 * L’analyse n’écrit rien : elle propose, pour chaque ligne, la structure, le poste et les anomalies.
 */
const JSZip = require('jszip');
const ExcelJS = require('exceljs');

// ─── Lecture des fichiers ───────────────────────────────────────────────────
function decodeXml(s) {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (m, n) => String.fromCodePoint(Number(n))).replace(/&#x([0-9a-f]+);/gi, (m, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&');
}

function cellText(xml) {
  const parts = [];
  const re = /<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:tab\/>|<w:br\/>|<\/w:p>/g;
  let m;
  while ((m = re.exec(xml))) parts.push(m[1] !== undefined ? m[1] : ' ');
  return decodeXml(parts.join('')).replace(/\s+/g, ' ').trim();
}

/** Tableaux d’un document Word : tableau de lignes, chaque ligne étant un tableau de cellules. */
async function readDocx(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const file = zip.file('word/document.xml');
  if (!file) throw new Error('Document Word invalide (word/document.xml absent).');
  const xml = await file.async('string');
  const rows = [];
  for (const tr of xml.match(/<w:tr[ >][\s\S]*?<\/w:tr>/g) || []) {
    rows.push((tr.match(/<w:tc>[\s\S]*?<\/w:tc>/g) || []).map(cellText));
  }
  return rows;
}

async function readXlsx(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = wb.worksheets[0];
  if (!ws) return [];
  const rows = [];
  ws.eachRow({ includeEmpty: false }, (row) => {
    const cells = [];
    for (let i = 1; i <= row.cellCount; i += 1) {
      const v = row.getCell(i).value;
      const t = v === null || v === undefined ? '' : typeof v === 'object' ? (v.text || v.result || (v.richText ? v.richText.map((r) => r.text).join('') : '') || String(v)) : String(v);
      cells.push(String(t).replace(/\s+/g, ' ').trim());
    }
    rows.push(cells);
  });
  return rows;
}

function readCsv(buffer) {
  const text = buffer.toString('utf8').replace(/^﻿/, '');
  const first = text.split(/\r?\n/)[0] || '';
  const sep = (first.match(/;/g) || []).length >= (first.match(/,/g) || []).length ? ';' : ',';
  return text.split(/\r?\n/).filter((l) => l.trim()).map((line) => {
    const out = []; let cur = ''; let q = false;
    for (let i = 0; i < line.length; i += 1) {
      const c = line[i];
      if (q) { if (c === '"' && line[i + 1] === '"') { cur += '"'; i += 1; } else if (c === '"') q = false; else cur += c; } else if (c === '"') q = true; else if (c === sep) { out.push(cur.trim()); cur = ''; } else cur += c;
    }
    out.push(cur.trim());
    return out;
  });
}

async function readRows(buffer, filename) {
  const ext = (filename.split('.').pop() || '').toLowerCase();
  if (ext === 'docx') return { format: 'Word', rows: await readDocx(buffer) };
  if (ext === 'xlsx') return { format: 'Excel', rows: await readXlsx(buffer) };
  if (ext === 'csv' || ext === 'txt') return { format: 'CSV', rows: readCsv(buffer) };
  throw new Error('Format non pris en charge : utilisez un fichier Word (.docx), Excel (.xlsx) ou CSV.');
}

// ─── Normalisation ──────────────────────────────────────────────────────────
function norm(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/^\s*[\divx]+(\.\d+)*\.?\s*[-–)]?\s*/i, '') // numérotation « 2.1. »
    .replace(/[^a-z0-9]+/g, ' ').trim();
}

function normalizeMatricule(m) {
  return String(m || '').toUpperCase().replace(/[\s.,]/g, '');
}

const UPPER = /^[A-ZÀ-ÖØ-Þ'’-]+$/;
/** « KALOMBO MUSAU Jean » → nom KALOMBO, postnom MUSAU, prénom Jean. */
function splitNom(full) {
  const tokens = String(full || '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  if (!tokens.length) return { nom: '', postnom: null, prenom: null };
  const [nom, ...rest] = tokens;
  const post = [];
  let i = 0;
  while (i < rest.length && UPPER.test(rest[i]) && /[A-ZÀ-Þ]/.test(rest[i])) { post.push(rest[i]); i += 1; }
  const prenom = rest.slice(i).join(' ');
  return { nom, postnom: post.join(' ') || null, prenom: prenom || null };
}

function normSexe(v) {
  const s = norm(v);
  if (['m', 'masculin', 'homme', 'h'].includes(s)) return 'M';
  if (['f', 'feminin', 'femme'].includes(s)) return 'F';
  return null;
}

// ─── Interprétation ─────────────────────────────────────────────────────────
function findHeader(rows) {
  for (let i = 0; i < Math.min(rows.length, 30); i += 1) {
    const n = rows[i].map(norm);
    if (n.some((c) => c.includes('matricule')) && n.some((c) => /\bnom\b|\bnoms\b/.test(c))) return i;
  }
  return -1;
}

function columnMap(header) {
  const n = header.map(norm);
  const find = (re, exclude) => n.findIndex((c) => re.test(c) && !(exclude && exclude.test(c)));
  const col = {
    numero: find(/^(n|no|num|numero|n o)$/),
    matricule: find(/matricule/),
    grade: find(/\bgrade\b/),
    fonction: find(/fonction/),
    structure: find(/structure|affectation|service|\bbureau\b|\bdivision\b/),
    sexe: find(/\bsexe\b|\bgenre\b/),
    telephone: find(/telephone|\btel\b|phone/),
    email: find(/e ?mail|courriel/),
    postnom: find(/^postnom$|^post nom$/),
    prenom: find(/^prenoms?$/),
  };
  col.nomComplet = find(/\bnom\b.*(postnom|prenom)/);
  col.nom = col.nomComplet >= 0 ? -1 : find(/^noms?$/);
  // Une colonne « FONCTION » qui contient des codes de grade (CB, ATA2…) sert de grade.
  if (col.grade < 0 && col.fonction >= 0) col.grade = col.fonction;
  return col;
}

function isSection(cells, col) {
  const vals = [...new Set(cells.filter((c) => c !== ''))];
  if (vals.length !== 1) return false;
  const first = cells[col.numero >= 0 ? col.numero : 0] || '';
  return !/^\d+$/.test(first) || vals[0].length > 6;
}

/**
 * Analyse les lignes d’un fichier.
 * ref : { bureaux, divisions, grades, existants (Map matricule → agent), chefsEnPoste (Set 'BUR:id' | 'DIV:id') }
 */
function analyse(rows, ref) {
  const h = findHeader(rows);
  if (h < 0) throw new Error('En-tête introuvable : le tableau doit comporter au moins les colonnes « Nom » et « Matricule ».');
  const col = columnMap(rows[h]);
  const idx = (k) => col[k];
  // « Perspective » (ancienne graphie de certaines listes) désigne le Bureau Études, Analyses et Prospective.
  const normStructure = (x) => norm(x).replace(/\bperspectives?\b/g, 'prospective');
  const bureaux = ref.bureaux.map((x) => ({ ...x, n: normStructure(x.nom) }));
  const divisions = ref.divisions.map((x) => ({ ...x, n: normStructure(x.nom) }));
  const grades = Object.fromEntries(ref.grades.map((g) => [g.code.toUpperCase(), g]));

  const matchStructure = (label) => {
    // Code organique en tête de ligne (ex. « 5.3.3.1.1 Bureau … ») : correspondance exacte.
    const co = String(label || '').match(/^\s*(\d+(?:\.\d+){2,})\b/);
    if (co) {
      const bc = bureaux.find((x) => x.code_organique === co[1]);
      if (bc) return { type: 'BUREAU', id: bc.id, nom: bc.nom, divisionId: bc.division_id };
      const dc = divisions.find((x) => x.code_organique === co[1]);
      if (dc) return { type: 'DIVISION', id: dc.id, nom: dc.nom };
    }
    const n = normStructure(label);
    if (!n) return null;
    const b = bureaux.find((x) => x.n === n) || bureaux.find((x) => n.includes(x.n) || x.n.includes(n));
    if (b) return { type: 'BUREAU', id: b.id, nom: b.nom, divisionId: b.division_id };
    const d = divisions.find((x) => x.n === n) || divisions.find((x) => n.includes(x.n) || x.n.includes(n));
    if (d) return { type: 'DIVISION', id: d.id, nom: d.nom };
    if (/^direction\b/.test(n)) return { type: 'DIRECTION', id: null, nom: 'Direction' };
    return null;
  };

  let section = null; let sectionLabel = null;
  const lignes = [];
  for (let i = h + 1; i < rows.length; i += 1) {
    const cells = rows[i];
    if (!cells.some((c) => c)) continue;
    if (isSection(cells, col)) {
      sectionLabel = cells.find((c) => c);
      section = matchStructure(sectionLabel);
      continue;
    }
    const get = (k) => (idx(k) >= 0 ? (cells[idx(k)] || '').trim() : '');
    const nomSource = col.nomComplet >= 0 ? get('nomComplet') : [get('nom'), get('postnom'), get('prenom')].filter(Boolean).join(' ');
    const matSource = get('matricule');
    if (!nomSource && !matSource) continue;
    const parts = col.nomComplet >= 0 ? splitNom(nomSource) : { nom: get('nom'), postnom: get('postnom') || null, prenom: get('prenom') || null };
    const structureLabel = get('structure') || sectionLabel;
    const structure = get('structure') ? matchStructure(get('structure')) : section;
    const gradeCode = get('grade').toUpperCase().replace(/\s+/g, '');
    const grade = grades[gradeCode] || null;
    lignes.push({
      ligne: i + 1, numero: get('numero') || null, nomSource,
      nom: parts.nom, postnom: parts.postnom, prenom: parts.prenom,
      matriculeSource: matSource, matricule: normalizeMatricule(matSource),
      gradeSource: get('grade') || null, grade_id: grade ? grade.id : null, grade_libelle: grade ? grade.libelle : null,
      sexe: normSexe(get('sexe')), telephone: get('telephone') || null, email: get('email') || null,
      structureSource: structureLabel || null, structure,
    });
  }

  // Poste proposé et anomalies
  const vus = new Map();
  for (const l of lignes) vus.set(l.matricule, (vus.get(l.matricule) || 0) + 1);
  const chefsFichier = new Set();
  for (const l of lignes) {
    const a = [];
    const s = l.structure;
    const gc = (l.gradeSource || '').toUpperCase();
    if (s && s.type === 'DIVISION') l.role = gc === 'CD' ? 'CHEF_DIVISION' : null;
    else if (s && s.type === 'BUREAU') l.role = gc === 'CB' ? 'CHEF_BUREAU' : 'AGENT';
    else l.role = null;

    if (!l.nom) a.push({ niveau: 'erreur', message: 'Nom absent.' });
    if (!l.matricule) a.push({ niveau: 'erreur', message: 'Matricule absent.' });
    else if (vus.get(l.matricule) > 1) a.push({ niveau: 'erreur', message: 'Matricule présent plusieurs fois dans le fichier.' });
    if (l.matricule && l.matriculeSource !== l.matricule) a.push({ niveau: 'info', message: `Matricule normalisé : ${l.matriculeSource} → ${l.matricule}.` });
    l.existantId = ref.existants.get(l.matricule)?.id || null;
    if (l.existantId) a.push({ niveau: 'avertissement', message: 'Un Agent portant ce matricule existe déjà.' });
    if (!l.grade_id) a.push({ niveau: 'avertissement', message: l.gradeSource ? `Grade « ${l.gradeSource} » inconnu du référentiel.` : 'Grade non renseigné.' });
    if (!s) a.push({ niveau: 'avertissement', message: l.structureSource ? `Structure « ${l.structureSource} » non reconnue : à choisir.` : 'Structure non renseignée : à choisir.' });
    if (s && s.type === 'DIVISION' && !l.role) a.push({ niveau: 'avertissement', message: 'Agent placé au niveau de la Division sans être Chef de Division : choisissez son Bureau.' });
    if (s && s.type === 'DIRECTION') a.push({ niveau: 'avertissement', message: 'Affectation au niveau de la Direction : réservée au Directeur, à traiter manuellement.' });
    if (l.role === 'CHEF_BUREAU' || l.role === 'CHEF_DIVISION') {
      const key = `${l.role === 'CHEF_BUREAU' ? 'BUR' : 'DIV'}:${s.id}`;
      if (chefsFichier.has(key)) { a.push({ niveau: 'avertissement', message: 'Un autre responsable figure déjà pour cette structure dans le fichier : affecté comme Agent.' }); l.role = l.role === 'CHEF_BUREAU' ? 'AGENT' : null; } else if (ref.chefsEnPoste.has(key)) { a.push({ niveau: 'avertissement', message: 'La structure a déjà un responsable en fonction dans SIG-DEP.' }); }
      chefsFichier.add(key);
    }
    if (!l.sexe) a.push({ niveau: 'info', message: 'Sexe non renseigné (à compléter sur la fiche).' });
    l.anomalies = a;
  }

  // Structures sans responsable dans le fichier
  const sansResponsable = [
    ...divisions.filter((d) => lignes.some((l) => l.structure && (l.structure.id === d.id && l.structure.type === 'DIVISION' || (l.structure.type === 'BUREAU' && l.structure.divisionId === d.id))) && !chefsFichier.has(`DIV:${d.id}`) && !ref.chefsEnPoste.has(`DIV:${d.id}`)).map((d) => ({ type: 'DIVISION', nom: d.nom })),
    ...bureaux.filter((b) => lignes.some((l) => l.structure && l.structure.type === 'BUREAU' && l.structure.id === b.id) && !chefsFichier.has(`BUR:${b.id}`) && !ref.chefsEnPoste.has(`BUR:${b.id}`)).map((b) => ({ type: 'BUREAU', nom: b.nom })),
  ];

  return {
    colonnes: Object.fromEntries(Object.entries(col).filter(([, v]) => v >= 0).map(([k, v]) => [k, rows[h][v]])),
    lignes,
    resume: {
      total: lignes.length,
      erreurs: lignes.filter((l) => l.anomalies.some((x) => x.niveau === 'erreur')).length,
      avertissements: lignes.filter((l) => l.anomalies.some((x) => x.niveau === 'avertissement')).length,
      existants: lignes.filter((l) => l.existantId).length,
      sansStructure: lignes.filter((l) => !l.structure).length,
      sansResponsable,
    },
  };
}

module.exports = { readRows, analyse, splitNom, normalizeMatricule, norm };

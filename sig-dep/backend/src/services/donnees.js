'use strict';
/**
 * Données sectorielles : contrôle de qualité des réponses, ciblage des campagnes, import et
 * exports de l’annuaire des acteurs et des réponses.
 */
const ExcelJS = require('exceljs');
const db = require('../db/knex');

const TYPES_QUESTION = ['NOMBRE', 'ENTIER', 'TEXTE', 'CHOIX', 'CHOIX_MULTIPLE', 'DATE', 'OUI_NON'];
const NUMERIQUES = ['NOMBRE', 'ENTIER'];
/** Variation au-delà de laquelle une valeur numérique est signalée par rapport à la période précédente. */
const SEUIL_VARIATION = 0.5;

const vide = (v) => v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length);
const fmt = (n) => String(Number(n)).replace('.', ',');

/** Contrôle d’une valeur selon la définition de sa question ; renvoie un message ou null. */
function controlerValeur(q, v) {
  if (vide(v)) return q.obligatoire ? 'Réponse obligatoire manquante.' : null;
  switch (q.type) {
    case 'NOMBRE': case 'ENTIER': {
      const n = Number(v);
      if (typeof v === 'boolean' || !Number.isFinite(n)) return 'Valeur numérique attendue.';
      if (q.type === 'ENTIER' && !Number.isInteger(n)) return 'Nombre entier attendu.';
      if (q.min !== undefined && q.min !== null && n < q.min) return `Valeur inférieure au minimum (${fmt(q.min)}).`;
      if (q.max !== undefined && q.max !== null && n > q.max) return `Valeur supérieure au maximum (${fmt(q.max)}).`;
      return null;
    }
    case 'TEXTE': return typeof v === 'string' && v.length <= 5000 ? null : 'Texte attendu (5 000 caractères au plus).';
    case 'CHOIX': return (q.options || []).includes(v) ? null : 'Choix hors de la liste proposée.';
    case 'CHOIX_MULTIPLE': return Array.isArray(v) && v.every((x) => (q.options || []).includes(x)) ? null : 'Choix hors de la liste proposée.';
    case 'DATE': return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)) ? null : 'Date attendue (AAAA-MM-JJ).';
    case 'OUI_NON': return typeof v === 'boolean' ? null : 'Réponse Oui ou Non attendue.';
    default: return 'Type de question inconnu.';
  }
}

const OPERATEURS = { '<=': (a, b) => a <= b, '>=': (a, b) => a >= b, '=': (a, b) => a === b, '<': (a, b) => a < b, '>': (a, b) => a > b };

/**
 * Anomalies d’une réponse : erreurs (bloquantes) et alertes (à justifier).
 * @param version   version du questionnaire (questions, contrôles de cohérence)
 * @param valeurs   { CODE: valeur }
 * @param precedent valeurs de l’acteur à la dernière campagne validée du même questionnaire
 */
function anomalies(version, valeurs, precedent = null) {
  const out = [];
  const questions = version.questions || [];
  for (const q of questions) {
    const m = controlerValeur(q, valeurs[q.code]);
    if (m) out.push({ question: q.code, niveau: 'ERREUR', message: `${q.libelle} : ${m}` });
  }
  for (const k of Object.keys(valeurs)) {
    if (!questions.some((q) => q.code === k)) out.push({ question: k, niveau: 'ERREUR', message: `Question inconnue : ${k}.` });
  }
  const num = (code) => { const q = questions.find((x) => x.code === code); const v = valeurs[code]; return q && NUMERIQUES.includes(q.type) && !vide(v) && Number.isFinite(Number(v)) ? Number(v) : null; };
  for (const c of version.controles || []) {
    const a = num(c.gauche);
    const b = typeof c.droite === 'number' ? c.droite : num(c.droite);
    if (a === null || b === null || !OPERATEURS[c.operateur]) continue;
    if (!OPERATEURS[c.operateur](a, b)) out.push({ question: c.gauche, niveau: 'ERREUR', message: c.message || `Incohérence : ${c.gauche} ${c.operateur} ${c.droite} non respecté.` });
  }
  if (precedent) {
    for (const q of questions.filter((x) => NUMERIQUES.includes(x.type))) {
      const v = num(q.code);
      const p = Number(precedent[q.code]);
      if (v === null || vide(precedent[q.code]) || !Number.isFinite(p) || p === 0) continue;
      const ecart = (v - p) / Math.abs(p);
      if (Math.abs(ecart) > SEUIL_VARIATION) {
        out.push({ question: q.code, niveau: 'ALERTE', message: `${q.libelle} : ${ecart > 0 ? 'hausse' : 'baisse'} de ${Math.round(Math.abs(ecart) * 100)} % par rapport à la période précédente (${fmt(p)}).` });
      }
    }
  }
  return out;
}

/** Normalise les valeurs saisies (nombres, booléens) selon les questions ; ignore les vides. */
function normaliser(version, brutes) {
  const out = {};
  for (const [k, v] of Object.entries(brutes || {})) {
    if (vide(v)) continue;
    const q = (version.questions || []).find((x) => x.code === k);
    if (q && NUMERIQUES.includes(q.type) && typeof v === 'string') {
      const n = Number(v.replace(/[\s  ]/g, '').replace(',', '.'));
      out[k] = Number.isFinite(n) ? n : v;
    } else out[k] = typeof v === 'string' ? v.trim() : v;
  }
  return out;
}

/** Valeurs de l’acteur à la dernière campagne validée du même questionnaire, antérieure à celle-ci. */
async function precedent(campagne, acteurId, trx = db) {
  const v = await trx('sect_questionnaire_versions').where({ id: campagne.version_id }).first('questionnaire_id');
  const r = await trx('sect_reponses as r').join('sect_campagnes as c', 'c.id', 'r.campagne_id').join('sect_questionnaire_versions as v', 'v.id', 'c.version_id')
    .where({ 'v.questionnaire_id': v.questionnaire_id, 'c.statut': 'VALIDEE', 'r.acteur_id': acteurId }).where('c.periode_fin', '<', campagne.periode_debut)
    .orderBy('c.periode_fin', 'desc').first('r.valeurs');
  return r ? r.valeurs : null;
}

/** Acteurs actifs correspondant aux zones et catégories de la campagne (toutes si vide). */
function acteursCibles(campagne, trx = db) {
  const q = trx('sect_acteurs').where('statut', 'ACTIF');
  if (campagne.zones?.length) q.whereIn('zone_id', campagne.zones);
  if (campagne.categories?.length) q.whereIn('categorie_id', campagne.categories);
  return q.pluck('id');
}

// ─── Annuaire : modèle, import, export ──────────────────────────────────────
const COLONNES = [
  ['raison_sociale', 'Raison sociale *', 40], ['sigle', 'Sigle', 14], ['categorie', 'Catégorie *', 34], ['zone', 'Province *', 18], ['ville', 'Ville', 16],
  ['adresse', 'Adresse', 34], ['forme_juridique', 'Forme juridique', 14], ['rccm', 'RCCM', 20], ['id_nat', 'Identification nationale', 20], ['numero_impot', 'N° impôt', 16],
  ['telephone', 'Téléphone', 16], ['email', 'Courriel', 26], ['site_web', 'Site web', 24], ['responsable', 'Responsable', 26],
  ['annee_creation', 'Année de création', 12], ['effectif', 'Effectif', 10], ['statut', 'Statut', 12], ['observations', 'Observations', 30],
];
const STATUTS_ACTEUR = { ACTIF: 'Actif', SUSPENDU: 'Suspendu', CESSE: 'Cessé' };
const sansAccent = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');

function entete(ws, cols) {
  const r = ws.addRow(cols.map((c) => c[1]));
  r.eachCell((cell) => { cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }; cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF17418A' } }; cell.alignment = { vertical: 'middle', wrapText: true }; });
  r.height = 30;
  cols.forEach((c, i) => { ws.getColumn(i + 1).width = c[2] || 18; });
  ws.views = [{ state: 'frozen', ySplit: r.number }];
}

/** Modèle d’import : feuille Acteurs et listes des catégories, provinces et statuts. */
async function modele() {
  const [categories, zones] = await Promise.all([db('sect_categories').where('actif', true).orderBy('ordre'), db('sect_zones').where('actif', true).orderBy('ordre')]);
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Acteurs');
  entete(ws, COLONNES);
  const listes = wb.addWorksheet('Listes');
  listes.addRow(['Catégories', 'Provinces', 'Statuts']).font = { bold: true };
  const n = Math.max(categories.length, zones.length, 3);
  for (let i = 0; i < n; i += 1) listes.addRow([categories[i]?.libelle || null, zones[i]?.libelle || null, Object.values(STATUTS_ACTEUR)[i] || null]);
  listes.columns.forEach((c) => { c.width = 48; });
  for (let r = 2; r <= 1000; r += 1) {
    ws.getCell(r, 3).dataValidation = { type: 'list', allowBlank: true, formulae: [`Listes!$A$2:$A$${categories.length + 1}`] };
    ws.getCell(r, 4).dataValidation = { type: 'list', allowBlank: true, formulae: [`Listes!$B$2:$B$${zones.length + 1}`] };
    ws.getCell(r, 17).dataValidation = { type: 'list', allowBlank: true, formulae: ['Listes!$C$2:$C$4'] };
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

function texteCellule(c) {
  const v = c.value;
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') {
    if (v.richText) return v.richText.map((x) => x.text).join('').trim();
    if (v.text !== undefined) return String(v.text).trim();
    if (v.result !== undefined) return String(v.result).trim();
    if (v instanceof Date) return String(v.getFullYear());
  }
  return String(v).trim();
}

/**
 * Analyse d’un classeur d’import : chaque ligne est rapprochée du référentiel et de l’annuaire.
 * Résultat par ligne : NOUVEAU, DOUBLON (déjà dans l’annuaire ou plus haut dans le fichier) ou ERREUR.
 */
async function analyserImport(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = wb.worksheets.find((w) => /acteur/i.test(w.name)) || wb.worksheets[0];
  if (!ws) return { lignes: [] };
  // En-tête : première ligne contenant « Raison sociale »
  let ligneEntete = null;
  const index = {};
  ws.eachRow((row, n) => {
    if (ligneEntete) return;
    row.eachCell((c, col) => { if (/raison\s*sociale/i.test(texteCellule(c))) ligneEntete = n; if (ligneEntete === n) { const t = sansAccent(texteCellule(c)); const k = COLONNES.find((x) => sansAccent(x[1].replace('*', '')) === t || (x[0] === 'zone' && /province/.test(t))); if (k) index[k[0]] = col; } });
  });
  if (!ligneEntete) return { lignes: [], erreur: 'Colonne « Raison sociale » introuvable : utilisez le modèle d’import.' };
  const [categories, zones, existants] = await Promise.all([db('sect_categories').where('actif', true), db('sect_zones').where('actif', true), db('sect_acteurs').select('id', 'reference', 'raison_sociale', 'zone_id', 'rccm', 'id_nat')]);
  const vus = { rccm: new Map(), idnat: new Map(), nom: new Map() };
  for (const a of existants) {
    if (a.rccm) vus.rccm.set(a.rccm.toUpperCase(), a.reference);
    if (a.id_nat) vus.idnat.set(a.id_nat.toUpperCase(), a.reference);
    vus.nom.set(`${a.raison_sociale.toLowerCase()}|${a.zone_id}`, a.reference);
  }
  const lignes = [];
  for (let n = ligneEntete + 1; n <= ws.rowCount && lignes.length < 2000; n += 1) {
    const row = ws.getRow(n);
    const val = (k) => (index[k] ? texteCellule(row.getCell(index[k])) : '');
    const d = Object.fromEntries(COLONNES.map(([k]) => [k, val(k)]));
    if (!Object.values(d).some(Boolean)) continue;
    const erreurs = [];
    const cat = categories.find((c) => sansAccent(c.libelle) === sansAccent(d.categorie) || sansAccent(c.code) === sansAccent(d.categorie));
    const zone = zones.find((z) => sansAccent(z.libelle) === sansAccent(d.zone));
    if (!d.raison_sociale) erreurs.push('raison sociale manquante');
    if (!cat) erreurs.push(d.categorie ? `catégorie inconnue « ${d.categorie} »` : 'catégorie manquante');
    if (!zone) erreurs.push(d.zone ? `province inconnue « ${d.zone} »` : 'province manquante');
    const entier = (k, min, max) => { if (!d[k]) return null; const x = Number(d[k].replace(/\s/g, '')); if (!Number.isInteger(x) || x < min || x > max) { erreurs.push(`${k === 'effectif' ? 'effectif' : 'année de création'} invalide`); return null; } return x; };
    const statut = d.statut ? Object.keys(STATUTS_ACTEUR).find((k) => sansAccent(STATUTS_ACTEUR[k]) === sansAccent(d.statut) || k === d.statut.toUpperCase()) : 'ACTIF';
    if (!statut) erreurs.push(`statut inconnu « ${d.statut} »`);
    if (d.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email)) erreurs.push('courriel invalide');
    const acteur = {
      raison_sociale: d.raison_sociale.slice(0, 300), sigle: d.sigle || null, categorie_id: cat?.id || null, zone_id: zone?.id || null, ville: d.ville || null, adresse: d.adresse || null,
      forme_juridique: d.forme_juridique || null, rccm: d.rccm || null, id_nat: d.id_nat || null, numero_impot: d.numero_impot || null, telephone: d.telephone || null,
      email: d.email || null, site_web: d.site_web || null, responsable: d.responsable || null, annee_creation: entier('annee_creation', 1900, 2100), effectif: entier('effectif', 0, 10000000),
      statut: statut || 'ACTIF', observations: d.observations || null,
    };
    let doublon = null;
    if (acteur.rccm && vus.rccm.has(acteur.rccm.toUpperCase())) doublon = `même RCCM que ${vus.rccm.get(acteur.rccm.toUpperCase())}`;
    else if (acteur.id_nat && vus.idnat.has(acteur.id_nat.toUpperCase())) doublon = `même identification nationale que ${vus.idnat.get(acteur.id_nat.toUpperCase())}`;
    else if (acteur.zone_id && vus.nom.has(`${acteur.raison_sociale.toLowerCase()}|${acteur.zone_id}`)) doublon = `même raison sociale dans la province que ${vus.nom.get(`${acteur.raison_sociale.toLowerCase()}|${acteur.zone_id}`)}`;
    const etat = erreurs.length ? 'ERREUR' : doublon ? 'DOUBLON' : 'NOUVEAU';
    if (etat === 'NOUVEAU') {
      const ici = `ligne ${n}`;
      if (acteur.rccm) vus.rccm.set(acteur.rccm.toUpperCase(), ici);
      if (acteur.id_nat) vus.idnat.set(acteur.id_nat.toUpperCase(), ici);
      vus.nom.set(`${acteur.raison_sociale.toLowerCase()}|${acteur.zone_id}`, ici);
    }
    lignes.push({ ligne: n, etat, motif: erreurs.length ? erreurs.join(' ; ') : doublon, acteur, categorie: cat?.libelle || d.categorie, zone: zone?.libelle || d.zone });
  }
  return { feuille: ws.name, lignes };
}

/** Annuaire au format du modèle d’import (réimportable). */
async function exporterAnnuaire(rows) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Acteurs');
  entete(ws, [['reference', 'Référence', 20], ...COLONNES]);
  for (const a of rows) ws.addRow([a.reference, ...COLONNES.map(([k]) => (k === 'categorie' ? a.categorie : k === 'zone' ? a.zone : k === 'statut' ? STATUTS_ACTEUR[a.statut] : a[k] ?? null))]);
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: COLONNES.length + 1 } };
  return Buffer.from(await wb.xlsx.writeBuffer());
}

const STATUTS_REPONSE = { BROUILLON: 'Brouillon', SAISIE: 'Saisie', CONTROLEE: 'Contrôlée', A_CORRIGER: 'À corriger' };
function libelleValeur(q, v) {
  if (vide(v)) return null;
  if (q.type === 'OUI_NON') return v ? 'Oui' : 'Non';
  if (q.type === 'CHOIX_MULTIPLE') return v.join(' ; ');
  if (NUMERIQUES.includes(q.type)) return Number(v);
  return v;
}

/** Réponses d’une campagne : une ligne par acteur ciblé, une colonne par question. */
async function exporterReponses(campagne, version, cibles) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Réponses');
  ws.addRow([`${campagne.reference} — ${campagne.titre} (période ${campagne.periode})`]).font = { bold: true, size: 13 };
  const qs = version.questions || [];
  entete(ws, [['ref', 'Référence', 18], ['acteur', 'Acteur', 36], ['categorie', 'Catégorie', 28], ['zone', 'Province', 16], ['statut', 'Statut de la réponse', 16],
    ...qs.map((q) => [q.code, `${q.code} — ${q.libelle}${q.unite ? ` (${q.unite})` : ''}`, 22]), ['anomalies', 'Anomalies', 40]]);
  for (const c of cibles) {
    const r = ws.addRow([c.reference, c.raison_sociale, c.categorie, c.zone, c.reponse ? STATUTS_REPONSE[c.reponse.statut] : 'Non reçue',
      ...qs.map((q) => libelleValeur(q, c.reponse?.valeurs?.[q.code])), (c.reponse?.anomalies || []).map((a) => a.message).join(' | ') || null]);
    qs.forEach((q, i) => { if (NUMERIQUES.includes(q.type)) r.getCell(6 + i).numFmt = '#,##0.##'; });
  }
  const dico = wb.addWorksheet('Questionnaire');
  entete(dico, [['code', 'Code', 14], ['libelle', 'Question', 60], ['type', 'Type', 16], ['unite', 'Unité', 14], ['obligatoire', 'Obligatoire', 12], ['bornes', 'Bornes', 20], ['options', 'Options', 50]]);
  for (const q of qs) dico.addRow([q.code, q.libelle, q.type, q.unite || null, q.obligatoire ? 'Oui' : 'Non', NUMERIQUES.includes(q.type) ? [q.min, q.max].map((x) => x ?? '—').join(' à ') : null, (q.options || []).join(' ; ') || null]);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

module.exports = {
  TYPES_QUESTION, NUMERIQUES, SEUIL_VARIATION, STATUTS_ACTEUR, STATUTS_REPONSE,
  anomalies, normaliser, precedent, acteursCibles, modele, analyserImport, exporterAnnuaire, exporterReponses,
};

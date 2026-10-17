'use strict';
/**
 * PTBA au format du Ministère de l’Économie Numérique : lecture d’un classeur existant et
 * production du même format. Deux présentations coexistent dans le classeur du Ministère :
 *  - la vue standard (une feuille par service : programme, objectif global, objectifs spécifiques,
 *    activités, tâches, coût, chronogramme mensuel J…D surligné, structure responsable, résultats
 *    attendus, indicateurs, source de vérification, source de financement) ;
 *  - la vue budgétaire détaillée (feuilles DDCN, DCS) : MINISTÈRE > PROGRAMME > service > ACTION >
 *    ACTIVITÉ > Tâche > lignes de dépense (désignation, structure destinataire, nature économique,
 *    section/chapitre, unité physique, chronogramme 1 à 12, coût, source, lieu, mode de gestion).
 * La lecture produit un rapport d’anomalies (montants mal saisis, formules en erreur, totaux
 * incohérents, programme manquant…) et signale les feuilles qui relèvent d’un autre ministère.
 */
const ExcelJS = require('exceljs');
const db = require('../db/knex');
const identite = require('./identite');
const entete = require('./entete');

const MOIS = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];
const BLEU = 'FF17418A';
const JAUNE = 'FFFFFF00';

function texte(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') {
    if (v.richText) return v.richText.map((x) => x.text).join('');
    if (v.result !== undefined) return texte(v.result);
    if (v.text) return String(v.text);
    if (v instanceof Date) return v.toISOString().slice(0, 10);
  }
  return String(v);
}
const propre = (v) => texte(v).replace(/\s+/g, ' ').trim();

/** « 37 944 253 376,00 », 15000000, « 0 » → nombre (CDF). */
function montant(v) {
  if (typeof v === 'number') return Math.max(0, Math.round(v * 100) / 100);
  const t = texte(v).replace(/[\s  ]/g, '').replace(/,(\d{1,2})$/, '.$1').replace(/,/g, '');
  const n = Number.parseFloat(t);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : 0;
}

/** Une cellule du chronogramme est cochée si elle contient une marque ou si elle est colorée. */
function cochee(cell) {
  if (propre(cell.value)) return true;
  const f = cell.fill;
  if (!f || f.type !== 'pattern' || f.pattern !== 'solid') return false;
  const c = f.fgColor || {};
  if (c.argb) return !['FFFFFFFF', '00FFFFFF', 'FFFFFF'].includes(c.argb.toUpperCase());
  return c.theme !== undefined && c.theme !== 0 && c.theme !== 1;
}

const apres = (t) => propre(t.replace(/^[^:]*:\s*:?\s*/, ''));
const fmtN = (n) => Math.round(Number(n) || 0).toLocaleString('fr-FR').replace(/\s/g, ' ');

/**
 * Montant d’une cellule et, s’il y a lieu, l’anomalie relevée : groupes de chiffres irréguliers
 * (« 100 000 00 »), centimes, formule en erreur (#REF!), texte illisible.
 */
function lireMontant(v) {
  if (v === null || v === undefined || v === '') return { valeur: 0, vide: true };
  if (typeof v === 'object' && !(v instanceof Date) && !v.richText) {
    if (v.error) return { valeur: 0, anomalie: `valeur en erreur (${v.error})`, gravite: 'ERREUR' };
    if ('formula' in v || 'sharedFormula' in v || 'result' in v) {
      const r = v.result;
      if (/#REF!/.test(String(v.formula || '')) || (r && typeof r === 'object' && r.error)) return { valeur: 0, anomalie: 'formule en erreur (#REF!) : total à recalculer', gravite: 'ERREUR', formule: true };
      // Total calculé par formule : ses centimes viennent des lignes, déjà signalées
      const x = lireMontant(r === undefined ? 0 : r);
      return { ...x, anomalie: x.gravite === 'ALERTE' ? null : x.anomalie, formule: true };
    }
  }
  if (typeof v === 'number') {
    const valeur = Math.max(0, Math.round(v * 100) / 100);
    return { valeur, anomalie: valeur % 1 !== 0 ? `montant avec centimes (${String(v)}) : vérifier l’arrondi` : null, gravite: 'ALERTE' };
  }
  const t = propre(v);
  const brut = t.replace(/\s*(FC|CDF)\.?$/i, '').trim();
  const valeur = montant(brut);
  if (!/\d/.test(brut)) return { valeur: 0, anomalie: `montant illisible « ${t} »`, gravite: 'ERREUR' };
  if (/^\d{1,3}(\s+\d+)+(,\d+)?$/.test(brut.replace(/[  ]/g, ' ')) && brut.replace(/,\d+$/, '').split(/[\s  ]+/).slice(1).some((g) => g.length !== 3)) {
    return { valeur, anomalie: `montant mal saisi « ${t} » : lu comme ${fmtN(valeur)} CDF`, gravite: 'ERREUR' };
  }
  const cent = brut.match(/,(\d{1,2})$/);
  if (cent && Number(cent[1]) !== 0) return { valeur, anomalie: `montant avec centimes (« ${t} ») : vérifier l’arrondi`, gravite: 'ALERTE' };
  return { valeur };
}

/** Analyse d’une feuille au format PTBA ; null si la feuille n’a pas ce format. */
function analyserFeuille(ws) {
  let entete = null;
  const cols = {};
  for (let r = 1; r <= Math.min(ws.rowCount, 30) && !entete; r += 1) {
    ws.getRow(r).eachCell({ includeEmpty: false }, (c, i) => {
      if (!entete && /activit[ée]s?\s+principales?/i.test(propre(c.value))) entete = r;
    });
  }
  if (!entete) return null;
  ws.getRow(entete).eachCell({ includeEmpty: false }, (c, i) => {
    const t = propre(c.value).toLowerCase();
    if (/^n°|^no$|^n$/.test(t) && !cols.numero) cols.numero = i;
    else if (/activit/.test(t) && !cols.activite) cols.activite = i;
    else if (/^t[âa]ches?/.test(t) && !cols.taches) cols.taches = i;
    else if (/^co[ûu]t/.test(t) && !cols.cout) cols.cout = i;
    else if (/structure/.test(t) && !cols.structure) cols.structure = i;
    else if (/r[ée]sultat/.test(t) && !cols.resultats) cols.resultats = i;
    else if (/indicateur/.test(t) && !cols.indicateur) cols.indicateur = i;
    else if (/v[ée]rification/.test(t) && !cols.verification) cols.verification = i;
    else if (/financement/.test(t) && !cols.financement) cols.financement = i;
  });
  if (!cols.activite || !cols.cout) return null;
  const moisCols = Array.from({ length: 12 }, (_, k) => cols.cout + 1 + k);
  // En-tête de la feuille : programme, objectif global
  const feuille = { programme: '', objectif_global: '', ministere: '', objectifs: [], anomalies: [], vue: 'STANDARD' };
  for (let r = 1; r < entete; r += 1) {
    const t = propre(ws.getRow(r).getCell(cols.numero || 1).value) || propre(ws.getRow(r).getCell(1).value) || propre(ws.getRow(r).getCell(2).value);
    if (/^programme\s*:/i.test(t)) feuille.programme = apres(t);
    if (/^minist[eè]re\s*:/i.test(t)) feuille.ministere = apres(t);
    if (/^objectif global/i.test(t)) feuille.objectif_global = apres(t);
  }
  // Les trois lignes d’en-tête (libellés, trimestres, mois) précèdent les données.
  let debut = entete + 1;
  while (debut <= entete + 3) {
    const c = propre(ws.getRow(debut).getCell(cols.cout + 1).value);
    if (/^(t1|j)$/i.test(c) || /activit/i.test(propre(ws.getRow(debut).getCell(cols.activite).value))) debut += 1; else break;
  }
  let courant = null;
  let vides = 0;
  for (let r = debut; r <= ws.rowCount && vides < 8; r += 1) {
    const row = ws.getRow(r);
    const premier = [cols.numero, cols.activite, 1, 2].filter(Boolean).map((i) => propre(row.getCell(i).value)).find(Boolean) || '';
    if (/^objectif sp[ée]cifique/i.test(premier)) {
      courant = { libelle: apres(premier), lignes: [] };
      feuille.objectifs.push(courant);
      vides = 0;
      continue;
    }
    const activite = propre(row.getCell(cols.activite).value);
    if (!activite) { vides += 1; continue; }
    // Sous-totaux du modèle (« S/TOTAL ») ignorés ; le total général clôt la feuille.
    const libelles = [activite, premier, cols.taches ? propre(row.getCell(cols.taches).value) : ''];
    if (libelles.some((t) => /^(s\s*\/\s*|sous[-\s]?)total/i.test(t))) continue;
    if (libelles.some((t) => /^total/i.test(t))) break;
    vides = 0;
    if (!courant) { courant = { libelle: '', lignes: [] }; feuille.objectifs.push(courant); }
    const m = lireMontant(row.getCell(cols.cout).value);
    if (m.anomalie) feuille.anomalies.push({ gravite: m.gravite, cellule: row.getCell(cols.cout).address, message: `${activite.slice(0, 60)} — ${m.anomalie}` });
    courant.lignes.push({
      numero: cols.numero ? propre(row.getCell(cols.numero).value).slice(0, 20) || null : null,
      activite,
      taches: cols.taches ? texte(row.getCell(cols.taches).value).trim() || null : null,
      cout: m.valeur,
      mois: moisCols.map((c, k) => (cochee(row.getCell(c)) ? k + 1 : null)).filter(Boolean),
      structure_responsable: cols.structure ? propre(row.getCell(cols.structure).value).slice(0, 200) || null : null,
      resultats_attendus: cols.resultats ? propre(row.getCell(cols.resultats).value) || null : null,
      indicateur: cols.indicateur ? propre(row.getCell(cols.indicateur).value) || null : null,
      source_verification: cols.verification ? propre(row.getCell(cols.verification).value) || null : null,
      source_financement: cols.financement ? propre(row.getCell(cols.financement).value).slice(0, 200) || null : null,
    });
  }
  feuille.objectifs = feuille.objectifs.filter((o) => o.lignes.length);
  return feuille.objectifs.length ? feuille : null;
}

const NIVEAU = [
  ['ministere', /^minist[eè]re\b/i], ['programme', /^programme\b/i], ['service', /^inti?t?ul[ée]/i],
  ['action', /^action\s*\d*\s*:/i], ['activite', /^activit[ée]\s*\d*[^:]*:/i], ['tache', /^t[âa]che\s*[\d.\s]*:/i],
];
const libelleNiveau = (t) => propre(t.replace(/^[^:]*:\s*/, ''));

/**
 * Feuille en vue budgétaire détaillée ; null si la feuille n’a pas ce format. Chaque tâche devient
 * une ligne du PTBA (activité, tâche, coût = somme des lignes de dépense, mois = union) ; chaque
 * action devient un objectif.
 */
function analyserDetaillee(ws) {
  let entete = null; const cols = {};
  for (let r = 1; r <= Math.min(ws.rowCount, 15) && !entete; r += 1) {
    // Cellules fusionnées : seule la première compte (les suivantes répètent sa valeur)
    const t = []; ws.getRow(r).eachCell({ includeEmpty: false }, (c, i) => { if (!(c.isMerged && c.master !== c)) t.push([i, propre(c.value).toLowerCase()]); });
    if (t.some(([, x]) => /^d[ée]signation/.test(x)) && t.some(([, x]) => /nature [ée]conomique/.test(x))) {
      entete = r;
      const regles = [['designation', /^d[ée]signation/], ['structure', /structure/], ['nature', /nature [ée]conomique/], ['section', /section|chapitre/],
        ['unite', /unit[ée]/], ['mois1', /chronogramme/], ['cout', /co[ûu]t/], ['lieu', /lieu/], ['mode', /mode de gestion/]];
      for (const [i, x] of t) {
        const regle = regles.find(([k, re]) => !cols[k] && re.test(x));
        if (regle) cols[regle[0]] = i;
      }
    }
  }
  if (!entete || !cols.cout) return null;
  // Deuxième ligne d’en-tête : numéros des mois (1 à 12), « Coût », « Source »
  const sous = ws.getRow(entete + 1);
  sous.eachCell({ includeEmpty: false }, (c, i) => {
    if (c.isMerged && c.master !== c) return;
    const x = propre(c.value).toLowerCase();
    if (x === '1' && !cols.mois1) cols.mois1 = i;
    if (/^source/.test(x) && !cols.source) cols.source = i;
  });
  const moisCols = cols.mois1 ? Array.from({ length: 12 }, (_, k) => cols.mois1 + k) : [];
  const feuille = { programme: '', objectif_global: '', ministere: '', service_libelle: '', objectifs: [], anomalies: [], vue: 'DETAILLEE' };
  let action = null; let activite = ''; let tache = null; let n = 0;
  const nouvelleTache = (libelle, numero) => {
    if (!action) { action = { libelle: '', lignes: [] }; feuille.objectifs.push(action); }
    n += 1;
    tache = { numero: numero || String(n), activite: activite || libelle, taches: libelle, cout: 0, mois: [], structure_responsable: null, resultats_attendus: null, indicateur: null, source_verification: null, source_financement: null, details: [], declare: null };
    action.lignes.push(tache);
  };
  // Cellule fusionnée verticalement (en-têtes) : seule la première compte
  const valeur = (c) => (c.isMerged && c.master !== c ? null : c.value);
  const ajouter = (r, row) => {
    const designation = propre(valeur(row.getCell(cols.designation)));
    const cell = row.getCell(cols.cout);
    const m = lireMontant(valeur(cell));
    if (m.anomalie) feuille.anomalies.push({ gravite: m.gravite, cellule: cell.address, message: `${designation.slice(0, 60) || 'Ligne sans désignation'} — ${m.anomalie}` });
    if (!designation) {
      if (!m.vide && m.valeur) feuille.anomalies.push({ gravite: 'ERREUR', cellule: cell.address, message: `Montant de ${fmtN(m.valeur)} CDF sans désignation : non repris.` });
      return;
    }
    if (!tache) nouvelleTache(activite || designation, null);
    const val = (c) => (c ? propre(valeur(row.getCell(c))).slice(0, 300) || null : null);
    tache.details.push({
      designation: designation.slice(0, 2000), structure_destinataire: val(cols.structure), nature_economique: val(cols.nature), section_chapitre: val(cols.section),
      unite_physique: val(cols.unite), mois: moisCols.map((c, k) => (cochee(row.getCell(c)) ? k + 1 : null)).filter(Boolean),
      cout: m.valeur, source: val(cols.source), lieu: val(cols.lieu), mode_gestion: val(cols.mode), ligne: r,
    });
  };
  for (let r = entete + 2; r <= ws.rowCount; r += 1) {
    const row = ws.getRow(r);
    const t = propre(valeur(row.getCell(cols.designation)));
    const niveau = NIVEAU.find(([, re]) => re.test(t));
    if (/^total\s+g[ée]n[ée]ral/i.test(t)) continue;
    if (/^(s\s*\/\s*)?total/i.test(t)) {
      // Total déclaré d’une tâche : comparé à la somme de ses lignes
      const m = lireMontant(valeur(row.getCell(cols.cout)));
      if (tache && !m.vide && m.valeur && Math.abs(m.valeur - tache.details.reduce((x, d) => x + d.cout, 0)) > 0.5) {
        feuille.anomalies.push({ gravite: 'ALERTE', cellule: row.getCell(cols.cout).address, message: `${t} : ${fmtN(m.valeur)} CDF déclarés, ${fmtN(tache.details.reduce((x, d) => x + d.cout, 0))} CDF calculés.` });
      }
      continue;
    }
    if (niveau) {
      const [cle] = niveau;
      if (cle === 'ministere') feuille.ministere = /:/.test(t) ? libelleNiveau(t) : propre(t.replace(/^minist[eè]re\s+(de\s+l[’']|de\s+la\s+|des\s+|du\s+|de\s+)?/i, ''));
      else if (cle === 'programme') feuille.programme = libelleNiveau(t);
      else if (cle === 'service') { const x = libelleNiveau(t); if (!feuille.service_libelle && /[a-z]{3}/i.test(x)) feuille.service_libelle = x; }
      else if (cle === 'action') { action = { libelle: t, lignes: [] }; feuille.objectifs.push(action); activite = ''; tache = null; }
      else if (cle === 'activite') { activite = t; tache = null; }
      else if (cle === 'tache') {
        nouvelleTache(t, (t.match(/^t[âa]che\s*([\d.]+)/i) || [])[1]?.replace(/\.$/, ''));
        const m = lireMontant(valeur(row.getCell(cols.cout)));
        if (m.anomalie) feuille.anomalies.push({ gravite: m.gravite, cellule: row.getCell(cols.cout).address, message: `${t.slice(0, 60)} — ${m.anomalie}` });
        else if (!m.vide && m.formule) tache.declare = { valeur: m.valeur, cellule: row.getCell(cols.cout).address };
      }
      continue;
    }
    if (t || propre(valeur(row.getCell(cols.cout)))) ajouter(r, row);
  }
  for (const o of feuille.objectifs) {
    for (const l of o.lignes) {
      l.cout = Math.round(l.details.reduce((x, d) => x + d.cout, 0) * 100) / 100;
      l.mois = [...new Set(l.details.flatMap((d) => d.mois))].sort((a, b) => a - b);
      const freq = (k) => Object.entries(l.details.reduce((acc, d) => (d[k] ? { ...acc, [d[k]]: (acc[d[k]] || 0) + 1 } : acc), {})).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
      l.structure_responsable = freq('structure_destinataire')?.slice(0, 200) || null;
      l.source_financement = (freq('source') || freq('mode_gestion'))?.slice(0, 200) || null;
      if (l.declare && Math.abs(l.declare.valeur - l.cout) > 0.5) feuille.anomalies.push({ gravite: 'ALERTE', cellule: l.declare.cellule, message: `${l.taches.slice(0, 60)} : total de la tâche ${fmtN(l.declare.valeur)} CDF, somme des lignes ${fmtN(l.cout)} CDF.` });
      if (!l.details.length) feuille.anomalies.push({ gravite: 'INFO', cellule: null, message: `${l.taches.slice(0, 80)} : aucune ligne de dépense.` });
      delete l.declare;
    }
    o.lignes = o.lignes.filter((l) => l.details.length || l.cout);
  }
  feuille.objectifs = feuille.objectifs.filter((o) => o.lignes.length);
  return feuille.objectifs.length ? feuille : null;
}

const normaliser = (t) => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();

/**
 * Analyse d’un classeur : une entrée par feuille au format PTBA (vue standard ou détaillée), avec son
 * rapport d’anomalies et, le cas échéant, la raison pour laquelle elle semble relever d’un autre
 * ministère (elle n’est alors pas proposée à l’import par défaut). `contexte` : ministère en vigueur
 * et services connus (sigles et libellés).
 */
async function analyser(source, contexte = {}) {
  const wb = new ExcelJS.Workbook();
  if (Buffer.isBuffer(source)) await wb.xlsx.load(source); else await wb.xlsx.readFile(source);
  const notreMinistere = normaliser(contexte.ministere || identite.courante().ministere).replace(/^MINISTERE (DE L |DE LA |DES |DU |DE )?/, '');
  const services = (contexte.services || []).flatMap((x) => [normaliser(x.sigle), normaliser(x.libelle)]).filter(Boolean);
  const feuilles = [];
  const ignorees = [];
  wb.eachSheet((ws) => {
    const f = analyserFeuille(ws) || analyserDetaillee(ws);
    if (!f) { ignorees.push(ws.name); return; }
    const sigle = ws.name.replace(/^\s*(ptab|ptba)\s+/i, '').trim().toUpperCase().slice(0, 30);
    const lignes = f.objectifs.flatMap((o) => o.lignes);
    const cout = lignes.reduce((s, l) => s + l.cout, 0);
    // Contrôles de la feuille
    if (!f.programme) f.anomalies.push({ gravite: 'ALERTE', cellule: null, message: 'Programme non renseigné : à choisir à l’import.' });
    const couts = (f.vue === 'DETAILLEE' ? lignes.flatMap((l) => l.details) : lignes).map((l) => l.cout).filter((x) => x > 0).sort((a, b) => a - b);
    const mediane = couts.length ? couts[Math.floor(couts.length / 2)] : 0;
    for (const l of f.vue === 'DETAILLEE' ? lignes.flatMap((x) => x.details.map((d) => ({ ...d, libelle: d.designation }))) : lignes.map((x) => ({ ...x, libelle: x.activite }))) {
      if (l.cout >= 1e10 && mediane && l.cout >= 50 * mediane) {
        f.anomalies.push({ gravite: 'ALERTE', cellule: l.ligne ? `${l.ligne}` : null, message: `${l.libelle.slice(0, 60)} : ${fmtN(l.cout)} CDF, montant exceptionnel (${Math.round(l.cout / mediane)} fois le montant médian de la feuille) à vérifier.` });
      }
    }
    const sansCout = lignes.filter((l) => !l.cout).length;
    if (sansCout) f.anomalies.push({ gravite: 'INFO', cellule: null, message: `${sansCout} ligne(s) sans coût.` });
    // Feuille d’un autre ministère ?
    const raisons = [];
    let minis = normaliser(f.ministere).replace(/^MINISTERE (DE L |DE LA |DES |DU |DE )?/, '');
    if (f.ministere && minis.replace(/^(DE|DU|DES|LA|L)$/, '').length < 4) {
      f.anomalies.push({ gravite: 'INFO', cellule: null, message: `Intitulé du ministère incomplet (« ${f.ministere} »).` });
      minis = '';
    }
    if (minis && notreMinistere && !minis.includes(notreMinistere) && !notreMinistere.includes(minis)) raisons.push(`ministère déclaré : « ${f.ministere} »`);
    const structures = lignes.map((l) => normaliser(l.structure_responsable)).filter(Boolean);
    const connues = structures.filter((x) => services.some((sv) => sv.length > 1 && (x === sv || x.split(' ').includes(sv) || x.includes(sv))));
    if (structures.length >= 3 && services.length && connues.length / structures.length < 0.2) raisons.push('aucune structure responsable ne figure parmi les services du Secrétariat Général');
    const masquee = ws.state !== 'visible';
    if (masquee) f.anomalies.push({ gravite: 'INFO', cellule: null, message: 'Feuille masquée dans le classeur.' });
    for (const o of f.objectifs) for (const l of o.lignes) for (const d of l.details || []) delete d.ligne;
    feuilles.push({
      feuille: ws.name, sigle, ...f, masquee, autre_ministere: raisons.length ? raisons.join(' ; ') : null,
      nb_lignes: lignes.length, nb_details: lignes.reduce((x, l) => x + (l.details ? l.details.length : 0), 0), cout_total: Math.round(cout * 100) / 100,
    });
  });
  return { feuilles, ignorees };
}

/** Coût prévu par trimestre : le coût d’une ligne est réparti sur ses mois cochés (sinon à parts égales). */
function coutParTrimestre(lignes) {
  const t = [0, 0, 0, 0];
  for (const l of lignes) {
    const mois = l.mois && l.mois.length ? l.mois : [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
    const part = Number(l.cout) / mois.length;
    for (const m of mois) t[Math.floor((m - 1) / 3)] += part;
  }
  return t.map((x) => Math.round(x));
}

async function charger(id) {
  const p = await db('ptba as p').join('exercices as e', 'e.id', 'p.exercice_id').join('plan_services as s', 's.id', 'p.service_id')
    .leftJoin('plan_programmes as g', 'g.id', 'p.programme_id').where('p.id', id)
    .first('p.*', 'e.annee', 's.sigle as service_sigle', 's.libelle as service_libelle', 'g.code as programme_code', 'g.libelle as programme_libelle');
  if (!p) return null;
  const objectifs = await db('ptba_objectifs').where({ ptba_id: id }).orderBy(['ordre', 'id']);
  const lignes = await db('ptba_lignes as l').leftJoin('plan_actions as a', 'a.id', 'l.action_id').where('l.ptba_id', id)
    .orderBy(['l.ordre', 'l.id']).select('l.*', 'a.code as action_code', 'a.libelle as action_libelle');
  const suivis = lignes.length ? await db('ptba_suivi').whereIn('ligne_id', lignes.map((l) => l.id)) : [];
  const details = await db('ptba_details').where({ ptba_id: id }).orderBy(['ligne_id', 'ordre']);
  for (const l of lignes) {
    l.cout = Number(l.cout);
    l.details = details.filter((d) => d.ligne_id === l.id).map(({ ptba_id: _p, ...d }) => ({ ...d, cout: Number(d.cout) }));
    l.suivi = suivis.filter((s) => s.ligne_id === l.id).map((s) => ({ ...s, montant_engage: Number(s.montant_engage), montant_decaisse: Number(s.montant_decaisse) })).sort((a, b) => a.trimestre - b.trimestre);
  }
  return { ...p, objectifs, lignes };
}

/** Exécution d’un ensemble de lignes : dernier suivi trimestriel de chaque ligne. */
function execution(lignes) {
  const cout = lignes.reduce((s, l) => s + Number(l.cout), 0);
  let engage = 0; let decaisse = 0; let physique = 0; let suivies = 0;
  for (const l of lignes) {
    const dernier = (l.suivi || []).reduce((d, s) => (!d || s.trimestre > d.trimestre ? s : d), null);
    if (dernier) { engage += Number(dernier.montant_engage); decaisse += Number(dernier.montant_decaisse); suivies += 1; }
    physique += (dernier ? dernier.taux_physique : 0) * (cout ? Number(l.cout) : 1);
  }
  return {
    cout, engage, decaisse, lignes: lignes.length, suivies,
    tauxPhysique: lignes.length ? Math.round(physique / (cout || lignes.length)) : 0,
    tauxFinancier: cout ? Math.round((decaisse / cout) * 1000) / 10 : 0,
  };
}

// ─── Export au format du Ministère ──────────────────────────────────────────
const bord = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };

function feuillePtba(wb, p, nomFeuille) {
  const ws = wb.addWorksheet(nomFeuille.slice(0, 31), { pageSetup: { orientation: 'landscape', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
  const N = 21;
  ws.columns = [
    { width: 5 }, { width: 34 }, { width: 40 }, { width: 16 },
    ...Array.from({ length: 12 }, () => ({ width: 3.2 })),
    { width: 16 }, { width: 28 }, { width: 26 }, { width: 22 }, { width: 16 },
  ];
  const titre = (r, t, opts = {}) => {
    ws.mergeCells(r, 1, r, N);
    const c = ws.getCell(r, 1);
    c.value = t;
    c.font = { bold: true, size: opts.size || 11, color: opts.couleur ? { argb: opts.couleur } : undefined };
    c.alignment = { horizontal: opts.centre ? 'center' : 'left', vertical: 'middle', wrapText: true };
  };
  // En-tête officiel de la Direction au-dessus du titre du modèle (modèle imposé : structure inchangée)
  const o = entete.excelEntete(wb, ws, identite.courante(), N) - 1;
  titre(o + 1, 'Plan de Travail Annuel Budgétisé', { size: 14, centre: true, couleur: BLEU });
  titre(o + 2, 'Ministère : ÉCONOMIE NUMÉRIQUE');
  titre(o + 3, 'Secrétariat : SECRÉTARIAT GÉNÉRAL AU NUMÉRIQUE');
  titre(o + 4, `Programme : ${p.programme_libelle || '—'}`);
  titre(o + 5, `Objectif global : ${p.objectif_global || '—'}`);
  ws.getRow(o + 5).height = 30;
  titre(o + 6, `Exercice ${p.annee} — ${p.service_sigle} (${p.service_libelle}) — ${p.reference}`);
  // En-têtes sur trois lignes, comme le modèle
  const h = o + 7;
  const fixes = [[1, 'N°'], [2, 'Activités principales'], [3, 'Tâches'], [4, 'Coût en CDF'], [17, 'Structures responsables'], [18, 'Résultats attendus'], [19, 'Indicateurs de réalisation'], [20, 'Source / moyen de vérification'], [21, 'Source de financement']];
  for (const [c, t] of fixes) { ws.mergeCells(h, c, h + 2, c); ws.getCell(h, c).value = t; }
  ws.mergeCells(h, 5, h, 16); ws.getCell(h, 5).value = 'Chronogramme';
  for (let k = 0; k < 4; k += 1) { ws.mergeCells(h + 1, 5 + k * 3, h + 1, 7 + k * 3); ws.getCell(h + 1, 5 + k * 3).value = `T${k + 1}`; }
  MOIS.forEach((m, k) => { ws.getCell(h + 2, 5 + k).value = m; });
  for (let r = h; r <= h + 2; r += 1) {
    for (let c = 1; c <= N; c += 1) {
      const cell = ws.getCell(r, c);
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 9 };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BLEU } };
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      cell.border = bord;
    }
  }
  let r = h + 3;
  let n = 0;
  const groupes = [...p.objectifs.map((o) => ({ o, lignes: p.lignes.filter((l) => l.objectif_id === o.id) })), { o: null, lignes: p.lignes.filter((l) => !l.objectif_id) }].filter((g) => g.lignes.length);
  groupes.forEach((g, gi) => {
    if (g.o) {
      ws.mergeCells(r, 1, r, N);
      const c = ws.getCell(r, 1);
      c.value = `Objectif spécifique ${gi + 1} : ${g.o.libelle}`;
      c.font = { bold: true }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDCE6F2' } }; c.border = bord;
      c.alignment = { wrapText: true, vertical: 'middle' };
      r += 1;
    }
    for (const l of g.lignes) {
      n += 1;
      const row = ws.getRow(r);
      row.values = [l.numero || n, l.activite, l.taches || '', Number(l.cout), ...Array(12).fill(''), l.structure_responsable || '', l.resultats_attendus || '', l.indicateur || '', l.source_verification || '', l.source_financement || ''];
      for (let c = 1; c <= N; c += 1) {
        const cell = row.getCell(c);
        cell.border = bord;
        cell.alignment = { vertical: 'top', wrapText: c !== 4 && (c < 5 || c > 16), horizontal: c === 4 ? 'right' : undefined };
        cell.font = { size: 9 };
      }
      row.getCell(4).numFmt = '#,##0';
      for (const m of l.mois || []) row.getCell(4 + m).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: JAUNE } };
      r += 1;
    }
  });
  const total = ws.getRow(r);
  ws.mergeCells(r, 1, r, 3);
  total.getCell(1).value = 'TOTAL';
  total.getCell(4).value = p.lignes.reduce((s, l) => s + Number(l.cout), 0);
  total.getCell(4).numFmt = '#,##0';
  for (let c = 1; c <= N; c += 1) { total.getCell(c).font = { bold: true }; total.getCell(c).border = bord; }
  ws.views = [{ state: 'frozen', ySplit: h + 2 }];
  return ws;
}

/**
 * Feuille en vue budgétaire détaillée (format des feuilles DDCN et DCS) : Désignation, Structure
 * destinataire, Nature économique, Section/Chapitre, Unité physique, Chronogramme 1 à 12, Coût,
 * Source, Lieu d’exécution, Mode de gestion ; hiérarchie Ministère > Programme > service > Action
 * > Activité > Tâche (total en formule) > lignes de dépense.
 */
function feuilleDetaillee(wb, p, nomFeuille) {
  const ws = wb.addWorksheet(nomFeuille.slice(0, 31), { pageSetup: { orientation: 'landscape', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
  const N = 23; const C = { des: 1, str: 4, nat: 5, sec: 6, uni: 7, m1: 8, cout: 20, src: 21, lieu: 22, mode: 23 };
  ws.columns = [{ width: 30 }, { width: 8 }, { width: 8 }, { width: 18 }, { width: 22 }, { width: 11 }, { width: 11 }, ...Array.from({ length: 12 }, () => ({ width: 3.2 })), { width: 16 }, { width: 9 }, { width: 18 }, { width: 16 }];
  const o = entete.excelEntete(wb, ws, identite.courante(), N) - 1;
  const ident = identite.courante();
  const h = o + 1;
  const fixes = [[C.des, 'Désignation'], [C.str, 'Structure destinataire'], [C.nat, 'Nature économique (titre et littera)'], [C.sec, 'Section/Chapitre'], [C.uni, 'Unité physique'], [C.lieu, 'Lieu d’exécution'], [C.mode, 'Mode de gestion']];
  ws.mergeCells(h, 1, h + 1, 3); ws.getCell(h, 1).value = 'Désignation';
  for (const [c, t] of fixes.slice(1)) { ws.mergeCells(h, c, h + 1, c); ws.getCell(h, c).value = t; }
  ws.mergeCells(h, C.m1, h, C.m1 + 11); ws.getCell(h, C.m1).value = 'Chronogramme';
  for (let k = 0; k < 12; k += 1) ws.getCell(h + 1, C.m1 + k).value = k + 1;
  ws.mergeCells(h, C.cout, h, C.src); ws.getCell(h, C.cout).value = 'Coût en FC';
  ws.getCell(h + 1, C.cout).value = 'Coût'; ws.getCell(h + 1, C.src).value = 'Source';
  for (let r = h; r <= h + 1; r += 1) {
    for (let c = 1; c <= N; c += 1) {
      const cell = ws.getCell(r, c);
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 9 };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BLEU } };
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      cell.border = bord;
    }
  }
  let r = h + 2;
  const niveau = (texteNiveau, couleur, cout) => {
    ws.mergeCells(r, 1, r, C.cout - 1);
    const c = ws.getCell(r, 1);
    c.value = texteNiveau; c.font = { bold: true, size: 9.5 }; c.alignment = { wrapText: true, vertical: 'middle' };
    if (couleur) for (let k = 1; k <= N; k += 1) ws.getCell(r, k).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: couleur } };
    for (let k = 1; k <= N; k += 1) ws.getCell(r, k).border = bord;
    if (cout) { ws.getCell(r, C.cout).value = cout; ws.getCell(r, C.cout).numFmt = '#,##0'; ws.getCell(r, C.cout).font = { bold: true, size: 9.5 }; }
    r += 1;
    return r - 1;
  };
  niveau(String(ident.ministere).toUpperCase(), 'FFDCE6F2');
  niveau(`PROGRAMME : ${p.programme_libelle || '—'}`, 'FFDCE6F2');
  niveau(`Intitulé Ministère ou Service : ${p.service_libelle} (${p.service_sigle})`, null);
  const lignesTache = [];
  const groupes = [...p.objectifs.map((ob) => ({ ob, lignes: p.lignes.filter((l) => l.objectif_id === ob.id) })), { ob: null, lignes: p.lignes.filter((l) => !l.objectif_id) }].filter((g) => g.lignes.length);
  for (const g of groupes) {
    if (g.ob) niveau(g.ob.libelle, 'FFEEF3F8');
    let activite = null;
    for (const l of g.lignes) {
      if (l.activite !== activite) { activite = l.activite; niveau(activite, null); }
      const rt = niveau(l.taches || l.activite, 'FFFAFAFA');
      const details = l.details && l.details.length ? l.details : [{ designation: l.taches || l.activite, structure_destinataire: l.structure_responsable, mois: l.mois, cout: l.cout, source: l.source_financement }];
      const d0 = r;
      for (const d of details) {
        const row = ws.getRow(r);
        ws.mergeCells(r, 1, r, 3);
        row.getCell(C.des).value = d.designation; row.getCell(C.str).value = d.structure_destinataire || ''; row.getCell(C.nat).value = d.nature_economique || '';
        row.getCell(C.sec).value = d.section_chapitre || ''; row.getCell(C.uni).value = d.unite_physique || ''; row.getCell(C.cout).value = Number(d.cout);
        row.getCell(C.src).value = d.source || ''; row.getCell(C.lieu).value = d.lieu || ''; row.getCell(C.mode).value = d.mode_gestion || '';
        for (let c = 1; c <= N; c += 1) { const cell = row.getCell(c); cell.border = bord; cell.font = { size: 9 }; cell.alignment = { vertical: 'top', wrapText: c < C.m1 || c > C.cout }; }
        row.getCell(C.cout).numFmt = '#,##0';
        for (const m of d.mois || []) row.getCell(C.m1 + m - 1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: JAUNE } };
        r += 1;
      }
      const lettre = ws.getColumn(C.cout).letter;
      ws.getCell(rt, C.cout).value = { formula: `SUM(${lettre}${d0}:${lettre}${r - 1})`, result: details.reduce((x, d) => x + Number(d.cout), 0) };
      ws.getCell(rt, C.cout).numFmt = '#,##0'; ws.getCell(rt, C.cout).font = { bold: true, size: 9 };
      lignesTache.push(rt);
    }
  }
  const total = ws.getRow(r);
  ws.mergeCells(r, 1, r, C.cout - 1);
  total.getCell(1).value = 'TOTAL GÉNÉRAL';
  const lettre = ws.getColumn(C.cout).letter;
  total.getCell(C.cout).value = { formula: lignesTache.length ? lignesTache.map((x) => `${lettre}${x}`).join('+') : '0', result: p.lignes.reduce((s2, l) => s2 + Number(l.cout), 0) };
  total.getCell(C.cout).numFmt = '#,##0';
  for (let c = 1; c <= N; c += 1) { total.getCell(c).font = { bold: true }; total.getCell(c).border = bord; }
  ws.views = [{ state: 'frozen', ySplit: h + 1 }];
  return ws;
}

async function classeur(ptbaIds, { synthese = false } = {}) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'SIG-DEP';
  const tous = [];
  for (const id of ptbaIds) tous.push(await charger(id));
  if (synthese && tous.length) {
    const ws = wb.addWorksheet('Synthèse', { pageSetup: { orientation: 'landscape', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
    const cols = [['Service', 14], ['Intitulé', 40], ['Programme', 30], ['Statut', 12], ['Lignes', 8], ['Coût total (CDF)', 20], ['T1', 16], ['T2', 16], ['T3', 16], ['T4', 16]];
    cols.forEach(([, w], i) => { ws.getColumn(i + 1).width = w; });
    const ligne = entete.excelEntete(wb, ws, identite.courante(), cols.length);
    ws.getRow(ligne).values = cols.map(([t]) => t);
    ws.getRow(ligne).eachCell((c) => { c.font = { bold: true, color: { argb: 'FFFFFFFF' } }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BLEU } }; });
    const cumul = [0, 0, 0, 0, 0];
    for (const p of tous) {
      const t = coutParTrimestre(p.lignes);
      const cout = p.lignes.reduce((x, l) => x + Number(l.cout), 0);
      [cout, ...t].forEach((v, i) => { cumul[i] += v; });
      ws.addRow([p.service_sigle, p.service_libelle, p.programme_libelle || '', p.statut, p.lignes.length, cout, ...t]);
    }
    const tot = ws.addRow(['TOTAL', '', '', '', tous.reduce((x, p) => x + p.lignes.length, 0), ...cumul]);
    tot.font = { bold: true };
    for (const c of [6, 7, 8, 9, 10]) ws.getColumn(c).numFmt = '#,##0';
    ws.getColumn(5).numFmt = '0';
  }
  for (const p of tous) (p.vue === 'DETAILLEE' ? feuilleDetaillee : feuillePtba)(wb, p, p.vue === 'DETAILLEE' ? p.service_sigle : `PTBA ${p.service_sigle}`);
  return wb;
}

module.exports = { analyser, analyserFeuille, analyserDetaillee, lireMontant, montant, coutParTrimestre, charger, execution, classeur, MOIS };

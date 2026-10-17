'use strict';
/**
 * Collecte auprès des services du Secrétariat Général (cahier, § 36) : modèles Excel et retours.
 *  - modèle par service et par objet : en-tête officiel, service et exercice pré-remplis, listes
 *    déroulantes tirées des référentiels, feuille protégée (seules les cellules de saisie sont
 *    ouvertes), feuille cachée d’identification (campagne, service, objet, version du modèle) ;
 *  - lecture d’un retour : identification, structure, champs obligatoires, codes, totaux, doublons,
 *    rapport d’anomalies (ERREUR bloque l’intégration, ALERTE à apprécier) ;
 *  - intégration : PTBA (brouillon du service), cadre de performance (réalisations et cibles),
 *    dépenses d’investissement (projets de la banque de projets créés ou mis à jour).
 */
const ExcelJS = require('exceljs');
const db = require('../db/knex');
const officiel = require('./entete');
const { montant: lireMontantTexte } = require('./ptba');

const VERSION_MODELE = 1;
// Protection contre les modifications de structure involontaires (le contrôle à l’import fait foi).
const MOT_DE_PASSE = 'SIG-DEP-modele';
const OBJETS = {
  PTBA: { libelle: 'Plan de travail annuel budgétisé (PTBA)', bureau: 'programme' },
  CADRE_PERFORMANCE: { libelle: 'Cadre de performance (réalisations et cibles)', bureau: 'programme' },
  INVESTISSEMENT: { libelle: 'Dépenses d’investissement', bureau: 'programme' },
  PLAN_ACTIONS: { libelle: 'Plan d’actions', bureau: 'suivi', plusTard: true },
  RAPPORT_ACTIVITES: { libelle: 'Rapport d’activités', bureau: 'suivi', plusTard: true },
  FICHE_PNSD: { libelle: 'Fiche de collecte PNSD', bureau: 'suivi', plusTard: true },
};
const MATURITES = { IDEE: 'Idée', ETUDE: 'En étude', PRET: 'Prêt', EN_COURS: 'En cours', ACHEVE: 'Achevé', ABANDONNE: 'Abandonné' };
const RUBRIQUES = ['Etudes', 'Acquisition de terrains', 'Construction/réhabilitation', 'Equipements', 'Frais de mise en œuvre', 'Autres'];
const SOURCES = ['Etat', 'Partenaires', 'En négociation', 'A rechercher'];
const MOIS = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];
const LIGNES_SAISIE = { PTBA: 150, INVESTISSEMENT: 60 };

const BORD = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
const BLEU = 'FF17418A';

function texte(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') {
    if (v.richText) return v.richText.map((x) => x.text).join('');
    if (v.result !== undefined) return texte(v.result);
    if (v.text) return String(v.text);
    if (v instanceof Date) return v.toISOString().slice(0, 10);
  }
  return String(v).replace(/\s+/g, ' ').trim();
}
/** Nombre d’une cellule : null si vide, NaN si illisible. */
function nombre(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'object' && !(v instanceof Date)) {
    if (v.error) return NaN;
    if (v.result !== undefined) return nombre(v.result);
    if (v.richText) return nombre(texte(v));
  }
  if (typeof v === 'number') return v;
  const t = texte(v);
  if (!t) return null;
  if (!/\d/.test(t)) return NaN;
  const n = lireMontantTexte(t);
  return /^-/.test(t) ? -n : n;
}

// ─── Référentiels du modèle ─────────────────────────────────────────────────
async function referentiels(collecte, service) {
  const programme = service.programme_id ? await db('plan_programmes').where({ id: service.programme_id }).first() : null;
  const actions = programme ? await db('plan_actions').where({ programme_id: programme.id, actif: true }).orderBy('code') : [];
  const pips = await db('pip_projects').whereNot('statut', 'ARCHIVE').orderBy('code').select('id', 'code', 'intitule');
  const indicateurs = await db('plan_indicateurs as i').join('plan_objectifs as o', 'o.id', 'i.objectif_id')
    .where('i.actif', true).where('o.actif', true)
    .where((w) => (programme ? w.where('o.programme_id', programme.id) : w.whereNull('o.programme_id')))
    .orderBy(['o.ordre', 'o.id', 'i.ordre', 'i.id']).select('i.id', 'i.libelle', 'i.unite', 'o.libelle as objectif');
  const precedentes = indicateurs.length ? await db('plan_indicateur_valeurs').whereIn('indicateur_id', indicateurs.map((i) => i.id)).where({ annee: collecte.annee - 1, type: 'REALISATION' }) : [];
  for (const i of indicateurs) i.precedente = precedentes.find((v) => v.indicateur_id === i.id)?.valeur ?? null;
  return { programme, actions, pips, indicateurs };
}

/** Colonnes de saisie de chaque objet : { h: en-tête, k: clé, w: largeur, liste?: nom de la liste, requis?, n?: numérique, calc? }. */
function colonnes(objet, annee) {
  if (objet === 'PTBA') {
    return [
      { h: 'N°', k: 'numero', w: 6 }, { h: 'Objectif spécifique *', k: 'objectif', w: 30, requis: true }, { h: 'Activité *', k: 'activite', w: 34, requis: true },
      { h: 'Tâches', k: 'taches', w: 28 }, { h: 'Action budgétaire', k: 'action', w: 26, liste: 'actions' }, { h: 'Coût (CDF) *', k: 'cout', w: 15, n: true, requis: true },
      ...MOIS.map((m, i) => ({ h: m, k: `m${i + 1}`, w: 4, liste: 'coche' })),
      { h: 'Structure responsable', k: 'structure_responsable', w: 18 }, { h: 'Résultats attendus', k: 'resultats_attendus', w: 24 }, { h: 'Indicateur', k: 'indicateur', w: 22 },
      { h: 'Source de vérification', k: 'source_verification', w: 20 }, { h: 'Source de financement', k: 'source_financement', w: 18 },
    ];
  }
  if (objet === 'CADRE_PERFORMANCE') {
    return [
      { h: 'Réf.', k: 'ref', w: 7, verrou: true }, { h: 'Objectif', k: 'objectif', w: 30, verrou: true }, { h: 'Indicateur', k: 'indicateur', w: 34, verrou: true },
      { h: 'Unité', k: 'unite', w: 10, verrou: true }, { h: `Réalisation ${annee - 1}`, k: 'precedente', w: 13, verrou: true, n: true },
      { h: `Réalisation ${annee}`, k: 'realisation', w: 13, n: true }, { h: `Cible ${annee + 1}`, k: 'cible1', w: 12, n: true }, { h: `Cible ${annee + 2}`, k: 'cible2', w: 12, n: true },
      { h: `Cible ${annee + 3}`, k: 'cible3', w: 12, n: true }, { h: 'Commentaire', k: 'commentaire', w: 30 },
    ];
  }
  return [
    { h: 'N°', k: 'numero', w: 6 }, { h: 'Intitulé du projet *', k: 'intitule', w: 34, requis: true }, { h: 'Code PIP (projet existant)', k: 'code_pip', w: 18, liste: 'pips' },
    { h: 'Nature des coûts *', k: 'rubrique', w: 22, liste: 'rubriques', requis: true }, { h: 'Localisation', k: 'localisation', w: 18 },
    { h: 'Maturité', k: 'maturite', w: 12, liste: 'maturites' }, { h: 'Étude de faisabilité', k: 'etude', w: 11, liste: 'ouinon' },
    { h: `Coût ${annee} (CDF)`, k: 'montant1', w: 15, n: true }, { h: `Coût ${annee + 1} (CDF)`, k: 'montant2', w: 15, n: true }, { h: `Coût ${annee + 2} (CDF)`, k: 'montant3', w: 15, n: true },
    { h: 'Total (CDF)', k: 'total', w: 16, n: true, calc: true }, { h: 'Source de financement *', k: 'source', w: 16, liste: 'sources', requis: true }, { h: 'Observations', k: 'observations', w: 26 },
  ];
}

// ─── Génération du modèle ───────────────────────────────────────────────────
async function modele(collecte, service, cs) {
  const ref = await referentiels(collecte, service);
  const cols = colonnes(collecte.objet, collecte.annee);
  const wb = new ExcelJS.Workbook();
  wb.creator = 'SIG-DEP';
  const ws = officiel.feuilleOfficielle(wb, 'Saisie', cols.length, { largeurs: cols.map((c) => c.w), options: { pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 } } });
  const titre = (t, font) => { const r = ws.addRow([t]); ws.mergeCells(r.number, 1, r.number, Math.min(cols.length, 12)); r.getCell(1).font = font; r.getCell(1).alignment = { wrapText: true }; return r; };
  titre(`${OBJETS[collecte.objet].libelle.toUpperCase()} — EXERCICE ${collecte.annee}`, { bold: true, size: 12, color: { argb: 'FF0B3D6E' } });
  titre(`Service : ${service.sigle} — ${service.libelle}${ref.programme ? ` · Programme ${ref.programme.code} — ${ref.programme.libelle}` : ''}`, { bold: true, size: 10 });
  titre(`Campagne ${collecte.reference} · à retourner au plus tard le ${new Date(collecte.echeance).toLocaleDateString('fr-FR', { timeZone: 'Africa/Kinshasa' })} à la Direction d’Études et Planification`, { size: 9, color: { argb: 'FF444444' } });
  if (collecte.instructions) titre(collecte.instructions, { italic: true, size: 9, color: { argb: 'FF444444' } });
  titre('Remplir uniquement les cellules blanches ; ne pas ajouter, supprimer ou déplacer de colonne. Les champs marqués * sont obligatoires.', { size: 9, color: { argb: 'FF8A1C1C' } });
  // Total déclaré (contrôle des totaux à l’import)
  let celluleTotal = null;
  if (collecte.objet !== 'CADRE_PERFORMANCE') {
    const r = ws.addRow(['Total déclaré par le service (CDF) *']);
    ws.mergeCells(r.number, 1, r.number, 3);
    r.getCell(1).font = { bold: true };
    const c = r.getCell(4);
    c.numFmt = '#,##0'; c.border = BORD; c.protection = { locked: false };
    celluleTotal = c.address;
  }
  ws.addRow([]);
  const h = ws.addRow(cols.map((c) => c.h));
  h.eachCell((cell) => { cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }; cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BLEU } }; cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }; cell.border = BORD; });
  h.height = 32;
  const ligneEntete = h.number;

  // Listes (feuille cachée)
  const listes = {
    actions: ref.actions.map((a) => `${a.code} — ${a.libelle}`), coche: ['x'], pips: ref.pips.map((p) => p.code),
    rubriques: RUBRIQUES, maturites: Object.values(MATURITES), ouinon: ['Oui', 'Non'], sources: SOURCES,
  };
  const wsRef = wb.addWorksheet('Listes', { state: 'veryHidden' });
  const plages = {};
  Object.entries(listes).forEach(([nom, valeurs], i) => {
    const col = wsRef.getColumn(i + 1);
    col.values = [nom, ...valeurs];
    if (valeurs.length) plages[nom] = `Listes!$${col.letter}$2:$${col.letter}$${valeurs.length + 1}`;
  });

  // Lignes de saisie
  const lignes = collecte.objet === 'CADRE_PERFORMANCE'
    ? ref.indicateurs.map((i) => ({ ref: i.id, objectif: i.objectif, indicateur: i.libelle, unite: i.unite, precedente: i.precedente === null ? null : Number(i.precedente) }))
    : Array.from({ length: LIGNES_SAISIE[collecte.objet] }, () => ({}));
  for (const [n, l] of lignes.entries()) {
    const r = ws.addRow(cols.map((c) => (c.calc ? null : l[c.k] ?? null)));
    cols.forEach((c, i) => {
      const cell = r.getCell(i + 1);
      cell.border = BORD;
      if (c.n) cell.numFmt = '#,##0.##';
      if (c.calc) {
        const lettre = (k) => ws.getColumn(cols.findIndex((x) => x.k === k) + 1).letter;
        cell.value = { formula: `IF(COUNT(${lettre('montant1')}${r.number}:${lettre('montant3')}${r.number})=0,"",SUM(${lettre('montant1')}${r.number}:${lettre('montant3')}${r.number}))` };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEEF3F8' } };
      } else if (c.verrou) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEEF3F8' } };
        cell.alignment = { wrapText: true, vertical: 'top' };
      } else {
        cell.protection = { locked: false };
        cell.alignment = { wrapText: !c.n, vertical: 'top' };
        if (c.k === 'numero' && collecte.objet !== 'CADRE_PERFORMANCE') cell.value = n + 1;
        if (c.liste && plages[c.liste]) cell.dataValidation = { type: 'list', allowBlank: true, formulae: [plages[c.liste]], showErrorMessage: true, errorTitle: 'Valeur non prévue', error: 'Choisissez une valeur de la liste.' };
        if (c.n) cell.dataValidation = { type: 'decimal', allowBlank: true, operator: 'greaterThanOrEqual', formulae: [0], showErrorMessage: true, errorTitle: 'Nombre attendu', error: 'Saisissez un nombre positif.' };
      }
    });
  }
  ws.views = [{ state: 'frozen', ySplit: ligneEntete, xSplit: collecte.objet === 'CADRE_PERFORMANCE' ? 3 : 2 }];
  await ws.protect(MOT_DE_PASSE, { selectLockedCells: true, selectUnlockedCells: true, formatColumns: true, formatRows: true });

  // Identification du modèle (feuille cachée)
  const id = wb.addWorksheet('_sigdep', { state: 'veryHidden' });
  [['SIGDEP_COLLECTE', VERSION_MODELE], ['campagne', collecte.reference], ['service', service.sigle], ['objet', collecte.objet], ['annee', collecte.annee],
    ['ligne_entete', ligneEntete], ['cellule_total', celluleTotal], ['collecte_service', cs.id]].forEach(([k, v]) => id.addRow([k, v]));
  return Buffer.from(await wb.xlsx.writeBuffer());
}

// ─── Lecture d’un retour ────────────────────────────────────────────────────
/**
 * Lit le fichier retourné par un service et produit les lignes et le rapport d’anomalies.
 * Ne modifie rien en base.
 */
async function analyser(buffer, collecte, service) {
  const anomalies = [];
  const err = (message, cellule = null) => anomalies.push({ gravite: 'ERREUR', cellule, message });
  const alerte = (message, cellule = null) => anomalies.push({ gravite: 'ALERTE', cellule, message });
  const wb = new ExcelJS.Workbook();
  try { await wb.xlsx.load(buffer); } catch {
    err('Fichier illisible : un classeur Excel (.xlsx) produit à partir du modèle de la campagne est attendu.');
    return { donnees: [], anomalies, total: null };
  }
  const id = wb.getWorksheet('_sigdep');
  const ws = wb.getWorksheet('Saisie');
  const meta = {};
  if (id) id.eachRow((r) => { meta[texte(r.getCell(1).value)] = r.getCell(2).value; });
  if (!id || !ws || meta.SIGDEP_COLLECTE === undefined) {
    err('Ce fichier n’est pas un modèle de collecte du SIG-DEP : téléchargez le modèle du service depuis la campagne et faites-le remplir.');
    return { donnees: [], anomalies, total: null };
  }
  if (texte(meta.campagne) !== collecte.reference) err(`Modèle d’une autre campagne (${texte(meta.campagne)}) : attendu ${collecte.reference}.`);
  if (texte(meta.service) !== service.sigle) err(`Modèle d’un autre service (${texte(meta.service)}) : attendu ${service.sigle}.`);
  if (texte(meta.objet) !== collecte.objet) err('Objet du modèle différent de celui de la campagne.');
  if (anomalies.length) return { donnees: [], anomalies, total: null };

  const cols = colonnes(collecte.objet, collecte.annee);
  const ligneEntete = Number(meta.ligne_entete);
  const entete = ws.getRow(ligneEntete);
  cols.forEach((c, i) => {
    if (texte(entete.getCell(i + 1).value) !== c.h) err(`Structure modifiée : colonne ${ws.getColumn(i + 1).letter} « ${texte(entete.getCell(i + 1).value)} » au lieu de « ${c.h} ».`, `${ws.getColumn(i + 1).letter}${ligneEntete}`);
  });
  if (anomalies.length) return { donnees: [], anomalies, total: null };

  const ref = await referentiels(collecte, service);
  const donnees = [];
  for (let r = ligneEntete + 1; r <= ws.rowCount; r += 1) {
    const row = ws.getRow(r);
    const v = {};
    const cellules = {};
    cols.forEach((c, i) => { v[c.k] = row.getCell(i + 1).value; cellules[c.k] = `${ws.getColumn(i + 1).letter}${r}`; });
    const saisies = cols.filter((c) => !c.verrou && !c.calc && c.k !== 'numero');
    if (saisies.every((c) => texte(v[c.k]) === '')) continue;
    const l = { ligne: r };
    for (const c of cols) {
      if (c.calc) continue;
      if (c.n) {
        const n = nombre(v[c.k]);
        if (Number.isNaN(n)) { err(`Montant ou nombre illisible « ${texte(v[c.k])} ».`, cellules[c.k]); l[c.k] = null; } else if (n !== null && n < 0) { err('Valeur négative.', cellules[c.k]); l[c.k] = null; } else l[c.k] = n;
      } else l[c.k] = texte(v[c.k]) || null;
      if (c.requis && (l[c.k] === null || l[c.k] === '')) err(`${c.h.replace(' *', '')} manquant.`, cellules[c.k]);
    }
    if (collecte.objet === 'PTBA') {
      l.mois = MOIS.map((_, i) => i + 1).filter((m) => l[`m${m}`]);
      for (let m = 1; m <= 12; m += 1) { if (l[`m${m}`] && l[`m${m}`].toLowerCase() !== 'x') err(`Chronogramme : « ${l[`m${m}`]} » au lieu de « x ».`, cellules[`m${m}`]); delete l[`m${m}`]; }
      if (!l.mois.length) alerte(`Activité « ${l.activite || '?'} » sans chronogramme.`, cellules.m1);
      if (l.action) {
        const a = ref.actions.find((x) => `${x.code} — ${x.libelle}` === l.action || x.code === l.action);
        if (!a) err(`Action budgétaire inconnue « ${l.action} » pour le programme du service.`, cellules.action); else l.action_id = a.id;
      }
      if (l.cout === 0) alerte(`Activité « ${l.activite || '?'} » sans coût.`, cellules.cout);
    }
    if (collecte.objet === 'CADRE_PERFORMANCE') {
      const ind = ref.indicateurs.find((x) => x.id === Number(texte(v.ref)));
      if (!ind) err(`Indicateur inconnu (réf. ${texte(v.ref)}).`, cellules.ref); else l.indicateur_id = ind.id;
      if ([l.realisation, l.cible1, l.cible2, l.cible3].every((x) => x === null)) alerte(`Indicateur « ${l.indicateur || '?'} » : aucune valeur renseignée.`, cellules.realisation);
    }
    if (collecte.objet === 'INVESTISSEMENT') {
      if (l.code_pip) {
        const p = ref.pips.find((x) => x.code === l.code_pip);
        if (!p) err(`Code PIP inconnu « ${l.code_pip} ».`, cellules.code_pip); else l.pip_id = p.id;
      }
      if (l.rubrique && !RUBRIQUES.includes(l.rubrique)) err(`Nature des coûts non prévue « ${l.rubrique} ».`, cellules.rubrique);
      if (l.source && !SOURCES.includes(l.source)) err(`Source de financement non prévue « ${l.source} ».`, cellules.source);
      if (l.maturite) { const k = Object.keys(MATURITES).find((x) => MATURITES[x] === l.maturite); if (!k) err(`Maturité non prévue « ${l.maturite} ».`, cellules.maturite); else l.maturite = k; }
      if (l.etude && !['Oui', 'Non'].includes(l.etude)) err('Étude de faisabilité : Oui ou Non.', cellules.etude);
      l.total = (l.montant1 || 0) + (l.montant2 || 0) + (l.montant3 || 0);
      if (!l.total) err(`Projet « ${l.intitule || '?'} » sans montant.`, cellules.montant1);
    }
    donnees.push(l);
  }
  if (!donnees.length) err('Aucune ligne renseignée.');
  // Doublons
  const cle = { PTBA: (l) => `${l.objectif}|${l.activite}|${l.taches || ''}`.toLowerCase(), CADRE_PERFORMANCE: (l) => String(l.indicateur_id), INVESTISSEMENT: (l) => (l.intitule || '').toLowerCase() }[collecte.objet];
  const vus = new Map();
  for (const l of donnees) {
    const k = cle(l);
    if (vus.has(k)) (collecte.objet === 'PTBA' ? alerte : err)(`Doublon des lignes ${vus.get(k)} et ${l.ligne}.`, `A${l.ligne}`);
    else vus.set(k, l.ligne);
  }
  // Total
  let total = null;
  if (collecte.objet !== 'CADRE_PERFORMANCE') {
    total = donnees.reduce((s, l) => s + (collecte.objet === 'PTBA' ? (l.cout || 0) : l.total), 0);
    const declare = nombre(ws.getCell(texte(meta.cellule_total)).value);
    if (declare === null) err('Total déclaré par le service non renseigné.', texte(meta.cellule_total));
    else if (Number.isNaN(declare)) err('Total déclaré illisible.', texte(meta.cellule_total));
    else if (Math.abs(declare - total) > 0.5) err(`Total déclaré (${Math.round(declare).toLocaleString('fr-FR')} CDF) différent de la somme des lignes (${Math.round(total).toLocaleString('fr-FR')} CDF).`, texte(meta.cellule_total));
  }
  return { donnees, anomalies, total };
}

// ─── Intégration ────────────────────────────────────────────────────────────
/** Intègre la dernière réception d’un service dans le SIG-DEP ; renvoie le résultat (affiché et conservé). */
async function integrer(trx, collecte, service, reception, ctx) {
  const lignes = reception.donnees;
  if (collecte.objet === 'PTBA') {
    const ex = await trx('exercices').where({ annee: collecte.annee }).first();
    if (!ex) throw Object.assign(new Error(`L’exercice ${collecte.annee} n’existe pas dans le référentiel de la planification.`), { metier: true });
    const objectifs = [];
    for (const l of lignes) {
      let o = objectifs.find((x) => x.libelle === l.objectif);
      if (!o) { o = { libelle: l.objectif, lignes: [] }; objectifs.push(o); }
      o.lignes.push({
        numero: l.numero ? String(l.numero).slice(0, 20) : null, activite: l.activite, taches: l.taches, cout: l.cout || 0, mois: l.mois, action_id: l.action_id || null,
        structure_responsable: l.structure_responsable || service.sigle, resultats_attendus: l.resultats_attendus, indicateur: l.indicateur,
        source_verification: l.source_verification, source_financement: l.source_financement,
      });
    }
    let p = await trx('ptba').where({ exercice_id: ex.id, service_id: service.id }).first();
    const { ecrireContenu } = require('../modules/ptba/routes');
    const { nextReference } = require('./sequence');
    const { addHistory } = require('./history');
    const commentaire = `Contribution du service reçue par la campagne ${collecte.reference} (version ${reception.version})`;
    if (p) {
      if (!['BROUILLON', 'A_CORRIGER'].includes(p.statut)) throw Object.assign(new Error(`Le PTBA ${ex.annee} du service ${service.sigle} est déjà en circuit ou validé : il ne peut être remplacé.`), { metier: true });
      await ecrireContenu(trx, p.id, objectifs);
      await trx('ptba').where({ id: p.id }).update({ updated_at: trx.fn.now() });
      await addHistory('PTBA', p.id, ctx.userId, { action: 'IMPORT', commentaire: `Contenu remplacé. ${commentaire}` }, trx);
    } else {
      [p] = await trx('ptba').insert({
        reference: await nextReference('PTBA', 'DEP/PTBA', trx), exercice_id: ex.id, service_id: service.id, programme_id: service.programme_id || null,
        prepare_par: ctx.userId, detenteur_user_id: ctx.userId,
      }).returning('*');
      await ecrireContenu(trx, p.id, objectifs);
      await addHistory('PTBA', p.id, ctx.userId, { action: 'IMPORT', nouveau: 'BROUILLON', commentaire }, trx);
    }
    return { type: 'PTBA', ptba_id: p.id, reference: p.reference, lignes: lignes.length, message: `PTBA ${p.reference} (brouillon) : ${lignes.length} activité(s)` };
  }
  if (collecte.objet === 'CADRE_PERFORMANCE') {
    let n = 0;
    const ecrire = async (indicateurId, annee, type, valeur, commentaire) => {
      if (valeur === null || valeur === undefined) return;
      await trx('plan_indicateur_valeurs').insert({ indicateur_id: indicateurId, annee, type, valeur, commentaire: commentaire || `Campagne ${collecte.reference}`, saisi_par: ctx.userId, saisi_at: trx.fn.now() })
        .onConflict(['indicateur_id', 'annee', 'type']).merge();
      n += 1;
    };
    for (const l of lignes) {
      await ecrire(l.indicateur_id, collecte.annee, 'REALISATION', l.realisation, l.commentaire);
      for (const i of [1, 2, 3]) await ecrire(l.indicateur_id, collecte.annee + i, 'CIBLE', l[`cible${i}`]);
    }
    return { type: 'CADRE_PERFORMANCE', valeurs: n, message: `${n} valeur(s) d’indicateurs enregistrée(s)` };
  }
  // Dépenses d’investissement : projets de la banque de projets
  const { normalize } = require('../modules/pip/model');
  const { nextReference } = require('./sequence');
  const { addHistory } = require('./history');
  const dep = await trx('directions').where({ code: 'DEP' }).first();
  const crees = []; const majs = [];
  for (const l of lignes) {
    if (l.pip_id) {
      const patch = { programme_id: service.programme_id || undefined, ...(l.maturite ? { maturite: l.maturite } : {}), ...(l.localisation ? { localisation: l.localisation.slice(0, 200) } : {}) };
      await trx('pip_projects').where({ id: l.pip_id }).update(patch);
      await addHistory('PIP', l.pip_id, ctx.userId, { action: 'MODIFICATION', commentaire: `Mise à jour par la campagne ${collecte.reference} (${service.sigle})` }, trx);
      majs.push(l.code_pip);
      continue;
    }
    const annees = { annee1: l.montant1, annee2: l.montant2, annee3: l.montant3 };
    const { donnees, coutTotal } = normalize({
      identification: { libelle: l.intitule, service: `${service.sigle} — ${service.libelle}`, secteur: 'Numérique', province: l.localisation || '' },
      calendrier: { date_debut: `${collecte.annee}-01-01`, date_fin: `${collecte.annee + 2}-12-31` },
      financier: { couts: RUBRIQUES.map((r) => (r === l.rubrique ? { rubrique: r, ...annees } : { rubrique: r })), financement: SOURCES.map((s) => (s === l.source ? { source: s, ...annees } : { source: s })) },
      controle: { commentaire: [l.observations, l.etude ? `Étude de faisabilité : ${l.etude}` : null, `Collecté par la campagne ${collecte.reference}`].filter(Boolean).join('\n') },
    });
    const [p] = await trx('pip_projects').insert({
      code: await nextReference('PIP', 'DEP/PIP', trx), intitule: l.intitule.slice(0, 400), secteur: 'Numérique', donnees: JSON.stringify(donnees), cout_total: coutTotal, devise: 'CDF', modele: 'PLAN',
      duree_mois: donnees.calendrier.duree_mois, date_debut: donnees.calendrier.date_debut, auteur_user_id: ctx.userId, detenteur_user_id: ctx.userId,
      direction_id: dep.id, division_id: ctx.divisionId, bureau_id: ctx.bureauId, maturite: l.maturite || 'IDEE', programme_id: service.programme_id || null,
      localisation: l.localisation ? l.localisation.slice(0, 200) : null,
    }).returning('*');
    await trx('pip_versions').insert({ pip_id: p.id, numero: 1, donnees: JSON.stringify(donnees), created_by: ctx.userId });
    await addHistory('PIP', p.id, ctx.userId, { action: 'CREATION', nouveau: 'BROUILLON', commentaire: `Créé par la campagne ${collecte.reference} (${service.sigle})` }, trx);
    crees.push(p.code);
  }
  return { type: 'INVESTISSEMENT', crees, mis_a_jour: majs, message: `${crees.length} projet(s) créé(s) dans la banque de projets, ${majs.length} mis à jour` };
}

module.exports = { OBJETS, MATURITES, RUBRIQUES, SOURCES, VERSION_MODELE, colonnes, modele, analyser, integrer, referentiels };

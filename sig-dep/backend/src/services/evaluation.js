'use strict';
/**
 * Évaluation annuelle des politiques sectorielles et budgétaires (cahier, §§ 34 et 51) : annexes
 * du dossier préparées à partir des données du SIG-DEP, puis contrôlées.
 *  - Annexe I (politiques sectorielles de l’exercice) : PTBA validés de l’exercice, regroupés par
 *    action budgétaire (à défaut, par objectif spécifique) ; prévision = coût programmé,
 *    exécution = montants décaissés au dernier suivi trimestriel, niveau physique d’après le taux
 *    d’exécution physique.
 *  - Annexe II (projection sur trois ans) : prévisions de crédits par action (à défaut, par programme).
 *  - Annexes III et IV (primes, salaire de base) : effectif organique et affecté par grade ; payé
 *    et non payé saisis d’après les états de la Direction des Ressources Humaines (pièces jointes).
 *  - Annexe V (exécution des dépenses) : par programme, dotation = crédits votés, engagé et payé =
 *    suivi de l’exécution des PTBA validés.
 * Les taux, totaux, écarts et montants non payés sont toujours recalculés ici, jamais saisis.
 */
const db = require('../db/knex');
const ptba = require('./ptba');
const effectifs = require('./effectifs');

const ANNEXES = {
  I: 'Annexe I — Politiques sectorielles de l’exercice',
  II: 'Annexe II — Projection des actions sur trois ans',
  III: 'Annexe III — Politique salariale : primes (effectifs par grade)',
  IV: 'Annexe IV — Politique salariale : salaire de base (effectifs par grade)',
  V: 'Annexe V — Niveau d’exécution des dépenses',
};
const NIVEAUX = { TOTAL: 'Total', PARTIEL: 'Partiel', NON_ENTAME: 'Non entamé' };

/** Champs saisissables de chaque annexe ; « source » : repris du SIG-DEP. */
const CHAMPS = {
  I: { action: 'texte', prevision: 'montant', execution: 'montant', taux_physique: 'pourcent', niveau_physique: 'niveau', cible: 'texte', reconduction: 'oui_non' },
  II: { action: 'texte', montant_1: 'montant', montant_2: 'montant', montant_3: 'montant', etude_faisabilite: 'oui_non', objectif_pag: 'texte', impact_environnemental: 'texte' },
  III: { grade: 'texte', organique: 'entier', affecte: 'entier', paye: 'entier', non_paye: 'entier' },
  IV: { grade: 'texte', organique: 'entier', affecte: 'entier', paye: 'entier', non_paye: 'entier' },
  V: { programme: 'texte', dotation: 'montant', engage: 'montant', paye: 'montant', observation: 'texte' },
};
const LIBELLE = { I: 'action', II: 'action', III: 'grade', IV: 'grade', V: 'programme' };

const arrondi = (n, d = 1) => Math.round(n * 10 ** d) / 10 ** d;
const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));
const taux = (a, b) => (b ? arrondi((a / b) * 100) : null);
const niveau = (t) => (t >= 100 ? 'TOTAL' : t > 0 ? 'PARTIEL' : 'NON_ENTAME');

// ─── Reprise des données du SIG-DEP ─────────────────────────────────────────
async function lignesPtbaValides(annee, trx) {
  const ids = await trx('ptba as p').join('exercices as e', 'e.id', 'p.exercice_id').where({ 'e.annee': annee, 'p.statut': 'VALIDE' }).pluck('p.id');
  const out = [];
  for (const id of ids) {
    const p = await ptba.charger(id);
    const objectifs = new Map(p.objectifs.map((o) => [o.id, o.libelle]));
    for (const l of p.lignes) out.push({ ...l, objectif_libelle: objectifs.get(l.objectif_id), ptba_id: p.id, programme_id: p.programme_id, service_sigle: p.service_sigle, programme_code: p.programme_code, programme_libelle: p.programme_libelle });
  }
  return { ptba: ids.length, lignes: out };
}

async function sourceI(e, trx) {
  const { lignes } = await lignesPtbaValides(e.annee, trx);
  const groupes = new Map();
  for (const l of lignes) {
    // Par action budgétaire ; à défaut, par objectif spécifique du PTBA (ou PTBA entier)
    const cle = l.action_id ? `ACTION:${l.action_id}` : l.objectif_id ? `OBJECTIF:${l.objectif_id}` : `PTBA:${l.ptba_id}`;
    const libelle = l.action_id ? `${l.action_code} — ${l.action_libelle}` : l.objectif_id ? `${l.service_sigle} — ${l.objectif_libelle}` : `Activités du PTBA ${l.service_sigle} sans action budgétaire`;
    if (!groupes.has(cle)) groupes.set(cle, { cle, libelle, lignes: [] });
    groupes.get(cle).lignes.push(l);
  }
  return [...groupes.values()].map((g) => {
    const x = ptba.execution(g.lignes);
    return { cle: g.cle, source: { action: g.libelle, prevision: x.cout, execution: x.decaisse, taux_physique: x.tauxPhysique, niveau_physique: niveau(x.tauxPhysique) } };
  });
}

async function sourceII(e, trx) {
  const annees = [0, 1, 2].map((i) => e.annee_projection + i);
  const rows = await trx('plan_credits as c').join('plan_programmes as g', 'g.id', 'c.programme_id').leftJoin('plan_actions as a', 'a.id', 'c.action_id')
    .where('c.type', 'PREVISION').whereIn('c.annee', annees)
    .select('c.annee', 'c.programme_id', 'c.action_id', 'c.montant', 'g.code as programme_code', 'g.libelle as programme_libelle', 'g.ordre as programme_ordre', 'a.code as action_code', 'a.libelle as action_libelle');
  const out = new Map();
  const ajouter = (cle, libelle, ordre, r) => {
    if (!out.has(cle)) out.set(cle, { cle, ordre, source: { action: libelle, montant_1: 0, montant_2: 0, montant_3: 0 } });
    out.get(cle).source[`montant_${annees.indexOf(r.annee) + 1}`] += Number(r.montant);
  };
  const avecActions = new Set(rows.filter((r) => r.action_id).map((r) => r.programme_id));
  for (const r of rows) {
    if (r.action_id) ajouter(`ACTION:${r.action_id}`, `${r.action_code} — ${r.action_libelle}`, `${r.programme_ordre}-${r.action_code}`, r);
    else if (!avecActions.has(r.programme_id)) ajouter(`PROGRAMME:${r.programme_id}`, `Programme ${r.programme_code} — ${r.programme_libelle}`, `${r.programme_ordre}`, r);
  }
  return [...out.values()].sort((a, b) => String(a.ordre).localeCompare(String(b.ordre), 'fr', { numeric: true })).map(({ cle, source }) => ({ cle, source }));
}

async function sourceEffectifs() {
  const e = await effectifs.parStructure();
  return e.colonnes.map((c) => {
    const organique = e.structures.reduce((t, s) => t + (s.detail.find((d) => d.critere === c.critere)?.prevu || 0), 0);
    const affecte = e.structures.reduce((t, s) => t + (s.detail.find((d) => d.critere === c.critere)?.reel || 0), 0);
    return { cle: `GRADE:${c.critere}`, source: { grade: c.libelle, organique, affecte } };
  });
}

async function sourceV(e, trx) {
  // Requêtes successives : une transaction n’en exécute qu’une à la fois
  const programmes = await trx('plan_programmes').where({ actif: true }).orderBy(['ordre', 'code']);
  const votes = await trx('plan_credits').where({ annee: e.annee, type: 'VOTE' }).whereNull('action_id').select('programme_id').sum('montant as montant').groupBy('programme_id');
  const { lignes } = await lignesPtbaValides(e.annee, trx);
  const out = [];
  const execution = (pid) => ptba.execution(lignes.filter((l) => (l.programme_id || null) === pid));
  for (const g of programmes) {
    const v = votes.find((x) => x.programme_id === g.id);
    const x = execution(g.id);
    if (!v && !x.lignes) continue;
    out.push({ cle: `PROGRAMME:${g.id}`, source: { programme: `${g.code} — ${g.libelle}`, dotation: v ? Number(v.montant) : 0, engage: x.engage, paye: x.decaisse } });
  }
  const sans = execution(null);
  if (sans.lignes) out.push({ cle: 'PROGRAMME:0', source: { programme: 'PTBA sans programme', dotation: 0, engage: sans.engage, paye: sans.decaisse } });
  return out;
}

async function sources(e, annexe, trx = db) {
  if (annexe === 'I') return sourceI(e, trx);
  if (annexe === 'II') return sourceII(e, trx);
  if (annexe === 'III' || annexe === 'IV') return sourceEffectifs();
  return sourceV(e, trx);
}

/**
 * Reprend les données du SIG-DEP dans une annexe : nouvelles lignes ajoutées ; pour une ligne
 * existante, chaque valeur non modifiée suit la source, une valeur modifiée est conservée ; une
 * ligne dont l’élément source a disparu est signalée.
 */
async function actualiser(e, annexe, userId, trx) {
  const src = await sources(e, annexe, trx);
  const existantes = await trx('evaluation_lignes').where({ evaluation_id: e.id, annexe });
  const parCle = new Map(existantes.filter((l) => l.cle).map((l) => [l.cle, l]));
  let ordre = existantes.reduce((m, l) => Math.max(m, l.ordre), 0);
  const bilan = { ajoutees: 0, actualisees: 0, absentes: 0 };
  for (const s of src) {
    const l = parCle.get(s.cle);
    if (!l) {
      ordre += 1;
      await trx('evaluation_lignes').insert({ evaluation_id: e.id, annexe, ordre, cle: s.cle, valeurs: JSON.stringify(s.source), source: JSON.stringify(s.source), modifie_par: userId });
      bilan.ajoutees += 1;
      continue;
    }
    parCle.delete(s.cle);
    const valeurs = { ...l.valeurs };
    for (const [k, v] of Object.entries(s.source)) if (!l.source || egal(valeurs[k], l.source[k])) valeurs[k] = v;
    if (JSON.stringify(valeurs) !== JSON.stringify(l.valeurs) || JSON.stringify(s.source) !== JSON.stringify(l.source) || l.source_absente) {
      await trx('evaluation_lignes').where({ id: l.id }).update({ valeurs: JSON.stringify(valeurs), source: JSON.stringify(s.source), source_absente: false, updated_at: trx.fn.now() });
      bilan.actualisees += 1;
    }
  }
  for (const l of parCle.values()) {
    if (!l.source_absente) { await trx('evaluation_lignes').where({ id: l.id }).update({ source_absente: true, updated_at: trx.fn.now() }); bilan.absentes += 1; }
  }
  return bilan;
}

const egal = (a, b) => (a ?? null) === (b ?? null) || (num(a) !== null && num(a) === num(b) && typeof a !== 'boolean');

// ─── Calculs et contrôles ───────────────────────────────────────────────────
/** Valeurs calculées d’une ligne (taux, écarts, montants non payés). */
function calculs(annexe, v) {
  if (annexe === 'I') return { taux: taux(num(v.execution) || 0, num(v.prevision)) };
  if (annexe === 'II') return { total: (num(v.montant_1) || 0) + (num(v.montant_2) || 0) + (num(v.montant_3) || 0) };
  if (annexe === 'III' || annexe === 'IV') return { ecart: (num(v.affecte) || 0) - (num(v.organique) || 0) };
  return { non_paye: (num(v.engage) || 0) - (num(v.paye) || 0), pourcentage: taux(num(v.engage) || 0, num(v.dotation)) };
}

/** Anomalies d’une ligne : ERREUR (bloque la soumission) ou ALERTE (à justifier). */
function controlerLigne(annexe, v) {
  const a = [];
  const err = (message) => a.push({ gravite: 'ERREUR', message });
  const alerte = (message) => a.push({ gravite: 'ALERTE', message });
  if (!String(v[LIBELLE[annexe]] || '').trim()) err('Libellé manquant.');
  for (const [k, t] of Object.entries(CHAMPS[annexe])) {
    const n = num(v[k]);
    if (['montant', 'entier', 'pourcent'].includes(t) && n !== null && (!Number.isFinite(n) || n < 0)) err(`Valeur négative ou invalide (${k}).`);
  }
  if (annexe === 'I') {
    if (num(v.prevision) === null || num(v.prevision) === 0) alerte('Prévision nulle : le taux d’exécution ne peut être calculé.');
    else if (num(v.execution) > num(v.prevision)) alerte('Exécution supérieure à la prévision : à justifier.');
    if (num(v.taux_physique) !== null && num(v.taux_physique) > 100) err('Taux d’exécution physique supérieur à 100 %.');
    if (!v.niveau_physique) err('Niveau d’exécution physique (total ou partiel) non renseigné.');
    else if (num(v.taux_physique) !== null && v.niveau_physique !== niveau(num(v.taux_physique))) alerte(`Niveau « ${NIVEAUX[v.niveau_physique]} » incohérent avec le taux physique de ${num(v.taux_physique)} %.`);
    if (v.reconduction === null || v.reconduction === undefined) err('Reconduction l’année suivante (oui ou non) non renseignée.');
    if (!String(v.cible || '').trim()) alerte('Cible ou bénéficiaires non renseignés.');
  }
  if (annexe === 'II') {
    if (!num(v.montant_1) && !num(v.montant_2) && !num(v.montant_3)) err('Aucun montant projeté.');
    if (v.etude_faisabilite === null || v.etude_faisabilite === undefined) err('Existence d’une étude de faisabilité (oui ou non) non renseignée.');
    if (!String(v.objectif_pag || '').trim()) err('Objectif visé en lien avec le PAG non renseigné.');
    if (!String(v.impact_environnemental || '').trim()) alerte('Impact environnemental non renseigné.');
  }
  if (annexe === 'III' || annexe === 'IV') {
    if (num(v.paye) === null || num(v.non_paye) === null) alerte('Payé et non payé à saisir d’après les états de la Direction des Ressources Humaines.');
    else if (num(v.paye) + num(v.non_paye) !== (num(v.affecte) || 0)) err(`Payé (${num(v.paye)}) + non payé (${num(v.non_paye)}) ≠ affecté (${num(v.affecte) || 0}).`);
    for (const k of ['organique', 'affecte', 'paye', 'non_paye']) if (num(v[k]) !== null && !Number.isInteger(num(v[k]))) err('Les effectifs sont des nombres entiers.');
  }
  if (annexe === 'V') {
    if (num(v.paye) > num(v.engage)) err('Dépenses payées supérieures aux dépenses engagées.');
    if (!num(v.dotation)) alerte('Dotation annuelle nulle : le pourcentage ne peut être calculé.');
    else if (num(v.engage) > num(v.dotation)) alerte('Dépenses engagées supérieures à la dotation : à expliquer en observation.');
    if (num(v.dotation) && num(v.engage) / num(v.dotation) < 0.5 && !String(v.observation || '').trim()) alerte('Exécution inférieure à 50 % sans observation.');
  }
  return a;
}

/** Champs dont la valeur retenue diffère de la valeur reprise du SIG-DEP. */
function modifies(l) {
  if (!l.source) return [];
  return Object.keys(l.source).filter((k) => !egal(l.valeurs[k], l.source[k]));
}

function totaux(annexe, lignes) {
  const s = (k) => lignes.reduce((t, l) => t + (num(l.valeurs[k]) || 0), 0);
  if (annexe === 'I') { const p = s('prevision'); const x = s('execution'); return { prevision: p, execution: x, taux: taux(x, p), reconduites: lignes.filter((l) => l.valeurs.reconduction === true).length }; }
  if (annexe === 'II') { const t = { montant_1: s('montant_1'), montant_2: s('montant_2'), montant_3: s('montant_3') }; return { ...t, total: t.montant_1 + t.montant_2 + t.montant_3 }; }
  if (annexe === 'III' || annexe === 'IV') { const t = { organique: s('organique'), affecte: s('affecte'), paye: s('paye'), non_paye: s('non_paye') }; return { ...t, ecart: t.affecte - t.organique }; }
  const t = { dotation: s('dotation'), engage: s('engage'), paye: s('paye') };
  return { ...t, non_paye: t.engage - t.paye, pourcentage: taux(t.engage, t.dotation) };
}

/** Dossier complet : annexes avec calculs, contrôles et totaux. */
async function dossier(e, trx = db) {
  const lignes = await trx('evaluation_lignes').where({ evaluation_id: e.id }).orderBy(['annexe', 'ordre', 'id']);
  const annexes = {};
  const anomalies = [];
  for (const [code, titre] of Object.entries(ANNEXES)) {
    const toutes = lignes.filter((l) => l.annexe === code).map((l) => ({
      id: l.id, cle: l.cle, ordre: l.ordre, valeurs: l.valeurs, source: l.source, exclue: l.exclue, source_absente: l.source_absente,
      ajoutee: !l.cle, modifies: modifies(l), calculs: calculs(code, l.valeurs), anomalies: l.exclue ? [] : controlerLigne(code, l.valeurs),
    }));
    const retenues = toutes.filter((l) => !l.exclue);
    for (const l of retenues) {
      for (const a of l.anomalies) anomalies.push({ ...a, annexe: code, ligne_id: l.id, libelle: l.valeurs[LIBELLE[code]] });
      if (l.source_absente) anomalies.push({ gravite: 'ALERTE', annexe: code, ligne_id: l.id, libelle: l.valeurs[LIBELLE[code]], message: 'L’élément repris du SIG-DEP n’existe plus : ligne à confirmer ou à écarter.' });
    }
    if (!retenues.length) anomalies.push({ gravite: 'ERREUR', annexe: code, message: `${titre} : aucune ligne.` });
    annexes[code] = { code, titre, lignes: retenues, ecartees: toutes.filter((l) => l.exclue), totaux: totaux(code, retenues) };
  }
  // Une même alerte répétée sur plusieurs lignes d’une annexe est regroupée (ex. effectifs payés à saisir)
  const regroupees = [];
  for (const a of anomalies) {
    const meme = anomalies.filter((x) => x.annexe === a.annexe && x.gravite === a.gravite && x.message === a.message);
    if (meme.length < 3) regroupees.push(a);
    else if (meme[0] === a) regroupees.push({ ...a, ligne_id: null, libelle: `${meme.length} lignes`, lignes: meme.map((x) => x.ligne_id) });
  }
  anomalies.splice(0, anomalies.length, ...regroupees);
  // Cohérence entre annexes
  const affecte3 = annexes.III.totaux.affecte; const affecte4 = annexes.IV.totaux.affecte;
  if (annexes.III.lignes.length && annexes.IV.lignes.length && affecte3 !== affecte4) anomalies.push({ gravite: 'ALERTE', annexe: 'IV', message: `Effectif affecté différent entre l’annexe III (${affecte3}) et l’annexe IV (${affecte4}).` });
  const { ptba: nbPtba } = await lignesPtbaValides(e.annee, trx);
  if (!nbPtba) anomalies.push({ gravite: 'ALERTE', annexe: 'I', message: `Aucun PTBA validé pour l’exercice ${e.annee} : les annexes I et V ne peuvent être reprises du SIG-DEP.` });
  const pieces = Number((await trx('attachments').where({ entity_type: 'EVALUATION', entity_id: e.id }).whereNull('deleted_at').count('* as n').first()).n);
  if (!pieces) anomalies.push({ gravite: 'ALERTE', annexe: 'III', message: 'Aucune pièce jointe : joindre la convocation et les états de la Direction des Ressources Humaines (montants des primes et des salaires).' });
  return {
    annexes, anomalies, pieces,
    controle: { erreurs: anomalies.filter((a) => a.gravite === 'ERREUR').length, alertes: anomalies.filter((a) => a.gravite === 'ALERTE').length },
    projection: [0, 1, 2].map((i) => e.annee_projection + i),
  };
}

/** Normalise les valeurs saisies d’une ligne selon le type de chaque champ de l’annexe. */
function normaliser(annexe, valeurs) {
  const out = {};
  for (const [k, t] of Object.entries(CHAMPS[annexe])) {
    if (!(k in valeurs)) continue;
    const v = valeurs[k];
    if (t === 'texte') out[k] = v === null || v === undefined ? null : String(v).trim().slice(0, 2000) || null;
    else if (t === 'oui_non') out[k] = v === null || v === undefined || v === '' ? null : v === true || v === 'true';
    else if (t === 'niveau') out[k] = NIVEAUX[v] ? v : null;
    else out[k] = num(v) === null || !Number.isFinite(num(v)) ? null : (t === 'montant' ? Math.round(num(v) * 100) / 100 : num(v));
  }
  return out;
}

module.exports = { ANNEXES, CHAMPS, NIVEAUX, LIBELLE, sources, actualiser, dossier, calculs, controlerLigne, totaux, normaliser };

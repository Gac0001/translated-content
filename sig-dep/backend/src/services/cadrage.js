'use strict';
/**
 * Cadrage budgétaire (CBMT) : plafonds du Ministère par année et par rubrique, comparés aux
 * prévisions de crédits saisies au niveau des programmes (celles qui alimentent le CDMT et le PAP).
 * Montants en francs congolais (CDF).
 */
const db = require('../db/knex');

const DUREE = 3; // un CBMT couvre trois exercices : annee, annee + 1, annee + 2

/** CBMT applicable à une année : le plus récent qui la couvre, validé de préférence. */
async function cbmtPour(annee, trx = db) {
  const docs = await trx('plan_documents').where({ type: 'CBMT' }).where('annee', '<=', annee).where('annee', '>', annee - DUREE).orderBy('annee', 'desc');
  return docs.find((d) => d.statut === 'VALIDE') || docs[0] || null;
}

/**
 * Contrôle du cadrage sur les années du CBMT applicable à `annee` : plafond, prévision, écart par
 * rubrique et au total. Sans CBMT : null.
 */
async function controle(annee, trx = db, impose = null) {
  const cbmt = impose || await cbmtPour(annee, trx);
  if (!cbmt) return null;
  const annees = Array.from({ length: DUREE }, (_, i) => cbmt.annee + i);
  const [rubriques, prev] = await Promise.all([
    trx('plan_postes_budgetaires').where({ axe: 'RUBRIQUE' }).orderBy('ordre'),
    trx('plan_credits').whereIn('annee', annees).where({ type: 'PREVISION' }).whereNull('action_id').select('annee', 'poste_id').sum('montant as montant').groupBy('annee', 'poste_id'),
  ]);
  const plafonds = (cbmt.contenu || {}).plafonds || {};
  const lignesAnnee = (a) => rubriques.map((r) => {
    const plafond = plafonds[a]?.[r.code];
    const p = prev.find((x) => x.annee === a && x.poste_id === r.id);
    const prevision = p ? Number(p.montant) : null;
    const pl = plafond === undefined || plafond === null ? null : Number(plafond);
    return { code: r.code, libelle: r.libelle, plafond: pl, prevision, ecart: pl === null ? null : pl - (prevision || 0), depasse: pl !== null && (prevision || 0) > pl };
  });
  return {
    cbmt: { id: cbmt.id, reference: cbmt.reference, annee: cbmt.annee, periode: `${cbmt.annee}-${cbmt.annee + DUREE - 1}`, statut: cbmt.statut },
    annees: annees.map((a) => {
      const lignes = lignesAnnee(a);
      const somme = (k) => (lignes.some((l) => l[k] !== null) ? lignes.reduce((s, l) => s + (l[k] || 0), 0) : null);
      const plafond = somme('plafond');
      const prevision = somme('prevision');
      return { annee: a, lignes, total: { plafond, prevision, ecart: plafond === null ? null : plafond - (prevision || 0), depasse: plafond !== null && (prevision || 0) > plafond } };
    }),
  };
}

/** Dépassements (rubriques et totaux) du cadrage applicable aux années données. */
async function depassements(annees, trx = db) {
  const out = [];
  const vus = new Set();
  for (const a of annees) {
    const c = await controle(a, trx);
    if (!c || vus.has(c.cbmt.id)) continue;
    vus.add(c.cbmt.id);
    for (const y of c.annees) {
      for (const l of y.lignes) if (l.depasse) out.push({ annee: y.annee, rubrique: l.libelle, plafond: l.plafond, prevision: l.prevision });
      if (y.total.depasse) out.push({ annee: y.annee, rubrique: 'Total', plafond: y.total.plafond, prevision: y.total.prevision });
    }
  }
  return out;
}

module.exports = { DUREE, cbmtPour, controle, depassements };

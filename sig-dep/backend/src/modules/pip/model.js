'use strict';
/**
 * Structure de la fiche de projet PIP (Programme d’Investissements Publics),
 * inspirée du modèle de fiche projet du Ministère du Plan.
 */
const SECTIONS = [
  { key: 'identification', numero: 1, label: 'Identification du projet', fields: [
    { key: 'intitule', label: 'Intitulé du projet', type: 'text', required: true },
    { key: 'code_pip', label: 'Code PIP (si attribué)', type: 'text' },
    { key: 'secteur', label: 'Secteur', type: 'text', required: true, default: 'Économie numérique' },
    { key: 'sous_secteur', label: 'Sous-secteur', type: 'text' },
    { key: 'ministere_tutelle', label: 'Ministère de tutelle', type: 'text', required: true },
    { key: 'organisme_execution', label: 'Organisme d’exécution', type: 'text', required: true },
    { key: 'nature', label: 'Nature du projet', type: 'select', options: ['Nouveau projet', 'Projet en cours', 'Extension', 'Réhabilitation'], required: true },
    { key: 'type_projet', label: 'Type de projet', type: 'select', options: ['Infrastructure', 'Équipement', 'Renforcement des capacités', 'Étude', 'Réforme / appui institutionnel', 'Mixte'] },
    { key: 'date_demarrage', label: 'Date prévue de démarrage', type: 'date', required: true },
    { key: 'duree_mois', label: 'Durée (mois)', type: 'number', required: true },
  ] },
  { key: 'contexte', numero: 2, label: 'Contexte et justification', fields: [
    { key: 'contexte', label: 'Contexte', type: 'textarea', required: true },
    { key: 'problematique', label: 'Problématique', type: 'textarea', required: true },
    { key: 'justification', label: 'Justification', type: 'textarea', required: true },
    { key: 'alignement', label: 'Alignement sur les politiques nationales (PNSD, Plan national du numérique…)', type: 'textarea' },
  ] },
  { key: 'objectifs', numero: 3, label: 'Objectifs', fields: [
    { key: 'objectif_general', label: 'Objectif général', type: 'textarea', required: true },
    { key: 'objectifs_specifiques', label: 'Objectifs spécifiques', type: 'list', required: true },
  ] },
  { key: 'resultats', numero: 4, label: 'Résultats attendus', fields: [
    { key: 'resultats_attendus', label: 'Résultats attendus', type: 'list', required: true },
  ] },
  { key: 'activites', numero: 5, label: 'Activités', fields: [
    { key: 'activites', label: 'Activités du projet', type: 'table', required: true, columns: [
      { key: 'code', label: 'Code' }, { key: 'activite', label: 'Activité' }, { key: 'resultat', label: 'Résultat lié' },
      { key: 'debut', label: 'Début', type: 'date' }, { key: 'fin', label: 'Fin', type: 'date' }, { key: 'cout', label: 'Coût (USD)', type: 'number' },
    ] },
  ] },
  { key: 'indicateurs', numero: 6, label: 'Indicateurs', fields: [
    { key: 'indicateurs', label: 'Indicateurs de performance', type: 'table', required: true, columns: [
      { key: 'indicateur', label: 'Indicateur' }, { key: 'reference', label: 'Valeur de référence' }, { key: 'cible', label: 'Valeur cible' },
      { key: 'annee_cible', label: 'Année cible' }, { key: 'source', label: 'Source de vérification' },
    ] },
  ] },
  { key: 'beneficiaires', numero: 7, label: 'Bénéficiaires', fields: [
    { key: 'directs', label: 'Bénéficiaires directs', type: 'textarea', required: true },
    { key: 'indirects', label: 'Bénéficiaires indirects', type: 'textarea' },
    { key: 'nombre', label: 'Nombre estimé de bénéficiaires', type: 'number' },
    { key: 'genre', label: 'Prise en compte du genre et des groupes vulnérables', type: 'textarea' },
  ] },
  { key: 'localisation', numero: 8, label: 'Localisation', fields: [
    { key: 'sites', label: 'Sites d’intervention', type: 'table', required: true, columns: [
      { key: 'province', label: 'Province' }, { key: 'territoire', label: 'Territoire / Ville' }, { key: 'site', label: 'Site / localité' },
    ] },
  ] },
  { key: 'chronogramme', numero: 9, label: 'Chronogramme', fields: [
    { key: 'chronogramme', label: 'Chronogramme d’exécution', type: 'table', columns: [
      { key: 'activite', label: 'Activité' }, { key: 'annee', label: 'Année' }, { key: 't1', label: 'T1' }, { key: 't2', label: 'T2' }, { key: 't3', label: 'T3' }, { key: 't4', label: 'T4' },
    ] },
  ] },
  { key: 'cout', numero: 10, label: 'Coût du projet', fields: [
    { key: 'devise', label: 'Devise', type: 'select', options: ['USD', 'CDF'], default: 'USD' },
    { key: 'couts', label: 'Coût par rubrique et par année', type: 'table', required: true, columns: [
      { key: 'rubrique', label: 'Rubrique / composante' }, { key: 'annee1', label: 'Année 1', type: 'number' }, { key: 'annee2', label: 'Année 2', type: 'number' },
      { key: 'annee3', label: 'Année 3', type: 'number' }, { key: 'total', label: 'Total', type: 'number' },
    ] },
  ] },
  { key: 'financement', numero: 11, label: 'Sources de financement', fields: [
    { key: 'sources', label: 'Sources de financement', type: 'table', required: true, columns: [
      { key: 'source', label: 'Source' }, { key: 'montant', label: 'Montant', type: 'number' }, { key: 'pourcentage', label: '%', type: 'number' }, { key: 'statut', label: 'Statut (acquis / à rechercher)' },
    ] },
  ] },
  { key: 'risques', numero: 12, label: 'Risques et mesures d’atténuation', fields: [
    { key: 'risques', label: 'Risques', type: 'table', required: true, columns: [
      { key: 'risque', label: 'Risque' }, { key: 'probabilite', label: 'Probabilité' }, { key: 'impact', label: 'Impact' }, { key: 'mesure', label: 'Mesure d’atténuation' },
    ] },
  ] },
  { key: 'impacts', numero: 13, label: 'Impacts', fields: [
    { key: 'economique', label: 'Impact économique', type: 'textarea', required: true },
    { key: 'social', label: 'Impact social', type: 'textarea' },
    { key: 'environnemental', label: 'Impact environnemental', type: 'textarea' },
    { key: 'institutionnel', label: 'Impact institutionnel', type: 'textarea' },
  ] },
  { key: 'gains', numero: 14, label: 'Gains économiques', fields: [
    { key: 'van', label: 'Valeur actuelle nette (VAN)', type: 'number' },
    { key: 'tri', label: 'Taux de rentabilité interne (TRI, %)', type: 'number' },
    { key: 'ratio_bc', label: 'Ratio bénéfices / coûts', type: 'number' },
    { key: 'emplois', label: 'Emplois créés', type: 'number' },
    { key: 'description', label: 'Description des gains économiques', type: 'textarea' },
  ] },
  { key: 'etudes', numero: 15, label: 'Études disponibles', fields: [
    { key: 'etudes', label: 'Études réalisées ou disponibles', type: 'table', columns: [
      { key: 'etude', label: 'Étude' }, { key: 'date', label: 'Date' }, { key: 'auteur', label: 'Auteur' }, { key: 'statut', label: 'Statut' },
    ] },
  ] },
  { key: 'responsables', numero: 16, label: 'Responsables du projet', fields: [
    { key: 'structure_responsable', label: 'Structure responsable', type: 'text', required: true },
    { key: 'chef_projet', label: 'Chef de projet', type: 'text', required: true },
    { key: 'contacts', label: 'Contacts (téléphone, courriel)', type: 'text' },
    { key: 'partenaires', label: 'Partenaires', type: 'list' },
  ] },
];

function isEmpty(v) {
  if (v === undefined || v === null) return true;
  if (typeof v === 'string') return v.trim() === '';
  if (Array.isArray(v)) return v.length === 0;
  return false;
}

function normalize(donnees = {}) {
  const out = {};
  const missing = [];
  for (const s of SECTIONS) {
    const src = (donnees && donnees[s.key]) || {};
    out[s.key] = {};
    for (const f of s.fields) {
      let v = src[f.key];
      if (f.type === 'list') v = Array.isArray(v) ? v.map((x) => String(x).slice(0, 2000)).filter((x) => x.trim()) : [];
      else if (f.type === 'table') v = Array.isArray(v) ? v.slice(0, 300).map((r) => Object.fromEntries(f.columns.map((c) => { const x = r ? r[c.key] : null; return [c.key, x === undefined || x === null || x === '' ? null : (c.type === 'number' ? Number(x) : String(x).slice(0, 2000))]; }))) : [];
      else if (f.type === 'number') v = v === '' || v === undefined || v === null || Number.isNaN(Number(v)) ? null : Number(v);
      else v = v === undefined || v === null ? (f.default || '') : String(v).slice(0, 50000);
      out[s.key][f.key] = v;
      if (f.required && isEmpty(v)) missing.push(`${s.numero}. ${s.label} — ${f.label}`);
    }
  }
  // Coût total calculé à partir du tableau des coûts
  const couts = out.cout.couts || [];
  const total = couts.reduce((sum, r) => sum + (Number(r.total) || ((Number(r.annee1) || 0) + (Number(r.annee2) || 0) + (Number(r.annee3) || 0))), 0);
  return { donnees: out, missing, coutTotal: Math.round(total * 100) / 100 };
}

module.exports = { SECTIONS, normalize };

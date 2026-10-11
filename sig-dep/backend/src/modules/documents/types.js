'use strict';
/**
 * Modèles des documents de service (formulaires guidés).
 * Le frontend construit les formulaires à partir de ces définitions ; le backend valide le contenu.
 * Types de champs : text, textarea, date, number, list (liste de lignes), table (colonnes).
 */
const TYPES = [
  {
    code: 'RAPPORT', libelle: 'Rapport', description: 'Rapport d’activités ou rapport d’étude.',
    sections: [
      { key: 'periode', label: 'Période couverte', type: 'text', required: true, help: 'Ex. : Septembre 2026, 3e trimestre 2026' },
      { key: 'introduction', label: 'Introduction', type: 'textarea', required: true },
      { key: 'activites_realisees', label: 'Activités réalisées', type: 'textarea', required: true },
      { key: 'resultats', label: 'Résultats obtenus', type: 'textarea' },
      { key: 'difficultes', label: 'Difficultés rencontrées', type: 'textarea' },
      { key: 'recommandations', label: 'Recommandations', type: 'list' },
      { key: 'conclusion', label: 'Conclusion', type: 'textarea', required: true },
    ],
  },
  {
    code: 'COMPTE_RENDU', libelle: 'Compte rendu', description: 'Compte rendu de réunion, de mission ou d’activité.',
    sections: [
      { key: 'date', label: 'Date', type: 'date', required: true },
      { key: 'lieu', label: 'Lieu', type: 'text', required: true },
      { key: 'participants', label: 'Participants', type: 'list', required: true },
      { key: 'ordre_du_jour', label: 'Ordre du jour', type: 'list' },
      { key: 'deroulement', label: 'Déroulement', type: 'textarea', required: true },
      { key: 'decisions', label: 'Décisions et recommandations', type: 'list' },
    ],
  },
  {
    code: 'NOTE_TECHNIQUE', libelle: 'Note technique', description: 'Analyse technique d’une question à l’attention de l’autorité.',
    sections: [
      { key: 'destinataire', label: 'À l’attention de', type: 'text', required: true },
      { key: 'contexte', label: 'Contexte', type: 'textarea', required: true },
      { key: 'analyse', label: 'Analyse', type: 'textarea', required: true },
      { key: 'propositions', label: 'Propositions', type: 'list', required: true },
    ],
  },
  {
    code: 'NOTE_EXPLICATIVE', libelle: 'Note explicative', description: 'Explication d’une décision, d’un texte ou d’une situation.',
    sections: [
      { key: 'destinataire', label: 'À l’attention de', type: 'text', required: true },
      { key: 'objet_explication', label: 'Objet de l’explication', type: 'textarea', required: true },
      { key: 'explications', label: 'Explications', type: 'textarea', required: true },
      { key: 'conclusion', label: 'Conclusion', type: 'textarea' },
    ],
  },
  {
    code: 'FICHE_PROJET', libelle: 'Fiche projet', description: 'Présentation synthétique d’un projet.',
    sections: [
      { key: 'intitule', label: 'Intitulé du projet', type: 'text', required: true },
      { key: 'contexte', label: 'Contexte et justification', type: 'textarea', required: true },
      { key: 'objectifs', label: 'Objectifs', type: 'list', required: true },
      { key: 'activites', label: 'Activités principales', type: 'list' },
      { key: 'duree_mois', label: 'Durée (mois)', type: 'number' },
      { key: 'budget', label: 'Budget estimatif (USD)', type: 'number' },
      { key: 'responsable', label: 'Structure responsable', type: 'text' },
    ],
  },
  {
    code: 'PLAN_ACTIONS', libelle: 'Plan d’actions', description: 'Programmation des actions avec responsables, échéances et indicateurs.',
    sections: [
      { key: 'periode', label: 'Période', type: 'text', required: true },
      { key: 'objectif_general', label: 'Objectif général', type: 'textarea', required: true },
      { key: 'actions', label: 'Actions', type: 'table', required: true, columns: [
        { key: 'action', label: 'Action' }, { key: 'responsable', label: 'Responsable' }, { key: 'echeance', label: 'Échéance', type: 'date' },
        { key: 'indicateur', label: 'Indicateur' }, { key: 'budget', label: 'Budget (USD)', type: 'number' }, { key: 'statut', label: 'Statut' },
      ] },
    ],
  },
  {
    code: 'FICHE_SUIVI_EVALUATION', libelle: 'Fiche de suivi-évaluation', description: 'Suivi des indicateurs d’un projet ou programme.',
    sections: [
      { key: 'projet', label: 'Projet / programme suivi', type: 'text', required: true },
      { key: 'periode', label: 'Période de suivi', type: 'text', required: true },
      { key: 'indicateurs', label: 'Indicateurs', type: 'table', required: true, columns: [
        { key: 'activite', label: 'Activité' }, { key: 'indicateur', label: 'Indicateur' }, { key: 'cible', label: 'Cible', type: 'number' },
        { key: 'realise', label: 'Réalisé', type: 'number' }, { key: 'taux', label: 'Taux (%)', type: 'number' }, { key: 'observations', label: 'Observations' },
      ] },
      { key: 'analyse', label: 'Analyse des écarts', type: 'textarea' },
      { key: 'recommandations', label: 'Recommandations', type: 'list' },
    ],
  },
  {
    code: 'PROCES_VERBAL', libelle: 'Procès-verbal', description: 'Procès-verbal de réunion ou de séance.',
    sections: [
      { key: 'date', label: 'Date de la séance', type: 'date', required: true },
      { key: 'lieu', label: 'Lieu', type: 'text', required: true },
      { key: 'president', label: 'Président de séance', type: 'text', required: true },
      { key: 'presents', label: 'Membres présents', type: 'list', required: true },
      { key: 'ordre_du_jour', label: 'Ordre du jour', type: 'list', required: true },
      { key: 'deliberations', label: 'Délibérations', type: 'textarea', required: true },
      { key: 'resolutions', label: 'Résolutions', type: 'list' },
    ],
  },
  {
    code: 'LETTRE_TRANSMISSION', libelle: 'Lettre de transmission', description: 'Lettre accompagnant la transmission de documents.',
    sections: [
      { key: 'destinataire', label: 'Destinataire', type: 'text', required: true },
      { key: 'objet', label: 'Objet', type: 'text', required: true },
      { key: 'references', label: 'Références', type: 'text' },
      { key: 'corps', label: 'Corps de la lettre', type: 'textarea', required: true },
      { key: 'pieces', label: 'Pièces transmises', type: 'list' },
    ],
  },
  {
    code: 'COMMUNIQUE_SERVICE', libelle: 'Communiqué de service', description: 'Communication interne à l’ensemble ou à une partie du personnel.',
    sections: [
      { key: 'destinataires', label: 'Destinataires', type: 'text', required: true },
      { key: 'objet', label: 'Objet', type: 'text', required: true },
      { key: 'message', label: 'Message', type: 'textarea', required: true },
    ],
  },
];

const BY_CODE = Object.fromEntries(TYPES.map((t) => [t.code, t]));

function isEmpty(v) {
  if (v === undefined || v === null) return true;
  if (typeof v === 'string') return v.trim() === '';
  if (Array.isArray(v)) return v.length === 0;
  return false;
}

/** Nettoie le contenu selon le modèle et retourne la liste des champs requis manquants. */
function normalize(code, contenu = {}) {
  const t = BY_CODE[code];
  const out = {};
  const missing = [];
  for (const s of t.sections) {
    let v = contenu[s.key];
    if (s.type === 'list') v = Array.isArray(v) ? v.map((x) => String(x).slice(0, 2000)).filter((x) => x.trim()) : [];
    else if (s.type === 'table') v = Array.isArray(v) ? v.slice(0, 500).map((r) => Object.fromEntries(s.columns.map((c) => [c.key, r && r[c.key] !== undefined && r[c.key] !== null ? (c.type === 'number' ? (r[c.key] === '' ? null : Number(r[c.key])) : String(r[c.key]).slice(0, 2000)) : null]))) : [];
    else if (s.type === 'number') v = v === '' || v === undefined || v === null ? null : Number(v);
    else v = v === undefined || v === null ? '' : String(v).slice(0, 50000);
    if (s.type === 'number' && Number.isNaN(v)) v = null;
    out[s.key] = v;
    if (s.required && isEmpty(v)) missing.push(s.label);
  }
  return { contenu: out, missing };
}

module.exports = { TYPES, BY_CODE, normalize };

'use strict';
/**
 * Modèles des documents de service (formulaires guidés).
 * Le frontend construit les formulaires à partir de ces définitions ; le backend valide le contenu.
 * Types de champs : text, textarea, date, number, select (options), list (liste de lignes), table (colonnes).
 * `default` : valeur proposée à la création ; `ancien` : rubrique d’un modèle antérieur, affichée seulement
 * si elle est renseignée ; `correspondance` : document numéroté à la signature et mis en page en lettre.
 */
// Signataires des correspondances : le Secrétaire Général emploie la variante d’en-tête du Secrétariat Général.
const SIGNATAIRES = ['Directeur', 'Secrétaire Général'];

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
    code: 'NOTE_EXPLICATIVE', libelle: 'Note explicative', correspondance: true,
    description: 'Note à l’attention d’une autorité (par exemple le Ministre), signée par le Secrétaire Général ou le Directeur ; numérotée à la signature.',
    sections: [
      { key: 'signataire', label: 'Signataire', type: 'select', options: SIGNATAIRES, required: true, default: 'Secrétaire Général', help: 'Le Secrétaire Général : en-tête du Secrétariat Général et référence « …/SG/… ».' },
      { key: 'destinataire', label: 'À l’attention de', type: 'text', required: true, default: 'Son Excellence Monsieur le Ministre de l’Économie Numérique' },
      { key: 'concerne', label: 'Concerne', type: 'text', required: true },
      { key: 'formule_appel', label: 'Formule d’appel', type: 'text', default: 'Excellence Monsieur le Ministre,' },
      { key: 'corps', label: 'Corps de la note', type: 'textarea', required: true },
      { key: 'formule_finale', label: 'Formule finale', type: 'text', default: 'Vos instructions m’obligeraient. Haute considération.' },
      { key: 'signataire_nom', label: 'Nom du signataire', type: 'text' },
      { key: 'copies', label: 'Transmis copie pour information à', type: 'list', help: 'Une ligne par destinataire, avec sa formule de politesse.' },
      { key: 'annexes', label: 'Annexes', type: 'list' },
      // Rubriques de l’ancien modèle, affichées seulement si elles sont renseignées
      { key: 'objet_explication', label: 'Objet de l’explication', type: 'textarea', ancien: true },
      { key: 'explications', label: 'Explications', type: 'textarea', ancien: true },
      { key: 'conclusion', label: 'Conclusion', type: 'textarea', ancien: true },
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
    code: 'LETTRE_TRANSMISSION', libelle: 'Lettre de transmission', correspondance: true,
    description: 'Lettre accompagnant la transmission de documents ; numérotée à la signature.',
    sections: [
      { key: 'signataire', label: 'Signataire', type: 'select', options: SIGNATAIRES, required: true, default: 'Directeur' },
      { key: 'destinataire', label: 'Destinataire', type: 'text', required: true, help: 'Titre du destinataire, par exemple « Monsieur le Secrétaire Général au Numérique ».' },
      { key: 'adresse', label: 'Adresse', type: 'text', default: 'à Kinshasa/Gombe' },
      { key: 'objet', label: 'Objet', type: 'text', required: true },
      { key: 'references', label: 'Références', type: 'text' },
      { key: 'formule_appel', label: 'Formule d’appel', type: 'text', default: 'Monsieur le Secrétaire Général,' },
      { key: 'corps', label: 'Corps de la lettre', type: 'textarea', required: true },
      { key: 'formule_finale', label: 'Formule finale', type: 'text', default: 'Veuillez agréer, Monsieur le Secrétaire Général, l’expression de ma haute considération.' },
      { key: 'signataire_nom', label: 'Nom du signataire', type: 'text' },
      { key: 'pieces', label: 'Pièces transmises (annexes)', type: 'list' },
      { key: 'copies', label: 'Transmis copie pour information à', type: 'list', help: 'Une ligne par destinataire, avec sa formule de politesse.' },
    ],
  },
  {
    code: 'COMMUNIQUE_SERVICE', libelle: 'Communiqué de service', correspondance: true,
    description: 'Communication interne à l’ensemble ou à une partie du personnel, émise par le Secrétariat de Direction ; numérotée à la validation.',
    sections: [
      { key: 'destinataires', label: 'Destinataires', type: 'text', required: true },
      { key: 'objet', label: 'Objet', type: 'text', required: true },
      { key: 'message', label: 'Message', type: 'textarea', required: true },
    ],
  },
  {
    code: 'TERMES_REFERENCE', libelle: 'Termes de référence',
    description: 'Termes de référence d’une étude, d’une mission ou de l’élaboration d’un document de stratégie, conduite par phases.',
    sections: [
      { key: 'date_document', label: 'Date du document', type: 'text', help: 'Par exemple « Mars 2026 ».' },
      { key: 'contexte', label: 'Contexte et justification', type: 'textarea', required: true },
      { key: 'objectif_general', label: 'Objectif général', type: 'textarea', required: true },
      { key: 'objectifs_specifiques', label: 'Objectifs spécifiques', type: 'list', required: true },
      { key: 'mission', label: 'Mission et rôles des intervenants', type: 'textarea' },
      { key: 'contenu_attendu', label: 'Contenu attendu', type: 'textarea' },
      {
        key: 'phases', label: 'Méthodologie par phases', type: 'table',
        columns: [{ key: 'phase', label: 'Phase' }, { key: 'objectifs', label: 'Objectifs' }, { key: 'activites', label: 'Activités' }, { key: 'livrables', label: 'Livrables' }],
      },
      { key: 'livrables', label: 'Livrables', type: 'list' },
      { key: 'duree', label: 'Durée et chronogramme', type: 'textarea' },
      { key: 'budget', label: 'Budget et ressources', type: 'textarea' },
      { key: 'lieu', label: 'Fait à', type: 'text', default: 'Kinshasa' },
    ],
  },
];

/**
 * Étapes du formulaire guidé (même mode de remplissage que la fiche PIP) : chaque étape regroupe des
 * rubriques ; l’interface ajoute une dernière étape de contrôle. La correspondance est en version
 * courte (trois étapes) avec aperçu de la lettre.
 */
const ETAPES = {
  RAPPORT: [['Cadre du rapport', ['periode', 'introduction']], ['Réalisations', ['activites_realisees', 'resultats']], ['Difficultés et suite', ['difficultes', 'recommandations', 'conclusion']]],
  COMPTE_RENDU: [['Réunion', ['date', 'lieu', 'participants', 'ordre_du_jour']], ['Déroulement et décisions', ['deroulement', 'decisions']]],
  NOTE_TECHNIQUE: [['Destinataire et contexte', ['destinataire', 'contexte']], ['Analyse et propositions', ['analyse', 'propositions']]],
  NOTE_EXPLICATIVE: [['Destinataire et objet', ['signataire', 'destinataire', 'concerne']], ['Corps de la note', ['formule_appel', 'corps', 'formule_finale', 'objet_explication', 'explications', 'conclusion']], ['Signature et copies', ['signataire_nom', 'annexes', 'copies']]],
  FICHE_PROJET: [['Projet', ['intitule', 'contexte', 'objectifs']], ['Mise en œuvre', ['activites', 'duree_mois', 'budget', 'responsable']]],
  PLAN_ACTIONS: [['Cadre', ['periode', 'objectif_general']], ['Actions', ['actions']]],
  FICHE_SUIVI_EVALUATION: [['Projet suivi', ['projet', 'periode']], ['Indicateurs', ['indicateurs']], ['Analyse', ['analyse', 'recommandations']]],
  PROCES_VERBAL: [['Séance', ['date', 'lieu', 'president', 'presents', 'ordre_du_jour']], ['Délibérations', ['deliberations', 'resolutions']]],
  LETTRE_TRANSMISSION: [['Destinataire et objet', ['signataire', 'destinataire', 'adresse', 'objet', 'references']], ['Corps de la lettre', ['formule_appel', 'corps', 'formule_finale']], ['Signature, pièces et copies', ['signataire_nom', 'pieces', 'copies']]],
  COMMUNIQUE_SERVICE: [['Destinataires et objet', ['destinataires', 'objet']], ['Message', ['message']]],
  TERMES_REFERENCE: [['Contexte et objectifs', ['date_document', 'contexte', 'objectif_general', 'objectifs_specifiques']], ['Mission et phases', ['mission', 'contenu_attendu', 'phases']], ['Livrables et moyens', ['livrables', 'duree', 'budget', 'lieu']]],
};
for (const t of TYPES) {
  const def = ETAPES[t.code] || [['Contenu', t.sections.map((x) => x.key)]];
  const vues = new Set(def.flatMap(([, cles]) => cles));
  t.etapes = def.map(([label, cles], i) => ({ numero: i + 1, label, cles: cles.filter((k) => t.sections.some((x) => x.key === k)) }));
  // Rubrique non classée : dernière étape (aucune rubrique ne doit disparaître du formulaire)
  t.etapes[t.etapes.length - 1].cles.push(...t.sections.filter((x) => !vues.has(x.key)).map((x) => x.key));
}

const BY_CODE = Object.fromEntries(TYPES.map((t) => [t.code, t]));

function isEmpty(v) {
  if (v === undefined || v === null) return true;
  if (typeof v === 'string') return v.trim() === '';
  if (Array.isArray(v)) return v.length === 0;
  return false;
}

/** Nettoie le contenu selon le modèle et retourne la liste des champs requis manquants. */
function normalize(code, contenu = {}, { defauts = false } = {}) {
  const t = BY_CODE[code];
  const out = {};
  const missing = [];
  for (const s of t.sections) {
    let v = contenu[s.key];
    if (defauts && v === undefined && s.default !== undefined) v = s.default; // à la création seulement
    if (s.type === 'select') v = v === undefined || v === null || v === '' ? '' : (s.options.includes(String(v)) ? String(v) : '');
    else if (s.type === 'list') v = Array.isArray(v) ? v.map((x) => String(x).slice(0, 2000)).filter((x) => x.trim()) : [];
    else if (s.type === 'table') v = Array.isArray(v) ? v.slice(0, 500).map((r) => Object.fromEntries(s.columns.map((c) => [c.key, r && r[c.key] !== undefined && r[c.key] !== null ? (c.type === 'number' ? (r[c.key] === '' ? null : Number(r[c.key])) : String(r[c.key]).slice(0, 2000)) : null]))) : [];
    else if (s.type === 'number') v = v === '' || v === undefined || v === null ? null : Number(v);
    else v = v === undefined || v === null ? '' : String(v).slice(0, 50000);
    if (s.type === 'number' && Number.isNaN(v)) v = null;
    out[s.key] = v;
    if (s.required && isEmpty(v)) missing.push(s.label);
  }
  return { contenu: out, missing };
}

/** Variante d’en-tête d’une correspondance : 'SG' si signée par le Secrétaire Général. */
const variante = (t, contenu = {}) => (t.correspondance && contenu.signataire === 'Secrétaire Général' ? 'SG' : 'DEP');

module.exports = { TYPES, BY_CODE, normalize, variante, SIGNATAIRES };

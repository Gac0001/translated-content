'use strict';

/**
 * Données initiales de l’organigramme de la Direction d’Études et Planification.
 * Les intitulés des Divisions et Bureaux sont modifiables depuis l’application
 * (module Organisation) pour refléter le cadre organique officiel en vigueur.
 */
const DIRECTION = {
  code: 'DEP',
  code_organique: '5.3.3',
  sigle: 'DEP',
  nom: 'Direction d’Études et Planification',
  autorite_tutelle: 'Secrétariat Général au Numérique',
  missions: 'La Direction d’Études et Planification (DEP) est chargée de conduire les études, la planification, la programmation des investissements, le suivi-évaluation et la production statistique du Secrétariat Général au Numérique.',
};

const SECRETARIAT = {
  code: 'BSD',
  code_organique: '5.3.3.0',
  nom: 'Bureau Secrétariat de Direction',
  missions: 'Assurer le secrétariat du Directeur, l’enregistrement et la circulation des courriers, le suivi administratif du personnel et des présences, ainsi que la préparation des dossiers soumis au Directeur.',
  attributions: [
    'Réceptionner, enregistrer et faire circuler les courriers entrants et sortants de la DEP',
    'Tenir l’agenda et le secrétariat du Directeur',
    'Préparer les listes de présences hebdomadaires sur instruction du Directeur',
    'Assurer le suivi administratif du personnel de la DEP',
    'Préparer les comptes utilisateurs sur instruction du Directeur',
    'Transmettre les dossiers au Directeur et suivre ses instructions',
    'Assurer le classement et l’archivage des documents de la Direction',
  ],
};

/**
 * Structure réelle de la DEP (liste officielle des agents, 2026) : trois Divisions de deux Bureaux.
 * Les missions et attributions ci-dessous sont déduites des intitulés et restent À VALIDER
 * par le Directeur au regard du cadre organique officiel (modifiables dans l’application).
 */
const DIVISIONS = [
  {
    code: 'DIV-EDI',
    code_organique: '5.3.3.1',
    nom: 'Division Études, Documentation et Information',
    missions: 'Conduire les études et analyses du secteur de l’économie numérique, gérer la documentation et diffuser l’information de la Direction.',
    attributions: [
      'Réaliser les études, analyses et travaux prospectifs de la Direction',
      'Constituer et gérer le fonds documentaire de la DEP',
      'Assurer la collecte, le traitement et la diffusion de l’information',
    ],
    bureaux: [
      { code: 'BUR-EAP', code_organique: '5.3.3.1.1', nom: 'Bureau Études, Analyses et Prospective', missions: 'Réaliser les études, analyses et travaux de prospective.', attributions: ['Conception et réalisation des études', 'Analyses sectorielles et notes de conjoncture', 'Travaux de prospective'] },
      { code: 'BUR-DOI', code_organique: '5.3.3.1.2', nom: 'Bureau Documentation et Information', missions: 'Gérer la documentation et l’information de la Direction.', attributions: ['Tenue du fonds documentaire', 'Collecte et diffusion de l’information', 'Archivage des publications et rapports'] },
    ],
  },
  {
    code: 'DIV-SCI',
    code_organique: '5.3.3.2',
    nom: 'Division Stratégies et Coopération Internationale',
    missions: 'Élaborer les stratégies du secteur et suivre la coopération internationale.',
    attributions: [
      'Élaborer et actualiser les stratégies sectorielles',
      'Suivre les accords et programmes de coopération internationale',
      'Préparer la participation de la DEP aux rencontres avec les partenaires',
    ],
    bureaux: [
      { code: 'BUR-STR', code_organique: '5.3.3.2.1', nom: 'Bureau Stratégies', missions: 'Élaborer et suivre les stratégies du secteur.', attributions: ['Élaboration des documents de stratégie', 'Suivi de la mise en œuvre des stratégies', 'Préparation des plans d’actions'] },
      { code: 'BUR-COI', code_organique: '5.3.3.2.2', nom: 'Bureau Coopération Internationale', missions: 'Suivre la coopération bilatérale et multilatérale.', attributions: ['Suivi des accords de coopération', 'Relations avec les partenaires techniques et financiers', 'Préparation des dossiers de coopération'] },
    ],
  },
  {
    code: 'DIV-PS',
    code_organique: '5.3.3.3',
    nom: 'Division Programme et Suivi',
    missions: 'Programmer les activités et investissements et en assurer le suivi-évaluation.',
    attributions: [
      'Préparer la programmation des activités et des investissements (PIP)',
      'Assurer le suivi-évaluation des programmes et projets',
      'Produire les rapports périodiques de performance',
    ],
    bureaux: [
      { code: 'BUR-PRG', code_organique: '5.3.3.3.1', nom: 'Bureau Programme', missions: 'Préparer la programmation des activités et des investissements.', attributions: ['Élaboration des programmes d’activités', 'Préparation des fiches de projets PIP', 'Suivi de la programmation budgétaire'] },
      { code: 'BUR-SEV', code_organique: '5.3.3.3.2', nom: 'Bureau Suivi-Évaluation', missions: 'Suivre et évaluer l’exécution des programmes et projets.', attributions: ['Élaboration des fiches de suivi-évaluation', 'Missions de suivi', 'Rapports d’évaluation'] },
    ],
  },
];

const MISSIONS_DEP = [
  'Réaliser les études sectorielles et prospectives relatives à l’économie numérique',
  'Élaborer et suivre la planification stratégique et opérationnelle du Secrétariat Général',
  'Préparer et suivre le Programme d’Investissements Publics (PIP) du secteur',
  'Assurer le suivi-évaluation des politiques, programmes et projets',
  'Produire et diffuser les statistiques sectorielles',
  'Coordonner l’élaboration des rapports d’activités de la Direction',
];

const RESPONSABILITES = {
  DIRECTEUR: [
    'Diriger, coordonner et contrôler l’ensemble des activités de la Direction d’Études et Planification',
    'Superviser les Divisions et le Bureau Secrétariat de Direction',
    'Adresser les instructions aux Chefs de Division et au Chef du Bureau Secrétariat de Direction',
    'Valider les documents, rapports et fiches PIP de la Direction',
    'Rendre compte au Secrétaire Général',
  ],
  CHEF_DIVISION: [
    'Organiser, coordonner et contrôler les activités de la Division',
    'Adresser les instructions aux Chefs de Bureau de la Division',
    'Examiner et valider au niveau de la Division les travaux des Bureaux',
    'Rendre compte au Directeur',
  ],
  CHEF_BUREAU: [
    'Organiser les activités du Bureau et répartir les tâches entre les Agents',
    'Contrôler les présences et suivre l’exécution des tâches',
    'Examiner les travaux des Agents et les transmettre au supérieur hiérarchique direct',
    'Rendre compte au supérieur hiérarchique direct (Chef de Division, ou Directeur pour le Bureau Secrétariat de Direction)',
  ],
  AGENT: [
    'Exécuter les tâches confiées par le Chef de Bureau',
    'Rédiger les projets de documents et rendre compte de l’avancement',
    'Respecter la chaîne hiérarchique',
  ],
};

const GRADES = [
  { code: 'SG', libelle: 'Secrétaire Général', categorie: 'Haut cadre', niveau: 100 },
  { code: 'DIR', libelle: 'Directeur', categorie: 'Haut cadre', niveau: 90 },
  { code: 'CD', libelle: 'Chef de Division', categorie: 'Haut cadre', niveau: 80 },
  { code: 'CB', libelle: 'Chef de Bureau', categorie: 'Cadre de collaboration', niveau: 70 },
  { code: 'ATA1', libelle: 'Attaché d’Administration de 1re classe', categorie: 'Cadre de collaboration', niveau: 60 },
  { code: 'ATA2', libelle: 'Attaché d’Administration de 2e classe', categorie: 'Cadre de collaboration', niveau: 50 },
  { code: 'AGA1', libelle: 'Agent d’Administration de 1re classe', categorie: 'Agent d’exécution', niveau: 40 },
  { code: 'AGA2', libelle: 'Agent d’Administration de 2e classe', categorie: 'Agent d’exécution', niveau: 30 },
  { code: 'AA1', libelle: 'Agent Auxiliaire de 1re classe', categorie: 'Agent d’exécution', niveau: 20 },
  { code: 'AA2', libelle: 'Agent Auxiliaire de 2e classe', categorie: 'Agent d’exécution', niveau: 10 },
];

const FONCTIONS = [
  { code: 'F-SG', libelle: 'Secrétaire Général', grade: 'SG' },
  { code: 'F-DIR', libelle: 'Directeur', grade: 'DIR' },
  { code: 'F-CD', libelle: 'Chef de Division', grade: 'CD' },
  { code: 'F-CB', libelle: 'Chef de Bureau', grade: 'CB' },
  { code: 'F-CE', libelle: 'Chargé d’études', grade: 'ATA1' },
  { code: 'F-ANA', libelle: 'Analyste', grade: 'ATA2' },
  { code: 'F-STAT', libelle: 'Statisticien', grade: 'ATA2' },
  { code: 'F-SEC', libelle: 'Secrétaire de direction', grade: 'AGA1' },
  { code: 'F-ASS', libelle: 'Assistant administratif', grade: 'AGA2' },
  { code: 'F-AGA', libelle: 'Agent administratif', grade: 'AGA1' },
  { code: 'F-HUI', libelle: 'Huissier', grade: 'AA1' },
  { code: 'F-AUX', libelle: 'Agent auxiliaire', grade: 'AA2' },
];

module.exports = { DIRECTION, SECRETARIAT, DIVISIONS, MISSIONS_DEP, RESPONSABILITES, GRADES, FONCTIONS };

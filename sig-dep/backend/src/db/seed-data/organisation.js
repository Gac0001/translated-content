'use strict';

/**
 * Données initiales de l’organigramme de la Direction d’Études et Planification.
 * Les intitulés des Divisions et Bureaux sont modifiables depuis l’application
 * (module Organisation) pour refléter le cadre organique officiel en vigueur.
 */
const DIRECTION = {
  code: 'DEP',
  sigle: 'DEP',
  nom: 'Direction d’Études et Planification',
  autorite_tutelle: 'Secrétariat Général à l’Économie Numérique',
  missions: 'La Direction d’Études et Planification (DEP) est chargée de conduire les études, la planification, la programmation des investissements, le suivi-évaluation et la production statistique du Secrétariat Général à l’Économie Numérique.',
};

const SECRETARIAT = {
  code: 'BSD',
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

const DIVISIONS = [
  {
    code: 'DIV-EP',
    nom: 'Division des Études et Prospective',
    missions: 'Réaliser les études sectorielles, économiques et prospectives relatives à l’économie numérique.',
    attributions: [
      'Conduire les études sectorielles et thématiques du secteur numérique',
      'Assurer la veille technologique, économique et réglementaire',
      'Élaborer des notes d’analyse et des scénarios prospectifs',
    ],
    bureaux: [
      { code: 'BUR-EST', nom: 'Bureau Études Sectorielles', missions: 'Réaliser les études sectorielles et d’impact du numérique.', attributions: ['Conception et réalisation des études sectorielles', 'Analyse des données économiques du secteur', 'Rédaction des rapports d’étude'] },
      { code: 'BUR-VTP', nom: 'Bureau Veille Technologique et Prospective', missions: 'Assurer la veille et l’analyse prospective.', attributions: ['Veille technologique et réglementaire', 'Production de notes de conjoncture', 'Analyse prospective des tendances du numérique'] },
    ],
  },
  {
    code: 'DIV-PP',
    nom: 'Division de la Planification et Programmation',
    missions: 'Élaborer les plans stratégiques et opérationnels et programmer les investissements publics du secteur.',
    attributions: [
      'Élaborer et actualiser les plans stratégiques et plans d’actions',
      'Préparer le Programme d’Investissements Publics (PIP) du secteur',
      'Participer à la préparation budgétaire',
    ],
    bureaux: [
      { code: 'BUR-PLS', nom: 'Bureau Planification Stratégique', missions: 'Élaborer les documents de planification.', attributions: ['Élaboration des plans stratégiques', 'Préparation des plans d’actions annuels', 'Cadrage des priorités sectorielles'] },
      { code: 'BUR-PIP', nom: 'Bureau Programmation des Investissements', missions: 'Préparer et suivre les fiches de projets PIP.', attributions: ['Élaboration des fiches de projets PIP', 'Suivi de la programmation des investissements', 'Relations avec le Ministère du Plan'] },
    ],
  },
  {
    code: 'DIV-SES',
    nom: 'Division du Suivi-Évaluation et Statistiques',
    missions: 'Assurer le suivi-évaluation des programmes et projets et produire les statistiques du secteur.',
    attributions: [
      'Suivre et évaluer l’exécution des plans, programmes et projets',
      'Collecter, traiter et diffuser les statistiques sectorielles',
      'Élaborer les rapports périodiques de performance',
    ],
    bureaux: [
      { code: 'BUR-SEV', nom: 'Bureau Suivi-Évaluation', missions: 'Suivre et évaluer les projets et programmes.', attributions: ['Élaboration des fiches de suivi-évaluation', 'Missions de suivi sur le terrain', 'Rapports d’évaluation'] },
      { code: 'BUR-STA', nom: 'Bureau Statistiques et Bases de Données', missions: 'Produire les statistiques et administrer les bases de données.', attributions: ['Collecte et traitement des données statistiques', 'Tenue des bases de données sectorielles', 'Publication de l’annuaire statistique'] },
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
  { code: 'AGB', libelle: 'Agent Auxiliaire de 1re classe', categorie: 'Agent d’exécution', niveau: 20 },
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
  { code: 'F-HUI', libelle: 'Huissier', grade: 'AGB' },
];

module.exports = { DIRECTION, SECRETARIAT, DIVISIONS, MISSIONS_DEP, RESPONSABILITES, GRADES, FONCTIONS };

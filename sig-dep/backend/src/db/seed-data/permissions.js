'use strict';

/**
 * Catalogue des permissions et matrice rôles → permissions.
 * `reservee_division` : ne peut jamais être attribuée au Bureau Secrétariat de Direction ni à son Chef.
 * `delegable` : peut être déléguée par le Directeur au Chef du Bureau Secrétariat de Direction.
 */
const PERMISSIONS = [
  // Système (Admin technique)
  ['systeme.parametres', 'systeme', 'Gérer les paramètres du système'],
  ['systeme.etat', 'systeme', 'Consulter l’état technique du système'],
  ['systeme.sauvegardes', 'systeme', 'Organiser les sauvegardes'],
  ['audit.consulter', 'audit', 'Consulter le journal d’audit'],
  ['roles.gerer', 'comptes', 'Gérer les rôles et permissions'],
  // Comptes
  ['comptes.consulter', 'comptes', 'Consulter les comptes utilisateurs'],
  ['comptes.creer_initial', 'comptes', 'Créer les comptes institutionnels initiaux (Secrétaire Général, Directeur)'],
  ['comptes.enroler', 'comptes', 'Enrôler les agents de la liste déclarative validée (création des comptes)'],
  ['comptes.activer', 'comptes', 'Activer ou désactiver un compte'],
  ['comptes.reinitialiser', 'comptes', 'Réinitialiser un mot de passe'],
  ['comptes.deverrouiller', 'comptes', 'Déverrouiller un compte'],
  ['sessions.revoquer', 'comptes', 'Révoquer les sessions d’un utilisateur'],
  // Liste déclarative des agents
  ['liste.consulter', 'personnel', 'Consulter la liste déclarative des agents de la Direction'],
  ['liste.gerer', 'personnel', 'Constituer la liste déclarative (import, inscription, retrait)'],
  ['liste.valider', 'personnel', 'Valider la liste déclarative des agents de la Direction'],
  // Organisation et personnel
  ['organisation.consulter', 'organisation', 'Consulter l’organigramme et le cadre organique'],
  ['organisation.gerer', 'organisation', 'Gérer les structures de la DEP'],
  ['cadre.gerer', 'organisation', 'Gérer les missions, attributions et postes organiques'],
  ['personnel.consulter', 'personnel', 'Consulter les fiches du personnel du périmètre'],
  ['personnel.gerer', 'personnel', 'Créer et modifier les fiches du personnel'],
  ['personnel.suivre', 'personnel', 'Assurer le suivi administratif du personnel', { delegable: true }],
  ['affectations.gerer', 'personnel', 'Gérer les affectations'],
  ['delegations.gerer', 'personnel', 'Déléguer des opérations administratives au Bureau Secrétariat de Direction'],
  // Présences
  ['presences.consulter', 'presences', 'Consulter les présences du périmètre'],
  ['presences.saisir', 'presences', 'Créer et saisir les listes de présence du Bureau'],
  ['presences.preparer_direction', 'presences', 'Préparer les listes de présence de la Direction', { delegable: true }],
  ['presences.verifier', 'presences', 'Vérifier les listes de présence'],
  ['presences.soumettre', 'presences', 'Soumettre les listes de présence au Directeur'],
  ['presences.verrouiller', 'presences', 'Réceptionner et verrouiller les listes de présence'],
  // Courriers
  ['courriers.consulter', 'courriers', 'Consulter les courriers du périmètre'],
  ['courriers.enregistrer', 'courriers', 'Enregistrer les courriers entrants et sortants', { delegable: true }],
  ['courriers.transmettre', 'courriers', 'Transmettre un courrier dans la chaîne hiérarchique'],
  ['courriers.annoter', 'courriers', 'Annoter un courrier'],
  ['courriers.classer', 'courriers', 'Classer et archiver les courriers'],
  ['dossiers.transmettre', 'courriers', 'Transmettre les dossiers au Directeur', { delegable: true }],
  // Instructions et tâches
  ['instructions.consulter', 'instructions', 'Consulter les instructions du périmètre'],
  ['instructions.emettre', 'instructions', 'Adresser une instruction au subordonné direct'],
  ['instructions.executer', 'instructions', 'Exécuter une instruction reçue et en rendre compte'],
  ['instructions.valider', 'instructions', 'Valider ou retourner l’exécution d’une instruction émise'],
  ['taches.consulter', 'taches', 'Consulter les tâches du périmètre'],
  ['taches.attribuer', 'taches', 'Attribuer et valider les tâches des Agents du Bureau'],
  ['taches.executer', 'taches', 'Exécuter ses tâches et mettre à jour l’avancement'],
  // Documents
  ['documents.consulter', 'documents', 'Consulter les documents du périmètre'],
  ['documents.rediger', 'documents', 'Rédiger des projets de documents'],
  ['documents.examiner', 'documents', 'Examiner, retourner et transmettre les documents'],
  ['documents.valider_final', 'documents', 'Valider définitivement et signer les documents'],
  ['documents.archiver', 'documents', 'Archiver les documents'],
  // PIP
  ['pip.consulter', 'pip', 'Consulter les fiches PIP'],
  ['pip.rediger', 'pip', 'Rédiger une fiche PIP'],
  ['pip.verifier', 'pip', 'Vérifier une fiche PIP'],
  ['pip.valider', 'pip', 'Valider une fiche PIP'],
  ['pip.archiver', 'pip', 'Archiver une fiche PIP'],
  // Rapports
  ['rapports.consulter', 'rapports', 'Consulter les rapports et statistiques du périmètre'],
  ['exports.generer', 'rapports', 'Générer des exports PDF / Excel / Word'],
  ['supervision.globale', 'supervision', 'Supervision globale en lecture de la DEP'],
  // Réservées aux Divisions
  ['division.gerer', 'division', 'Gérer une Division', { reservee_division: true }],
  ['division.superviser', 'division', 'Superviser une Division et ses Bureaux', { reservee_division: true }],
  ['division.valider', 'division', 'Valider au niveau de la Division', { reservee_division: true }],
  ['chef_division.agir', 'division', 'Agir en qualité de Chef de Division', { reservee_division: true }],
];

const ROLES = [
  { code: 'ADMIN', libelle: 'Admin', perimetre_defaut: 'SYSTEME', description: 'Administrateur technique du système. Ne constitue pas une autorité administrative de la DEP.' },
  { code: 'SECRETAIRE_GENERAL', libelle: 'Secrétaire Général', perimetre_defaut: 'SUPERVISION_GLOBALE', description: 'Supervision globale et consultation. Adresse ses instructions exclusivement au Directeur.' },
  { code: 'DIRECTEUR', libelle: 'Directeur', perimetre_defaut: 'DIRECTION', description: 'Responsable administratif et opérationnel de la Direction d’Études et Planification.' },
  { code: 'CHEF_DIVISION', libelle: 'Chef de Division', perimetre_defaut: 'DIVISION', description: 'Autorité limitée à sa Division et aux Bureaux qui lui sont rattachés.' },
  { code: 'CHEF_BUREAU', libelle: 'Chef de Bureau', perimetre_defaut: 'BUREAU', description: 'Autorité limitée à son Bureau et à ses Agents.' },
  { code: 'AGENT', libelle: 'Agent', perimetre_defaut: 'PERSONNEL', description: 'Accès à ses activités et aux informations autorisées de son Bureau.' },
];

const MATRICE = {
  ADMIN: [
    'systeme.parametres', 'systeme.etat', 'systeme.sauvegardes', 'audit.consulter', 'roles.gerer',
    'comptes.consulter', 'comptes.creer_initial', 'comptes.activer', 'comptes.reinitialiser',
    'comptes.deverrouiller', 'sessions.revoquer', 'organisation.consulter',
    'comptes.enroler', 'liste.consulter', 'liste.gerer', 'liste.valider',
  ],
  SECRETAIRE_GENERAL: [
    'supervision.globale', 'organisation.consulter', 'personnel.consulter', 'presences.consulter',
    'courriers.consulter', 'instructions.consulter', 'instructions.emettre', 'instructions.valider',
    'taches.consulter', 'documents.consulter', 'pip.consulter', 'rapports.consulter', 'exports.generer',
  ],
  DIRECTEUR: [
    'organisation.consulter', 'organisation.gerer', 'cadre.gerer',
    'personnel.consulter', 'personnel.gerer', 'personnel.suivre', 'affectations.gerer', 'delegations.gerer',
    'comptes.consulter', 'comptes.activer', 'liste.consulter', 'liste.gerer', 'liste.valider',
    'presences.consulter', 'presences.verrouiller',
    'courriers.consulter', 'courriers.enregistrer', 'courriers.transmettre', 'courriers.annoter', 'courriers.classer',
    'dossiers.transmettre',
    'instructions.consulter', 'instructions.emettre', 'instructions.executer', 'instructions.valider',
    'taches.consulter',
    'documents.consulter', 'documents.rediger', 'documents.examiner', 'documents.valider_final', 'documents.archiver',
    'pip.consulter', 'pip.rediger', 'pip.verifier', 'pip.valider', 'pip.archiver',
    'rapports.consulter', 'exports.generer',
    'division.gerer', 'division.superviser', 'division.valider',
  ],
  CHEF_DIVISION: [
    'organisation.consulter', 'personnel.consulter',
    'presences.consulter', 'presences.verifier',
    'courriers.consulter', 'courriers.transmettre', 'courriers.annoter',
    'instructions.consulter', 'instructions.emettre', 'instructions.executer', 'instructions.valider',
    'taches.consulter',
    'documents.consulter', 'documents.rediger', 'documents.examiner',
    'pip.consulter', 'pip.rediger', 'pip.verifier',
    'rapports.consulter', 'exports.generer',
    'division.gerer', 'division.superviser', 'division.valider', 'chef_division.agir',
  ],
  CHEF_BUREAU: [
    'organisation.consulter', 'personnel.consulter',
    'presences.consulter', 'presences.saisir', 'presences.verifier', 'presences.soumettre',
    'courriers.consulter', 'courriers.transmettre', 'courriers.annoter',
    'instructions.consulter', 'instructions.executer',
    'taches.consulter', 'taches.attribuer',
    'documents.consulter', 'documents.rediger', 'documents.examiner',
    'pip.consulter', 'pip.rediger',
    'rapports.consulter', 'exports.generer',
  ],
  AGENT: [
    'organisation.consulter',
    'courriers.consulter',
    'instructions.consulter',
    'taches.consulter', 'taches.executer',
    'documents.consulter', 'documents.rediger',
    'pip.consulter', 'pip.rediger',
    'exports.generer',
  ],
};

module.exports = { PERMISSIONS, ROLES, MATRICE };

'use strict';

/** Appellation officielle — ne jamais utiliser une autre forme. */
const DEP_NOM = 'Direction d’Études et Planification';
const DEP_SIGLE = 'DEP';
const SG_NOM = 'Secrétariat Général à l’Économie Numérique';
const PAYS = 'République Démocratique du Congo';
const SECRETARIAT_CODE = 'BSD';
const SECRETARIAT_NOM = 'Bureau Secrétariat de Direction';

const ROLES = {
  ADMIN_SYSTEME: 'ADMIN_SYSTEME',
  SECRETAIRE_GENERAL: 'SECRETAIRE_GENERAL',
  DIRECTEUR: 'DIRECTEUR',
  CHEF_DIVISION: 'CHEF_DIVISION',
  CHEF_BUREAU: 'CHEF_BUREAU',
  AGENT: 'AGENT',
};

const ROLE_LIBELLES = {
  ADMIN_SYSTEME: 'Admin Système',
  SECRETAIRE_GENERAL: 'Secrétaire Général',
  DIRECTEUR: 'Directeur',
  CHEF_DIVISION: 'Chef de Division',
  CHEF_BUREAU: 'Chef de Bureau',
  AGENT: 'Agent',
};

/** Ordre de préséance des rôles fonctionnels (le plus élevé d’abord). */
const FUNCTIONAL_ORDER = ['SECRETAIRE_GENERAL', 'DIRECTEUR', 'CHEF_DIVISION', 'CHEF_BUREAU', 'AGENT'];

const PERIMETRES = {
  SYSTEME: 'SYSTEME',
  SUPERVISION_GLOBALE: 'SUPERVISION_GLOBALE',
  DIRECTION: 'DIRECTION',
  DIVISION: 'DIVISION',
  BUREAU: 'BUREAU',
  PERSONNEL: 'PERSONNEL',
};

/** Permissions réservées aux Divisions : jamais attribuables au Bureau Secrétariat de Direction ou à son Chef. */
const DIVISION_ONLY_PERMISSIONS = ['division.gerer', 'division.superviser', 'division.valider', 'chef_division.agir'];

/** Permissions que le Directeur peut déléguer au Chef du Bureau Secrétariat de Direction. */
const DELEGABLE_PERMISSIONS = [
  'personnel.suivre',
  'presences.preparer_direction',
  'courriers.enregistrer',
  'dossiers.transmettre',
];


const INSTRUCTION_STATUTS = ['BROUILLON', 'TRANSMISE', 'RECUE', 'EN_COURS', 'A_CORRIGER', 'EXECUTEE', 'VALIDEE', 'CLOTUREE', 'EN_RETARD'];

/** Règles de sécurité acceptées par l’Admin Système à la première connexion (version : paramètre regles_securite_version). */
const REGLES_SECURITE = [
  'Mes identifiants, mon application d’authentification et mes codes de secours sont strictement personnels : je ne les communique à personne et je ne les enregistre pas en clair.',
  'Je n’utilise le compte Admin Système que pour le fonctionnement technique, la sécurité et la disponibilité du SIG-DEP. Je n’exerce aucune autorité administrative et je n’agis jamais à la place du Directeur, d’un Chef de Division ou d’un Chef de Bureau.',
  'Je ne consulte pas les données métier (courriers, documents, dossiers du personnel) sans autorisation écrite du Directeur, limitée dans le temps et motivée.',
  'Je ne modifie l’organisation, les rôles ou les affectations que sur décision ou instruction du Directeur, référencée.',
  'Toutes mes actions sont tracées dans un journal d’audit infalsifiable que je ne peux ni modifier ni supprimer.',
  'Je verrouille ma session lorsque je quitte mon poste et je ne me connecte que depuis un poste de confiance.',
  'Je signale immédiatement au Directeur tout incident de sécurité, toute perte de mon téléphone d’authentification ou toute activité suspecte.',
  'Je vérifie régulièrement les sauvegardes et je n’effectue de restauration qu’avec la confirmation requise.',
];

module.exports = {
  REGLES_SECURITE,
  DEP_NOM, DEP_SIGLE, SG_NOM, PAYS, SECRETARIAT_CODE, SECRETARIAT_NOM,
  ROLES, ROLE_LIBELLES, FUNCTIONAL_ORDER, PERIMETRES,
  DIVISION_ONLY_PERMISSIONS, DELEGABLE_PERMISSIONS, INSTRUCTION_STATUTS,
};

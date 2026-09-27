'use strict';

/** Appellation officielle — ne jamais utiliser une autre forme. */
const DEP_NOM = 'Direction d’Études et Planification';
const DEP_SIGLE = 'DEP';
const SG_NOM = 'Secrétariat Général à l’Économie Numérique';
const PAYS = 'République Démocratique du Congo';
const SECRETARIAT_CODE = 'BSD';
const SECRETARIAT_NOM = 'Bureau Secrétariat de Direction';

const ROLES = {
  ADMIN: 'ADMIN',
  SECRETAIRE_GENERAL: 'SECRETAIRE_GENERAL',
  DIRECTEUR: 'DIRECTEUR',
  CHEF_DIVISION: 'CHEF_DIVISION',
  CHEF_BUREAU: 'CHEF_BUREAU',
  AGENT: 'AGENT',
};

const ROLE_LIBELLES = {
  ADMIN: 'Admin',
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

module.exports = {
  DEP_NOM, DEP_SIGLE, SG_NOM, PAYS, SECRETARIAT_CODE, SECRETARIAT_NOM,
  ROLES, ROLE_LIBELLES, FUNCTIONAL_ORDER, PERIMETRES,
  DIVISION_ONLY_PERMISSIONS, DELEGABLE_PERMISSIONS, INSTRUCTION_STATUTS,
};

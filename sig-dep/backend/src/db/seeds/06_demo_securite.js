'use strict';
/**
 * Seed 06 — Mode démonstration (DEMO_MODE=true uniquement, jamais en production) : les comptes à
 * double authentification obligatoire (Admin Système, Directeur, Secrétaire Général) reçoivent le
 * secret de démonstration, une adresse de récupération et l’acceptation des règles ; le compte
 * admin prend le mot de passe de démonstration. Le code courant s’affiche sur la page de connexion.
 */
const config = require('../../config/env');
const demo = require('../../services/demo');

exports.seed = async function seed(knex) {
  if (!config.demo || !config.seedDemo) return;
  await demo.preparerComptes(knex);
};

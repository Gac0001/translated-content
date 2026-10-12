'use strict';
/**
 * Mode démonstration (DEMO_MODE=true, jamais en production) : les comptes à double
 * authentification obligatoire (Admin Système, Directeur, Secrétaire Général, Chef du Bureau
 * Secrétariat de Direction) partagent un secret
 * TOTP connu, dont le code courant est affiché sur la page de connexion de démonstration.
 */
const { authenticator } = require('otplib');
const config = require('../config/env');
const { chiffrer } = require('./deuxFacteurs');

const SECRET_DEMO = 'SIGDEPDEMOFORMATIONKINSHASADEPAA';
const MOT_DE_PASSE = 'Demo@2026';
const ROLES_RENFORCES = ['ADMIN_SYSTEME', 'DIRECTEUR', 'SECRETAIRE_GENERAL'];

const codeActuel = () => authenticator.generate(SECRET_DEMO);
const secondesRestantes = () => 30 - (Math.floor(Date.now() / 1000) % 30);

/** Comptes des titulaires (et intérimaires) du poste de Chef du Bureau Secrétariat de Direction. */
function chefsSecretariat(knex) {
  return knex('users as u').join('affectations as a', 'a.agent_id', 'u.agent_id').join('postes_organiques as p', 'p.id', 'a.poste_id')
    .join('bureaux as b', 'b.id', 'p.bureau_id').where({ 'a.est_active': true, 'p.role_associe': 'CHEF_BUREAU', 'b.est_secretariat_direction': true })
    .distinct('u.id', 'u.username', 'u.email_recuperation');
}

/** Prépare les comptes à exigences renforcées : 2FA de démonstration, e-mail, règles acceptées. */
async function preparerComptes(knex) {
  if (!config.demo) return 0;
  const bcrypt = require('bcrypt');
  const version = (await require('./politique').politique(knex)).regles_securite_version;
  const ids = await knex('users as u').join('user_roles as ur', 'ur.user_id', 'u.id').join('roles as r', 'r.id', 'ur.role_id')
    .whereIn('r.code', ROLES_RENFORCES).distinct('u.id', 'u.username', 'u.email_recuperation');
  // Chef du Bureau Secrétariat de Direction (authentification renforcée, cahier § 23)
  const chefs = await chefsSecretariat(knex);
  for (const c of chefs) if (!ids.some((u) => u.id === c.id)) ids.push(c);
  for (const u of ids) {
    const patch = {
      totp_secret: chiffrer(SECRET_DEMO), totp_actif: true, totp_active_at: knex.fn.now(),
      email_recuperation: u.email_recuperation || `${u.username}@demo.sig-dep.cd`, regles_acceptees_version: version, regles_acceptees_at: knex.fn.now(),
    };
    if (u.username === 'admin') Object.assign(patch, { password_hash: await bcrypt.hash(MOT_DE_PASSE, 10), must_change_password: false, password_changed_at: knex.fn.now() });
    await knex('users').where({ id: u.id }).update(patch);
  }
  return ids.length;
}

module.exports = { SECRET_DEMO, MOT_DE_PASSE, codeActuel, secondesRestantes, preparerComptes, ROLES_RENFORCES, chefsSecretariat };

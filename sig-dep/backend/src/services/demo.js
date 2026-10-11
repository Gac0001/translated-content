'use strict';
/**
 * Mode démonstration (DEMO_MODE=true, jamais en production) : les comptes à double
 * authentification obligatoire (Admin Système, Directeur, Secrétaire Général) partagent un secret
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

/** Prépare les comptes à exigences renforcées : 2FA de démonstration, e-mail, règles acceptées. */
async function preparerComptes(knex) {
  if (!config.demo) return 0;
  const bcrypt = require('bcrypt');
  const version = (await require('./politique').politique(knex)).regles_securite_version;
  const ids = await knex('users as u').join('user_roles as ur', 'ur.user_id', 'u.id').join('roles as r', 'r.id', 'ur.role_id')
    .whereIn('r.code', ROLES_RENFORCES).distinct('u.id', 'u.username', 'u.email_recuperation');
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

module.exports = { SECRET_DEMO, MOT_DE_PASSE, codeActuel, secondesRestantes, preparerComptes, ROLES_RENFORCES };

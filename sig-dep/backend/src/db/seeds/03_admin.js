'use strict';
/**
 * Seed 03 — Compte Admin initial.
 * Nom d’utilisateur : admin — Mot de passe temporaire : dep@2026 (changement obligatoire).
 * N’écrase jamais un compte admin existant (utiliser `npm run reset-admin`).
 */
const bcrypt = require('bcrypt');

exports.seed = async function seed(knex) {
  const existing = await knex('users').where({ username: 'admin' }).first();
  if (existing) return;
  const hash = await bcrypt.hash('dep@2026', 12);
  const [u] = await knex('users').insert({
    username: 'admin', password_hash: hash, statut: 'ACTIF', must_change_password: true,
  }).returning('*');
  const role = await knex('roles').where({ code: 'ADMIN' }).first();
  await knex('user_roles').insert({ user_id: u.id, role_id: role.id });
  await knex('audit_logs').insert({
    username: 'système', role: 'SYSTEME', action: 'CREATION', module: 'comptes', entite: 'user',
    entite_id: String(u.id), resultat: 'SUCCES', message: 'Création du compte Admin initial',
  });
};

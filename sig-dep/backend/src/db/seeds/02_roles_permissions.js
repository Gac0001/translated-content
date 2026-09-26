'use strict';
/** Seed 02 — Rôles, permissions et matrice rôles → permissions. Idempotent. */
const { PERMISSIONS, ROLES, MATRICE } = require('../seed-data/permissions');

exports.seed = async function seed(knex) {
  for (const r of ROLES) {
    await knex('roles').insert(r).onConflict('code').merge(['libelle', 'perimetre_defaut', 'description']);
  }
  for (const [code, module, libelle, opts = {}] of PERMISSIONS) {
    await knex('permissions').insert({
      code, module, libelle, delegable: !!opts.delegable, reservee_division: !!opts.reservee_division,
    }).onConflict('code').merge();
  }
  const roles = Object.fromEntries((await knex('roles')).map((r) => [r.code, r.id]));
  const perms = Object.fromEntries((await knex('permissions')).map((p) => [p.code, p.id]));
  for (const [role, codes] of Object.entries(MATRICE)) {
    for (const c of codes) {
      if (!perms[c]) throw new Error(`Permission inconnue dans la matrice : ${c}`);
      await knex('role_permissions').insert({ role_id: roles[role], permission_id: perms[c] }).onConflict(['role_id', 'permission_id']).ignore();
    }
  }
};

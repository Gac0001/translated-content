'use strict';
/**
 * 1.5 — Réinitialisation de la base par l’Admin (mise en service) :
 *  - permission `systeme.reinitialiser` (Admin uniquement) ;
 *  - paramètre `donnees_demo` signalant la présence de données fictives ;
 *  - retrait des permissions de l’ancien circuit de création des comptes (1.4).
 */
exports.up = async function up(knex) {
  const [perm] = await knex('permissions')
    .insert({ code: 'systeme.reinitialiser', module: 'systeme', libelle: 'Réinitialiser la base de données (mise en service)', delegable: false, reservee_division: false })
    .onConflict('code').merge(['libelle']).returning('id');
  const admin = await knex('roles').where({ code: 'ADMIN' }).first();
  if (admin) await knex('role_permissions').insert({ role_id: admin.id, permission_id: perm.id }).onConflict(['role_id', 'permission_id']).ignore();

  const demo = !!(await knex('users').where({ username: 'ag.secretariat1' }).first());
  await knex('parametres').insert({ cle: 'donnees_demo', valeur: String(demo), libelle: 'La base contient des données fictives de démonstration' }).onConflict('cle').ignore();

  const obsoletes = await knex('permissions').whereIn('code', ['comptes.creer', 'comptes.preparer']).pluck('id');
  if (obsoletes.length) {
    await knex('role_permissions').whereIn('permission_id', obsoletes).del();
    await knex('user_permissions').whereIn('permission_id', obsoletes).del();
    await knex('permissions').whereIn('id', obsoletes).del();
  }
};

exports.down = async function down(knex) {
  const p = await knex('permissions').where({ code: 'systeme.reinitialiser' }).first();
  if (p) {
    await knex('role_permissions').where({ permission_id: p.id }).del();
    await knex('permissions').where({ id: p.id }).del();
  }
  await knex('parametres').where({ cle: 'donnees_demo' }).del();
};

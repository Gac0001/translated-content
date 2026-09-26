#!/usr/bin/env node
'use strict';
/**
 * Réinitialisation du compte Admin technique du SIG-DEP.
 *   npm run reset-admin                → mot de passe temporaire « dep@2026 »
 *   npm run reset-admin -- MonMotDePasse → mot de passe temporaire personnalisé
 * Le compte est réactivé, déverrouillé, ses sessions révoquées et le changement
 * de mot de passe est rendu obligatoire à la prochaine connexion. L’opération est auditée.
 */
const bcrypt = require('bcrypt');
const db = require('../src/db/knex');

(async () => {
  const password = process.argv[2] || 'dep@2026';
  try {
    const hash = await bcrypt.hash(password, 12);
    let user = await db('users').where({ username: 'admin' }).first();
    await db.transaction(async (trx) => {
      if (!user) {
        [user] = await trx('users').insert({ username: 'admin', password_hash: hash, statut: 'ACTIF', must_change_password: true }).returning('*');
      } else {
        await trx('users').where({ id: user.id }).update({
          password_hash: hash, statut: 'ACTIF', must_change_password: true, failed_attempts: 0, locked_until: null,
          token_version: trx.raw('token_version + 1'), updated_at: trx.fn.now(),
        });
        await trx('refresh_tokens').where({ user_id: user.id }).whereNull('revoked_at').update({ revoked_at: trx.fn.now(), revoked_reason: 'RESET_ADMIN' });
      }
      const role = await trx('roles').where({ code: 'ADMIN' }).first();
      if (!role) throw new Error('Rôle ADMIN absent : exécutez d’abord « npm run seed ».');
      await trx('user_roles').insert({ user_id: user.id, role_id: role.id }).onConflict(['user_id', 'role_id']).ignore();
      await trx('audit_logs').insert({ username: 'script', role: 'SYSTEME', action: 'REINITIALISATION_MDP', module: 'comptes', entite: 'user', entite_id: String(user.id), resultat: 'SUCCES', message: 'Réinitialisation du compte Admin par script' });
    });
    console.log('Compte Admin réinitialisé.');
    console.log('  Nom d’utilisateur : admin');
    console.log(`  Mot de passe temporaire : ${password}`);
    console.log('  Le changement du mot de passe sera exigé à la prochaine connexion.');
  } catch (e) {
    console.error('Échec de la réinitialisation :', e.message);
    process.exitCode = 1;
  } finally {
    await db.destroy();
  }
})();

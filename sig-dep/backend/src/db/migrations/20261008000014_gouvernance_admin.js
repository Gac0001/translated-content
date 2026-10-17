'use strict';
/**
 * 1.11 — Gouvernance du compte Admin Système (cahier des charges, § 12, étapes 1, 5 et 7) :
 *  - double confirmation des opérations critiques par le Directeur (réinitialisation de la base,
 *    politique de sécurité, migrations, permissions du rôle Admin Système) ;
 *  - accès de support temporaire, justifié, validé par le Directeur, limité dans le temps et audité ;
 *  - compte d’urgence séparé, scellé (désactivé, mot de passe inconnu), activé par le Directeur ou
 *    le Secrétaire Général pour une durée limitée, surveillé et refermé automatiquement.
 *
 * Les tables de gouvernance n’ont pas de clé étrangère vers les comptes : elles sont conservées
 * lors d’une réinitialisation de la base, comme le journal d’audit.
 */
const crypto = require('crypto');
const bcrypt = require('bcrypt');

const PERMISSIONS = [
  ['operations.confirmer', 'Confirmer ou refuser les opérations critiques de l’Admin Système', ['DIRECTEUR']],
  ['acces_support.demander', 'Demander un accès de support temporaire', ['ADMIN_SYSTEME']],
  ['acces_support.valider', 'Valider, refuser ou révoquer un accès de support', ['DIRECTEUR']],
  ['urgence.activer', 'Activer le compte d’urgence', ['DIRECTEUR', 'SECRETAIRE_GENERAL']],
  ['urgence.desactiver', 'Refermer le compte d’urgence', ['ADMIN_SYSTEME', 'DIRECTEUR', 'SECRETAIRE_GENERAL']],
];

exports.up = async function up(knex) {
  await knex.schema.createTable('demandes_confirmation', (t) => {
    t.increments('id');
    t.string('type', 30).notNullable(); // REINITIALISATION | POLITIQUE | MIGRATIONS | ROLE_ADMIN
    t.jsonb('parametres').notNullable().defaultTo('{}');
    t.string('resume', 1000).notNullable();
    t.text('motif');
    t.integer('demandeur_id').notNullable();
    t.string('demandeur', 60);
    t.string('statut', 12).notNullable().defaultTo('EN_ATTENTE'); // EN_ATTENTE | CONFIRMEE | REFUSEE | EXPIREE | EXECUTEE | ANNULEE
    t.integer('decideur_id');
    t.string('decideur', 60);
    t.timestamp('decide_at');
    t.text('commentaire');
    t.timestamp('expire_at').notNullable();
    t.timestamp('execute_at');
    t.timestamps(true, true);
    t.index(['type', 'statut']);
  });
  await knex.raw(`ALTER TABLE demandes_confirmation ADD CONSTRAINT demandes_confirmation_chk CHECK (
    type IN ('REINITIALISATION','POLITIQUE','MIGRATIONS','ROLE_ADMIN')
    AND statut IN ('EN_ATTENTE','CONFIRMEE','REFUSEE','EXPIREE','EXECUTEE','ANNULEE'))`);

  await knex.schema.createTable('acces_support', (t) => {
    t.increments('id');
    t.integer('demandeur_id').notNullable();
    t.string('demandeur', 60);
    t.text('motif').notNullable();
    t.string('entity_type', 20); // COURRIER | DOCUMENT | INSTRUCTION | TASK | PIP | ACTE ; NULL = toutes les pièces jointes
    t.integer('entity_id');
    t.integer('duree_minutes').notNullable();
    t.string('statut', 12).notNullable().defaultTo('EN_ATTENTE'); // EN_ATTENTE | ACTIF | REFUSE | TERMINE | EXPIRE | REVOQUE
    t.integer('decideur_id');
    t.string('decideur', 60);
    t.timestamp('decide_at');
    t.text('commentaire');
    t.timestamp('debut_at');
    t.timestamp('fin_at');
    t.integer('consultations').notNullable().defaultTo(0);
    t.timestamps(true, true);
    t.index(['demandeur_id', 'statut']);
  });
  await knex.raw(`ALTER TABLE acces_support ADD CONSTRAINT acces_support_chk CHECK (
    duree_minutes BETWEEN 15 AND 240
    AND statut IN ('EN_ATTENTE','ACTIF','REFUSE','TERMINE','EXPIRE','REVOQUE')
    AND (entity_id IS NULL OR entity_type IS NOT NULL))`);

  await knex.schema.createTable('activations_urgence', (t) => {
    t.increments('id');
    t.integer('active_par_id'); // NULL : procédure serveur (ligne de commande)
    t.string('active_par', 60).notNullable();
    t.text('motif').notNullable();
    t.timestamp('debut_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('fin_prevue_at').notNullable();
    t.timestamp('fin_at');
    t.string('ferme_par', 60);
    t.string('motif_fermeture', 200);
    t.integer('connexions').notNullable().defaultTo(0);
  });

  // Compte d’urgence : distinct du compte Admin, scellé (désactivé, mot de passe aléatoire inconnu).
  await knex.schema.alterTable('users', (t) => {
    t.boolean('compte_urgence').notNullable().defaultTo(false);
    t.timestamp('urgence_jusqua');
  });
  await knex.raw('CREATE UNIQUE INDEX users_un_compte_urgence ON users(compte_urgence) WHERE compte_urgence');
  const role = await knex('roles').where({ code: 'ADMIN_SYSTEME' }).first();
  if (!(await knex('users').where({ username: 'urgence' }).first())) {
    const [u] = await knex('users').insert({
      username: 'urgence', password_hash: await bcrypt.hash(crypto.randomBytes(32).toString('base64'), 12),
      statut: 'DESACTIVE', must_change_password: true, compte_urgence: true,
    }).returning('*');
    if (role) await knex('user_roles').insert({ user_id: u.id, role_id: role.id });
  }

  for (const [code, libelle, roles] of PERMISSIONS) {
    const [p] = await knex('permissions').insert({ code, module: 'gouvernance', libelle, delegable: false, reservee_division: false })
      .onConflict('code').merge().returning('*');
    for (const r of roles) {
      const ro = await knex('roles').where({ code: r }).first();
      if (ro) await knex('role_permissions').insert({ role_id: ro.id, permission_id: p.id }).onConflict(['role_id', 'permission_id']).ignore();
    }
  }
};

exports.down = async function down(knex) {
  const ids = await knex('permissions').whereIn('code', PERMISSIONS.map((p) => p[0])).pluck('id');
  await knex('role_permissions').whereIn('permission_id', ids).del();
  await knex('permissions').whereIn('id', ids).del();
  const u = await knex('users').where({ compte_urgence: true }).first();
  if (u) { await knex('user_roles').where({ user_id: u.id }).del(); await knex('users').where({ id: u.id }).del(); }
  await knex.schema.alterTable('users', (t) => { t.dropColumn('compte_urgence'); t.dropColumn('urgence_jusqua'); });
  await knex.schema.dropTableIfExists('activations_urgence');
  await knex.schema.dropTableIfExists('acces_support');
  await knex.schema.dropTableIfExists('demandes_confirmation');
};

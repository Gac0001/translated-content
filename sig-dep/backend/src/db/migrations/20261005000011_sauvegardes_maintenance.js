'use strict';
/**
 * 1.8 — Sauvegardes et maintenance (lot 3 du compte Admin Système) :
 *  - registre des sauvegardes enrichi : empreinte, chiffrement, copie hors serveur, palier de conservation ;
 *  - vérifications (intégrité, test de restauration) ;
 *  - demandes de restauration (demande Admin → validation Directeur → exécution) ;
 *  - annonces système ;
 *  - permission `sauvegarde.valider_restauration` (Directeur) ;
 *  - paramètres de planification, de conservation et de maintenance.
 */
const PARAMETRES = [
  ['sauvegarde_auto', 'true', 'Sauvegardes : sauvegarde automatique quotidienne'],
  ['sauvegarde_heure', '01:00', 'Sauvegardes : heure de la sauvegarde automatique (Kinshasa)'],
  ['retention_quotidienne', '7', 'Sauvegardes : nombre de sauvegardes quotidiennes conservées'],
  ['retention_hebdomadaire', '4', 'Sauvegardes : nombre de sauvegardes hebdomadaires conservées'],
  ['retention_mensuelle', '12', 'Sauvegardes : nombre de sauvegardes mensuelles conservées'],
  ['retention_ponctuelle_jours', '90', 'Sauvegardes : conservation des sauvegardes ponctuelles (jours)'],
  ['test_restauration_auto', 'true', 'Sauvegardes : test de restauration hebdomadaire'],
  ['test_restauration_jour', '0', 'Sauvegardes : jour du test de restauration (0 = dimanche)'],
  ['maintenance_active', 'false', 'Maintenance : mode maintenance actif'],
  ['maintenance_message', '', 'Maintenance : message affiché aux utilisateurs'],
  ['maintenance_fin', '', 'Maintenance : fin prévue'],
];

exports.up = async function up(knex) {
  await knex.schema.alterTable('sauvegardes', (t) => {
    t.string('empreinte', 64); // SHA-256 du fichier
    t.boolean('chiffre').notNullable().defaultTo(false);
    t.string('cle_empreinte', 16); // identifie la clé de chiffrement utilisée (jamais la clé)
    t.string('palier', 15); // QUOTIDIENNE | HEBDOMADAIRE | MENSUELLE (sauvegardes programmées)
    t.string('copie_statut', 10); // OK | ECHEC | ABSENTE
    t.text('copie_detail');
    t.timestamp('verifiee_at');
    t.string('verification_statut', 10); // OK | ECHEC
    t.timestamp('supprimee_at');
  });
  await knex.schema.createTable('verifications_sauvegarde', (t) => {
    t.increments('id');
    t.integer('sauvegarde_id');
    t.string('fichier', 200);
    t.string('type', 15).notNullable(); // INTEGRITE | RESTAURATION
    t.string('statut', 10).notNullable(); // OK | ECHEC
    t.jsonb('detail');
    t.integer('duree_ms');
    t.string('origine', 10).notNullable().defaultTo('MANUEL'); // MANUEL | AUTO
    t.string('username', 60);
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.index(['created_at']);
  });
  await knex.schema.createTable('demandes_restauration', (t) => {
    t.increments('id');
    t.integer('sauvegarde_id');
    t.string('fichier', 200).notNullable();
    t.timestamp('sauvegarde_date').notNullable();
    t.text('motif').notNullable();
    t.string('statut', 12).notNullable().defaultTo('EN_ATTENTE'); // EN_ATTENTE | VALIDEE | REFUSEE | EXPIREE | EXECUTEE | ECHEC | ANNULEE
    t.integer('demande_par');
    t.string('demande_par_username', 60);
    t.timestamp('demande_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('expire_at').notNullable();
    t.integer('decide_par');
    t.string('decide_par_username', 60);
    t.timestamp('decide_at');
    t.text('decision_commentaire');
    t.timestamp('execute_at');
    t.string('execute_par_username', 60);
    t.jsonb('resultat');
  });
  await knex.schema.createTable('annonces_systeme', (t) => {
    t.increments('id');
    t.string('titre', 200).notNullable();
    t.text('message').notNullable();
    t.integer('destinataires').notNullable();
    t.string('envoye_par_username', 60);
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
  });

  const [perm] = await knex('permissions').insert({ code: 'sauvegarde.valider_restauration', module: 'gouvernance', libelle: 'Valider ou refuser une demande de restauration de la base', delegable: false, reservee_division: false })
    .onConflict('code').merge(['libelle']).returning('id');
  const dir = await knex('roles').where({ code: 'DIRECTEUR' }).first();
  if (dir) await knex('role_permissions').insert({ role_id: dir.id, permission_id: perm.id }).onConflict(['role_id', 'permission_id']).ignore();

  for (const [cle, valeur, libelle] of PARAMETRES) await knex('parametres').insert({ cle, valeur, libelle }).onConflict('cle').ignore();
};

exports.down = async function down(knex) {
  await knex('parametres').whereIn('cle', PARAMETRES.map((p) => p[0])).del();
  const p = await knex('permissions').where({ code: 'sauvegarde.valider_restauration' }).first();
  if (p) { await knex('role_permissions').where({ permission_id: p.id }).del(); await knex('permissions').where({ id: p.id }).del(); }
  for (const t of ['annonces_systeme', 'demandes_restauration', 'verifications_sauvegarde']) await knex.schema.dropTableIfExists(t);
  await knex.schema.alterTable('sauvegardes', (t) => {
    for (const c of ['empreinte', 'chiffre', 'cle_empreinte', 'palier', 'copie_statut', 'copie_detail', 'verifiee_at', 'verification_statut', 'supprimee_at']) t.dropColumn(c);
  });
};

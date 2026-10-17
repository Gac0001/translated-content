'use strict';
/**
 * 1.7 — Supervision (lot 2 du compte Admin Système) :
 *  - registre des sauvegardes (réussies et échouées) ;
 *  - journal technique des erreurs, regroupées par empreinte ;
 *  - historique des contrôles de santé du système ;
 *  - rapports mensuels de sécurité ;
 *  - permission `rapport_securite.consulter` (Admin Système et Directeur) ;
 *  - seuils d’espace disque et conservation du journal technique.
 */
const PARAMETRES = [
  ['disque_seuil_attention', '15', 'Espace disque : seuil « à surveiller » (% libre)'],
  ['disque_seuil_critique', '5', 'Espace disque : seuil critique (% libre)'],
  ['erreurs_conservation_jours', '90', 'Journal technique : conservation (jours)'],
];

exports.up = async function up(knex) {
  await knex.schema.createTable('sauvegardes', (t) => {
    t.increments('id');
    t.string('fichier', 200);
    t.bigInteger('taille_octets');
    t.integer('duree_ms');
    t.string('statut', 10).notNullable(); // REUSSIE | ECHEC
    t.string('origine', 30).notNullable().defaultTo('MANUELLE'); // MANUELLE | AVANT_REINITIALISATION | PROGRAMMEE
    t.text('erreur');
    t.integer('user_id');
    t.string('username', 60);
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.index(['statut', 'created_at']);
  });

  await knex.schema.createTable('erreurs_techniques', (t) => {
    t.increments('id');
    t.string('empreinte', 64).notNullable();
    t.string('methode', 10);
    t.string('route', 300);
    t.integer('statut');
    t.string('code', 60);
    t.text('message');
    t.text('pile');
    t.integer('occurrences').notNullable().defaultTo(1);
    t.timestamp('premiere_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('derniere_at').notNullable().defaultTo(knex.fn.now());
    t.integer('derniere_user_id');
    t.string('derniere_username', 60);
    t.string('derniere_ip', 64);
    t.timestamp('resolue_at');
    t.integer('resolue_par');
    t.text('commentaire');
    t.index(['derniere_at']);
  });
  // Une seule erreur ouverte par empreinte : les occurrences suivantes l’incrémentent.
  await knex.raw('CREATE UNIQUE INDEX erreurs_techniques_ouvertes_uniq ON erreurs_techniques (empreinte) WHERE resolue_at IS NULL');

  await knex.schema.createTable('sante_controles', (t) => {
    t.increments('id');
    t.string('global', 10).notNullable(); // OK | ATTENTION | PANNE
    t.jsonb('composants').notNullable();
    t.integer('duree_ms');
    t.string('origine', 10).notNullable().defaultTo('AUTO'); // AUTO | MANUEL
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.index(['created_at']);
  });

  await knex.schema.createTable('rapports_securite', (t) => {
    t.increments('id');
    t.string('periode', 7).notNullable().unique(); // AAAA-MM
    t.jsonb('donnees').notNullable();
    t.timestamp('genere_at').notNullable().defaultTo(knex.fn.now());
    t.integer('genere_par'); // null : génération automatique
    t.string('genere_par_username', 60);
  });

  const [perm] = await knex('permissions').insert({ code: 'rapport_securite.consulter', module: 'rapports', libelle: 'Consulter les rapports mensuels de sécurité', delegable: false, reservee_division: false })
    .onConflict('code').merge(['libelle']).returning('id');
  const roles = await knex('roles').whereIn('code', ['ADMIN_SYSTEME', 'DIRECTEUR']).pluck('id');
  for (const r of roles) await knex('role_permissions').insert({ role_id: r, permission_id: perm.id }).onConflict(['role_id', 'permission_id']).ignore();

  for (const [cle, valeur, libelle] of PARAMETRES) await knex('parametres').insert({ cle, valeur, libelle }).onConflict('cle').ignore();
};

exports.down = async function down(knex) {
  await knex('parametres').whereIn('cle', PARAMETRES.map((p) => p[0])).del();
  const p = await knex('permissions').where({ code: 'rapport_securite.consulter' }).first();
  if (p) { await knex('role_permissions').where({ permission_id: p.id }).del(); await knex('permissions').where({ id: p.id }).del(); }
  for (const t of ['rapports_securite', 'sante_controles', 'erreurs_techniques', 'sauvegardes']) await knex.schema.dropTableIfExists(t);
};

'use strict';

/**
 * Notifications par e-mail : file d’envoi durable (réessais) et préférences par utilisateur.
 */
exports.up = async function up(knex) {
  await knex.schema.createTable('email_outbox', (t) => {
    t.bigIncrements('id');
    t.bigInteger('notification_id').references('notifications.id').onDelete('SET NULL');
    t.integer('user_id').references('users.id').onDelete('SET NULL');
    t.string('type', 40);
    t.string('to_email', 200).notNullable();
    t.string('subject', 300).notNullable();
    t.text('text_body').notNullable();
    t.text('html_body').notNullable();
    t.string('statut', 20).notNullable().defaultTo('EN_ATTENTE'); // EN_ATTENTE | ENVOYE | ECHEC | ANNULE
    t.integer('tentatives').notNullable().defaultTo(0);
    t.text('derniere_erreur');
    t.timestamp('prochain_essai').notNullable().defaultTo(knex.fn.now());
    t.timestamp('sent_at');
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.index(['statut', 'prochain_essai']);
  });
  await knex.raw(`ALTER TABLE email_outbox ADD CONSTRAINT email_outbox_statut_chk CHECK (statut IN ('EN_ATTENTE','ENVOYE','ECHEC','ANNULE'))`);

  await knex.schema.createTable('notification_preferences', (t) => {
    t.integer('user_id').primary().references('users.id').onDelete('CASCADE');
    t.boolean('email_actif').notNullable().defaultTo(true);
    t.jsonb('types_desactives').notNullable().defaultTo('[]');
    t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('notification_preferences');
  await knex.schema.dropTableIfExists('email_outbox');
};

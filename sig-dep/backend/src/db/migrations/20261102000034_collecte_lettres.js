'use strict';
/**
 * Collecte auprès des services du Secrétariat Général, étape 2 (1.46.0) : lettres d’envoi et de
 * relance d’une campagne, préparées en brouillon dans la correspondance (documents de service de
 * type « Lettre de transmission »), signées et numérotées par le Directeur à la validation.
 * Registre en ajout seul : services visés par chaque lettre.
 */
exports.up = async function up(knex) {
  await knex.schema.createTable('collecte_lettres', (t) => {
    t.increments('id');
    t.integer('collecte_id').notNullable().references('collectes.id').onDelete('CASCADE');
    t.string('type', 10).notNullable(); // ENVOI | RELANCE
    t.integer('document_id').notNullable().references('documents.id');
    t.jsonb('services').notNullable().defaultTo('[]'); // identifiants collecte_services visés
    t.integer('created_by').notNullable().references('users.id');
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.index(['collecte_id']);
  });
  await knex.raw(`ALTER TABLE collecte_lettres ADD CONSTRAINT collecte_lettres_chk CHECK (type IN ('ENVOI','RELANCE'))`);
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('collecte_lettres');
};

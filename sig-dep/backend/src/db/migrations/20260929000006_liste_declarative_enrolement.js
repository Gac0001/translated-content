'use strict';

/**
 * Liste déclarative des agents de la Direction et enrôlement (création des comptes).
 *  - agents : informations complémentaires saisies à l’enrôlement et inscription sur la liste ;
 *  - listes_declaratives_validations : validations datées de la liste par le Directeur (ou l’Admin),
 *    avec l’instantané des agents validés. Table en ajout seul.
 */
exports.up = async function up(knex) {
  await knex.schema.alterTable('agents', (t) => {
    t.string('lieu_naissance', 150);
    t.date('date_mise_en_service');
    t.string('numero_carte_igap', 60);
    t.integer('commission_attachment_id').references('attachments.id').onDelete('SET NULL');
    t.boolean('liste_declarative').notNullable().defaultTo(false);
    t.timestamp('enrole_at');
    t.integer('enrole_par').references('users.id');
  });
  await knex.raw(`CREATE UNIQUE INDEX agents_igap_unique ON agents (upper(numero_carte_igap)) WHERE numero_carte_igap IS NOT NULL`);
  // Les agents déjà enregistrés (hors autorités) figurent sur la liste déclarative.
  await knex('agents').where({ est_autorite: false }).whereNull('archived_at').update({ liste_declarative: true });

  await knex.schema.createTable('listes_declaratives_validations', (t) => {
    t.increments('id');
    t.integer('direction_id').notNullable().references('directions.id');
    t.integer('valide_par').notNullable().references('users.id');
    t.string('valide_par_role', 40).notNullable();
    t.integer('nb_agents').notNullable();
    t.jsonb('agents').notNullable(); // instantané : [{ agent_id, matricule, nom, grade_id, division_id, bureau_id }]
    t.text('commentaire');
    t.timestamp('valide_at').notNullable().defaultTo(knex.fn.now());
    t.index(['direction_id', 'valide_at']);
  });
  await knex.raw(`CREATE TRIGGER trg_listes_validations_append_only BEFORE UPDATE OR DELETE ON listes_declaratives_validations
    FOR EACH ROW EXECUTE FUNCTION trg_fn_append_only()`);
};

exports.down = async function down(knex) {
  await knex.raw('DROP TRIGGER IF EXISTS trg_listes_validations_append_only ON listes_declaratives_validations');
  await knex.schema.dropTableIfExists('listes_declaratives_validations');
  await knex.raw('DROP INDEX IF EXISTS agents_igap_unique');
  await knex.schema.alterTable('agents', (t) => {
    t.dropColumn('enrole_par'); t.dropColumn('enrole_at'); t.dropColumn('liste_declarative');
    t.dropColumn('commission_attachment_id'); t.dropColumn('numero_carte_igap'); t.dropColumn('date_mise_en_service'); t.dropColumn('lieu_naissance');
  });
};

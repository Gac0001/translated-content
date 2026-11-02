'use strict';
/**
 * Lot F — Collecte auprès des services du Secrétariat Général (cahier, § 36).
 * Les services n’ont pas de compte : la Direction ouvre une campagne (objet, exercice, services,
 * échéance), génère pour chaque service un modèle Excel pré-rempli et protégé, puis importe le fichier
 * retourné, contrôlé (structure, champs obligatoires, codes, totaux, doublons) avec son rapport
 * d’anomalies ; le fichier d’origine est conservé avec chaque réception (pièce jointe).
 *  - campagne : PREPARATION (Bureau organisateur) → OUVERTE → CLOTUREE (Chef de la Division
 *    Programme et Suivi) ;
 *  - service : ATTENDU → RECU (→ REJETE avec motif → CORRIGE) → INTEGRE ; EN_RETARD posé à l’échéance ;
 *  - réceptions en ajout seul : chaque fichier retourné est une version.
 */
const OBJETS = ['PTBA', 'CADRE_PERFORMANCE', 'INVESTISSEMENT', 'PLAN_ACTIONS', 'RAPPORT_ACTIVITES', 'FICHE_PNSD'];

exports.up = async function up(knex) {
  await knex.schema.createTable('collectes', (t) => {
    t.increments('id');
    t.string('reference', 60).notNullable().unique();
    t.string('objet', 30).notNullable();
    t.integer('annee').notNullable(); // exercice concerné
    t.string('titre', 300).notNullable();
    t.date('echeance').notNullable();
    t.text('instructions');
    t.string('statut', 20).notNullable().defaultTo('PREPARATION');
    t.integer('created_by').notNullable().references('users.id');
    t.integer('ouverte_par').references('users.id');
    t.timestamp('ouverte_at');
    t.integer('cloturee_par').references('users.id');
    t.timestamp('cloturee_at');
    t.timestamps(true, true);
  });
  await knex.raw(`ALTER TABLE collectes ADD CONSTRAINT collectes_chk CHECK (objet IN (${OBJETS.map((o) => `'${o}'`).join(',')})
    AND statut IN ('PREPARATION','OUVERTE','CLOTUREE') AND annee BETWEEN 2000 AND 2100)`);

  await knex.schema.createTable('collecte_services', (t) => {
    t.increments('id');
    t.integer('collecte_id').notNullable().references('collectes.id').onDelete('CASCADE');
    t.integer('service_id').notNullable().references('plan_services.id');
    t.string('statut', 20).notNullable().defaultTo('ATTENDU');
    t.text('motif_rejet');
    t.integer('decide_par').references('users.id');
    t.timestamp('decide_at');
    t.jsonb('integration'); // résultat de l’intégration (PTBA créé, valeurs, projets…)
    t.timestamps(true, true);
    t.unique(['collecte_id', 'service_id']);
  });
  await knex.raw(`ALTER TABLE collecte_services ADD CONSTRAINT collecte_services_chk CHECK (statut IN ('ATTENDU','RECU','REJETE','CORRIGE','INTEGRE','EN_RETARD'))`);

  await knex.schema.createTable('collecte_receptions', (t) => {
    t.increments('id');
    t.integer('collecte_service_id').notNullable().references('collecte_services.id').onDelete('CASCADE');
    t.integer('version').notNullable();
    t.integer('attachment_id').references('attachments.id');
    t.string('fichier', 300).notNullable();
    t.jsonb('donnees').notNullable().defaultTo('[]'); // lignes lues
    t.jsonb('anomalies').notNullable().defaultTo('[]'); // { gravite, cellule, message }
    t.integer('erreurs').notNullable().defaultTo(0);
    t.integer('alertes').notNullable().defaultTo(0);
    t.decimal('total', 20, 2);
    t.integer('recu_par').notNullable().references('users.id');
    t.timestamp('recu_at').notNullable().defaultTo(knex.fn.now());
    t.unique(['collecte_service_id', 'version']);
  });
  await knex.raw(`
    CREATE OR REPLACE FUNCTION collecte_receptions_ajout_seul() RETURNS trigger AS $$
    BEGIN RAISE EXCEPTION 'APPEND_ONLY: une réception de collecte ne se modifie pas'; END $$ LANGUAGE plpgsql;
    CREATE TRIGGER trg_collecte_receptions_ajout_seul BEFORE UPDATE OR DELETE ON collecte_receptions FOR EACH ROW EXECUTE FUNCTION collecte_receptions_ajout_seul();`);
};

exports.down = async function down(knex) {
  await knex.raw('DROP TRIGGER IF EXISTS trg_collecte_receptions_ajout_seul ON collecte_receptions');
  await knex.raw('DROP FUNCTION IF EXISTS collecte_receptions_ajout_seul()');
  await knex.schema.dropTableIfExists('collecte_receptions');
  await knex.schema.dropTableIfExists('collecte_services');
  await knex.schema.dropTableIfExists('collectes');
};

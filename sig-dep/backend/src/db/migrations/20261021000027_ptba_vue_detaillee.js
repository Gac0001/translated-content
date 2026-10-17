'use strict';
/**
 * PTBA en vue budgétaire détaillée (feuilles DDCN et DCS du classeur du Ministère) :
 * MINISTÈRE > PROGRAMME > service > ACTION > ACTIVITÉ > Tâche > lignes de dépense.
 *  - une ligne du PTBA correspond à une tâche ; ses lignes de dépense (désignation, structure
 *    destinataire, nature économique, section/chapitre, unité physique, chronogramme, coût, source,
 *    lieu d’exécution, mode de gestion) sont conservées dans ptba_details ; le coût de la tâche est
 *    la somme de ses lignes ;
 *  - le rapport d’anomalies de l’import est conservé avec le PTBA ;
 *  - un PTBA validé reste intangible, détails compris.
 */
exports.up = async function up(knex) {
  await knex.schema.alterTable('ptba', (t) => {
    t.string('vue', 12).notNullable().defaultTo('STANDARD'); // STANDARD | DETAILLEE
    t.jsonb('rapport_import'); // { feuille, fichier, anomalies: [{ gravite, cellule, message }] }
  });
  await knex.raw(`ALTER TABLE ptba ADD CONSTRAINT ptba_vue_chk CHECK (vue IN ('STANDARD','DETAILLEE'))`);
  await knex.schema.createTable('ptba_details', (t) => {
    t.increments('id');
    t.integer('ptba_id').notNullable().references('ptba.id').onDelete('CASCADE');
    t.integer('ligne_id').notNullable().references('ptba_lignes.id').onDelete('CASCADE');
    t.integer('ordre').notNullable().defaultTo(0);
    t.text('designation').notNullable();
    t.string('structure_destinataire', 200);
    t.string('nature_economique', 200);
    t.string('section_chapitre', 60);
    t.string('unite_physique', 100);
    t.specificType('mois', 'smallint[]').notNullable().defaultTo('{}');
    t.decimal('cout', 20, 2).notNullable().defaultTo(0);
    t.string('source', 100);
    t.string('lieu', 300);
    t.string('mode_gestion', 100);
    t.index(['ligne_id']);
  });
  await knex.raw(`ALTER TABLE ptba_details ADD CONSTRAINT ptba_details_chk CHECK (cout >= 0 AND mois <@ ARRAY[1,2,3,4,5,6,7,8,9,10,11,12]::smallint[])`);
  await knex.raw('CREATE TRIGGER trg_ptba_details_verrou BEFORE INSERT OR UPDATE OR DELETE ON ptba_details FOR EACH ROW EXECUTE FUNCTION ptba_verrou()');
  // Le rapport d’import et la vue font partie du PTBA validé
  await knex.raw(`
    CREATE OR REPLACE FUNCTION ptba_valide_intangible() RETURNS trigger AS $$
    BEGIN
      IF TG_OP = 'DELETE' AND OLD.statut = 'VALIDE' THEN RAISE EXCEPTION 'PTBA_VERROUILLE: PTBA validé, non supprimable'; END IF;
      IF TG_OP = 'UPDATE' AND OLD.statut = 'VALIDE' AND (NEW.statut, NEW.objectif_global, NEW.programme_id, NEW.exercice_id, NEW.service_id, NEW.vue, NEW.rapport_import)
         IS DISTINCT FROM (OLD.statut, OLD.objectif_global, OLD.programme_id, OLD.exercice_id, OLD.service_id, OLD.vue, OLD.rapport_import) THEN
        RAISE EXCEPTION 'PTBA_VERROUILLE: PTBA validé, non modifiable';
      END IF;
      IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
      RETURN NEW;
    END $$ LANGUAGE plpgsql;`);
};

exports.down = async function down(knex) {
  await knex.raw(`
    CREATE OR REPLACE FUNCTION ptba_valide_intangible() RETURNS trigger AS $$
    BEGIN
      IF TG_OP = 'DELETE' AND OLD.statut = 'VALIDE' THEN RAISE EXCEPTION 'PTBA_VERROUILLE: PTBA validé, non supprimable'; END IF;
      IF TG_OP = 'UPDATE' AND OLD.statut = 'VALIDE' AND (NEW.statut, NEW.objectif_global, NEW.programme_id, NEW.exercice_id, NEW.service_id)
         IS DISTINCT FROM (OLD.statut, OLD.objectif_global, OLD.programme_id, OLD.exercice_id, OLD.service_id) THEN
        RAISE EXCEPTION 'PTBA_VERROUILLE: PTBA validé, non modifiable';
      END IF;
      IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
      RETURN NEW;
    END $$ LANGUAGE plpgsql;`);
  await knex.schema.dropTable('ptba_details');
  await knex.raw('ALTER TABLE ptba DROP CONSTRAINT IF EXISTS ptba_vue_chk');
  await knex.schema.alterTable('ptba', (t) => { t.dropColumn('rapport_import'); t.dropColumn('vue'); });
};

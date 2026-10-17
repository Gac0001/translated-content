'use strict';
/**
 * Lot 9A — Planification : nomenclature budgétaire et Plan de Travail Annuel Budgétisé (PTBA),
 * au format du Ministère de l’Économie Numérique (cahier des charges, §§ 3 et 24).
 *  - exercices budgétaires ; programmes et actions (maquette programmatique) ; services du
 *    Ministère (structures responsables des PTBA) ;
 *  - PTBA par service et par exercice : objectif global, objectifs spécifiques, activités
 *    principales, tâches, coût en CDF, chronogramme mensuel, structure responsable, résultats
 *    attendus, indicateurs de réalisation, source de vérification et de financement ;
 *  - circuit : Bureau Programme (préparation) → Chef du Bureau Programme (vérification) →
 *    Chef de la Division Programme et Suivi (consolidation) → Directeur (validation) ;
 *    PTBA validé intangible en base ;
 *  - suivi trimestriel de l’exécution physique et financière par le Bureau Suivi-Évaluation.
 */
const PERMISSIONS = [
  ['planification.consulter', 'planification', 'Consulter la planification (programmes, PTBA, exécution)', ['SECRETAIRE_GENERAL', 'DIRECTEUR', 'CHEF_DIVISION', 'CHEF_BUREAU', 'AGENT']],
  ['planification.referentiel', 'planification', 'Gérer les exercices, programmes, actions et services du Ministère', ['DIRECTEUR']],
  ['ptba.valider', 'planification', 'Valider les PTBA', ['DIRECTEUR']],
];

exports.up = async function up(knex) {
  await knex.schema.createTable('exercices', (t) => {
    t.increments('id');
    t.integer('annee').notNullable().unique();
    t.string('statut', 20).notNullable().defaultTo('PREPARATION'); // PREPARATION | EXECUTION | CLOTURE
    t.timestamps(true, true);
  });
  await knex.raw(`ALTER TABLE exercices ADD CONSTRAINT exercices_chk CHECK (annee BETWEEN 2000 AND 2100 AND statut IN ('PREPARATION','EXECUTION','CLOTURE'))`);

  await knex.schema.createTable('plan_programmes', (t) => {
    t.increments('id');
    t.string('code', 20).notNullable().unique();
    t.string('libelle', 300).notNullable();
    t.text('objectif_global');
    t.integer('ordre').notNullable().defaultTo(0);
    t.boolean('actif').notNullable().defaultTo(true);
    t.timestamps(true, true);
  });
  await knex.schema.createTable('plan_actions', (t) => {
    t.increments('id');
    t.integer('programme_id').notNullable().references('plan_programmes.id');
    t.string('code', 20).notNullable();
    t.string('libelle', 400).notNullable();
    t.text('services_normatifs');
    t.text('operateurs');
    t.boolean('actif').notNullable().defaultTo(true);
    t.unique(['programme_id', 'code']);
    t.timestamps(true, true);
  });
  await knex.schema.createTable('plan_services', (t) => {
    t.increments('id');
    t.string('sigle', 30).notNullable().unique();
    t.string('libelle', 300).notNullable();
    t.boolean('actif').notNullable().defaultTo(true);
    t.timestamps(true, true);
  });

  await knex.schema.createTable('ptba', (t) => {
    t.increments('id');
    t.string('reference', 60).notNullable().unique();
    t.integer('exercice_id').notNullable().references('exercices.id');
    t.integer('service_id').notNullable().references('plan_services.id');
    t.integer('programme_id').references('plan_programmes.id');
    t.text('objectif_global');
    t.string('statut', 20).notNullable().defaultTo('BROUILLON');
    t.text('observations');
    t.integer('prepare_par').notNullable().references('users.id');
    t.integer('detenteur_user_id').references('users.id');
    t.integer('verifie_par').references('users.id');
    t.timestamp('verifie_at');
    t.integer('consolide_par').references('users.id');
    t.timestamp('consolide_at');
    t.integer('valide_par').references('users.id');
    t.timestamp('valide_at');
    t.timestamps(true, true);
    t.unique(['exercice_id', 'service_id']);
  });
  await knex.raw(`ALTER TABLE ptba ADD CONSTRAINT ptba_chk CHECK (statut IN ('BROUILLON','SOUMIS','VERIFIE','CONSOLIDE','VALIDE','A_CORRIGER'))`);

  await knex.schema.createTable('ptba_objectifs', (t) => {
    t.increments('id');
    t.integer('ptba_id').notNullable().references('ptba.id').onDelete('CASCADE');
    t.integer('ordre').notNullable().defaultTo(0);
    t.text('libelle').notNullable();
  });
  await knex.schema.createTable('ptba_lignes', (t) => {
    t.increments('id');
    t.integer('ptba_id').notNullable().references('ptba.id').onDelete('CASCADE');
    t.integer('objectif_id').references('ptba_objectifs.id').onDelete('SET NULL');
    t.integer('action_id').references('plan_actions.id');
    t.integer('ordre').notNullable().defaultTo(0);
    t.string('numero', 20);
    t.text('activite').notNullable();
    t.text('taches');
    t.decimal('cout', 20, 2).notNullable().defaultTo(0);
    t.specificType('mois', 'smallint[]').notNullable().defaultTo('{}'); // 1 à 12
    t.string('structure_responsable', 200);
    t.text('resultats_attendus');
    t.text('indicateur');
    t.text('source_verification');
    t.string('source_financement', 200);
    t.index(['ptba_id']);
  });
  await knex.raw(`ALTER TABLE ptba_lignes ADD CONSTRAINT ptba_lignes_chk CHECK (cout >= 0 AND mois <@ ARRAY[1,2,3,4,5,6,7,8,9,10,11,12]::smallint[])`);

  // PTBA validé : intangible (objectifs et lignes compris) ; le suivi de l’exécution reste ouvert.
  await knex.raw(`
    CREATE OR REPLACE FUNCTION ptba_verrou() RETURNS trigger AS $$
    DECLARE s text; pid integer;
    BEGIN
      pid := CASE WHEN TG_OP = 'DELETE' THEN OLD.ptba_id ELSE NEW.ptba_id END;
      SELECT statut INTO s FROM ptba WHERE id = pid;
      IF s = 'VALIDE' THEN RAISE EXCEPTION 'PTBA_VERROUILLE: PTBA validé, non modifiable'; END IF;
      IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
      RETURN NEW;
    END $$ LANGUAGE plpgsql;
    CREATE TRIGGER trg_ptba_lignes_verrou BEFORE INSERT OR UPDATE OR DELETE ON ptba_lignes FOR EACH ROW EXECUTE FUNCTION ptba_verrou();
    CREATE TRIGGER trg_ptba_objectifs_verrou BEFORE INSERT OR UPDATE OR DELETE ON ptba_objectifs FOR EACH ROW EXECUTE FUNCTION ptba_verrou();
    CREATE OR REPLACE FUNCTION ptba_valide_intangible() RETURNS trigger AS $$
    BEGIN
      IF TG_OP = 'DELETE' AND OLD.statut = 'VALIDE' THEN RAISE EXCEPTION 'PTBA_VERROUILLE: PTBA validé, non supprimable'; END IF;
      IF TG_OP = 'UPDATE' AND OLD.statut = 'VALIDE' AND (NEW.statut, NEW.objectif_global, NEW.programme_id, NEW.exercice_id, NEW.service_id)
         IS DISTINCT FROM (OLD.statut, OLD.objectif_global, OLD.programme_id, OLD.exercice_id, OLD.service_id) THEN
        RAISE EXCEPTION 'PTBA_VERROUILLE: PTBA validé, non modifiable';
      END IF;
      IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
      RETURN NEW;
    END $$ LANGUAGE plpgsql;
    CREATE TRIGGER trg_ptba_valide BEFORE UPDATE OR DELETE ON ptba FOR EACH ROW EXECUTE FUNCTION ptba_valide_intangible();
  `);

  await knex.schema.createTable('ptba_suivi', (t) => {
    t.increments('id');
    t.integer('ligne_id').notNullable().references('ptba_lignes.id').onDelete('CASCADE');
    t.integer('trimestre').notNullable();
    t.integer('taux_physique').notNullable().defaultTo(0);
    t.decimal('montant_engage', 20, 2).notNullable().defaultTo(0);
    t.decimal('montant_decaisse', 20, 2).notNullable().defaultTo(0);
    t.text('commentaire');
    t.integer('saisi_par').notNullable().references('users.id');
    t.timestamp('saisi_at').notNullable().defaultTo(knex.fn.now());
    t.unique(['ligne_id', 'trimestre']);
  });
  await knex.raw(`ALTER TABLE ptba_suivi ADD CONSTRAINT ptba_suivi_chk CHECK (trimestre BETWEEN 1 AND 4 AND taux_physique BETWEEN 0 AND 100
    AND montant_engage >= 0 AND montant_decaisse >= 0 AND montant_decaisse <= montant_engage)`);

  for (const [code, module, libelle, roles] of PERMISSIONS) {
    const [p] = await knex('permissions').insert({ code, module, libelle, delegable: false, reservee_division: false }).onConflict('code').merge().returning('*');
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
  await knex.schema.dropTableIfExists('ptba_suivi');
  await knex.raw('DROP TRIGGER IF EXISTS trg_ptba_valide ON ptba');
  await knex.schema.dropTableIfExists('ptba_lignes');
  await knex.schema.dropTableIfExists('ptba_objectifs');
  await knex.raw('DROP FUNCTION IF EXISTS ptba_verrou()');
  await knex.raw('DROP FUNCTION IF EXISTS ptba_valide_intangible()');
  await knex.schema.dropTableIfExists('ptba');
  await knex.schema.dropTableIfExists('plan_services');
  await knex.schema.dropTableIfExists('plan_actions');
  await knex.schema.dropTableIfExists('plan_programmes');
  await knex.schema.dropTableIfExists('exercices');
};

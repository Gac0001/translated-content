'use strict';
/**
 * Lot E — Évaluation annuelle des politiques sectorielles et budgétaires (cahier, §§ 34 et 51).
 * Campagne convoquée par le Ministère du Budget : la Direction prépare le dossier du Ministère
 * (note de présentation, annexes I à V, lettre de transmission) et le transmet au Secrétaire Général.
 *  - un dossier par exercice évalué, ouvert à partir de la convocation (référence, date, échéance) ;
 *  - lignes des annexes : I politiques sectorielles, II projection sur trois ans, III et IV effectifs
 *    par grade (primes, salaire de base), V exécution des dépenses. Chaque ligne garde les valeurs
 *    reprises du SIG-DEP (source) et les valeurs retenues : l’écart signale une modification ;
 *  - taux, totaux et montants non payés sont recalculés par l’API, jamais saisis.
 */
exports.up = async function up(knex) {
  await knex.schema.createTable('evaluations', (t) => {
    t.increments('id');
    t.string('reference', 60).notNullable().unique();
    t.integer('annee').notNullable().unique(); // exercice évalué
    t.integer('annee_projection').notNullable(); // première année de la projection sur trois ans (annexe II)
    t.string('convocation_reference', 200).notNullable();
    t.date('convocation_date').notNullable();
    t.date('date_limite');
    t.string('statut', 20).notNullable().defaultTo('PREPARATION');
    t.jsonb('note').notNullable().defaultTo('{}'); // note de présentation (rubriques)
    t.text('observations');
    t.integer('prepare_par').notNullable().references('users.id');
    t.integer('verifie_par').references('users.id');
    t.timestamp('verifie_at');
    t.integer('valide_par').references('users.id');
    t.timestamp('valide_at');
    t.timestamps(true, true);
  });
  await knex.raw(`ALTER TABLE evaluations ADD CONSTRAINT evaluations_chk CHECK (annee BETWEEN 2000 AND 2100
    AND annee_projection BETWEEN annee AND annee + 3
    AND statut IN ('PREPARATION','SOUMIS','A_CORRIGER','VERIFIE','VALIDE','TRANSMIS'))`);

  await knex.schema.createTable('evaluation_lignes', (t) => {
    t.increments('id');
    t.integer('evaluation_id').notNullable().references('evaluations.id').onDelete('CASCADE');
    t.string('annexe', 3).notNullable(); // I | II | III | IV | V
    t.integer('ordre').notNullable().defaultTo(0);
    t.string('cle', 60); // élément source (ex. ACTION:12, GRADE:CB, PROGRAMME:3) ; null : ligne ajoutée
    t.jsonb('valeurs').notNullable().defaultTo('{}');
    t.jsonb('source'); // valeurs reprises du SIG-DEP à la dernière actualisation
    t.boolean('exclue').notNullable().defaultTo(false); // ligne reprise écartée de l’annexe
    t.boolean('source_absente').notNullable().defaultTo(false); // l’élément source n’existe plus
    t.integer('modifie_par').references('users.id');
    t.timestamps(true, true);
    t.unique(['evaluation_id', 'annexe', 'cle']);
    t.index(['evaluation_id', 'annexe']);
  });
  await knex.raw(`ALTER TABLE evaluation_lignes ADD CONSTRAINT evaluation_lignes_chk CHECK (annexe IN ('I','II','III','IV','V'))`);

  // Dossier validé ou transmis : intangible, lignes comprises.
  await knex.raw(`
    CREATE OR REPLACE FUNCTION evaluation_verrou() RETURNS trigger AS $$
    DECLARE s text; eid integer;
    BEGIN
      eid := CASE WHEN TG_OP = 'DELETE' THEN OLD.evaluation_id ELSE NEW.evaluation_id END;
      SELECT statut INTO s FROM evaluations WHERE id = eid;
      IF s IN ('VALIDE','TRANSMIS') THEN RAISE EXCEPTION 'EVALUATION_VERROUILLEE: dossier d’évaluation validé, non modifiable'; END IF;
      IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
      RETURN NEW;
    END $$ LANGUAGE plpgsql;
    CREATE TRIGGER trg_evaluation_lignes_verrou BEFORE INSERT OR UPDATE OR DELETE ON evaluation_lignes FOR EACH ROW EXECUTE FUNCTION evaluation_verrou();
    CREATE OR REPLACE FUNCTION evaluation_valide_intangible() RETURNS trigger AS $$
    BEGIN
      IF TG_OP = 'DELETE' AND OLD.statut IN ('VALIDE','TRANSMIS') THEN RAISE EXCEPTION 'EVALUATION_VERROUILLEE: dossier d’évaluation validé, non supprimable'; END IF;
      IF TG_OP = 'UPDATE' AND OLD.statut IN ('VALIDE','TRANSMIS')
         AND ((NEW.annee, NEW.annee_projection, NEW.note, NEW.convocation_reference, NEW.convocation_date) IS DISTINCT FROM (OLD.annee, OLD.annee_projection, OLD.note, OLD.convocation_reference, OLD.convocation_date)
           OR NOT (NEW.statut = OLD.statut OR (OLD.statut = 'VALIDE' AND NEW.statut = 'TRANSMIS'))) THEN
        RAISE EXCEPTION 'EVALUATION_VERROUILLEE: dossier d’évaluation validé, non modifiable';
      END IF;
      IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
      RETURN NEW;
    END $$ LANGUAGE plpgsql;
    CREATE TRIGGER trg_evaluation_valide BEFORE UPDATE OR DELETE ON evaluations FOR EACH ROW EXECUTE FUNCTION evaluation_valide_intangible();
  `);
};

exports.down = async function down(knex) {
  await knex.raw('DROP TRIGGER IF EXISTS trg_evaluation_valide ON evaluations');
  await knex.raw('DROP TRIGGER IF EXISTS trg_evaluation_lignes_verrou ON evaluation_lignes');
  await knex.schema.dropTableIfExists('evaluation_lignes');
  await knex.schema.dropTableIfExists('evaluations');
  await knex.raw('DROP FUNCTION IF EXISTS evaluation_verrou()');
  await knex.raw('DROP FUNCTION IF EXISTS evaluation_valide_intangible()');
};

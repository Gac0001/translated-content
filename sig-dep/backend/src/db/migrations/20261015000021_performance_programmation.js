'use strict';
/**
 * Lot 9B — Performance et documents de programmation (cahier des charges, §§ 3 et 24), d’après le
 * Projet Annuel de Performance (PAP) du Ministère :
 *  - cadre de performance : objectifs (du Ministère ou d’un programme) et indicateurs (unité, mode
 *    de calcul, source), valeurs par année : réalisation, réalisation à mi-parcours, cible ;
 *  - crédits par programme et action, ventilés par rubrique budgétaire et par titre : votés,
 *    exécutés, exécutés à fin juin, prévisions ;
 *  - documents de programmation (PAP, RAP, CDMT) : parties rédigées, circuit de validation ;
 *  - banque des projets (maturité et programme des fiches PIP), jalons et registre des risques.
 */
const RUBRIQUES = [
  ['REM', 'Rémunérations', 1], ['FONC', 'Fonctionnement des Ministères', 2], ['INTER', 'Interventions Économiques, Sociales, Culturelles et Scientifiques', 3],
  ['INV_RE', 'Investissements sur Ressources extérieures', 4], ['INV_RP', 'Investissements sur Ressources Propres', 5],
];
const TITRES = [
  ['T3', 'Titre III : Dépenses de personnel', 3], ['T4', 'Titre IV : Biens et matériels', 4], ['T5', 'Titre V : Dépenses de prestations', 5],
  ['T6', 'Titre VI : Transferts et interventions de l’État', 6], ['T7', 'Titre VII : Équipements', 7], ['T8', 'Titre VIII : Construction, réfection, réhabilitation', 8],
];

exports.up = async function up(knex) {
  await knex.schema.createTable('plan_objectifs', (t) => {
    t.increments('id');
    t.integer('programme_id').references('plan_programmes.id'); // null : objectif du Ministère
    t.integer('ordre').notNullable().defaultTo(0);
    t.text('libelle').notNullable();
    t.boolean('actif').notNullable().defaultTo(true);
    t.timestamps(true, true);
  });
  await knex.schema.createTable('plan_indicateurs', (t) => {
    t.increments('id');
    t.integer('objectif_id').notNullable().references('plan_objectifs.id');
    t.integer('ordre').notNullable().defaultTo(0);
    t.text('libelle').notNullable();
    t.string('unite', 40).notNullable();
    t.text('mode_calcul');
    t.string('source', 200);
    t.text('commentaire');
    t.string('sens', 10).notNullable().defaultTo('HAUSSE'); // HAUSSE : plus c’est élevé, mieux c’est
    t.boolean('actif').notNullable().defaultTo(true);
    t.timestamps(true, true);
  });
  await knex.raw(`ALTER TABLE plan_indicateurs ADD CONSTRAINT plan_indicateurs_chk CHECK (sens IN ('HAUSSE','BAISSE'))`);
  await knex.schema.createTable('plan_indicateur_valeurs', (t) => {
    t.increments('id');
    t.integer('indicateur_id').notNullable().references('plan_indicateurs.id').onDelete('CASCADE');
    t.integer('annee').notNullable();
    t.string('type', 20).notNullable(); // REALISATION | REALISATION_S1 | CIBLE
    t.decimal('valeur', 20, 4).notNullable();
    t.text('commentaire');
    t.integer('saisi_par').notNullable().references('users.id');
    t.timestamp('saisi_at').notNullable().defaultTo(knex.fn.now());
    t.unique(['indicateur_id', 'annee', 'type']);
  });
  await knex.raw(`ALTER TABLE plan_indicateur_valeurs ADD CONSTRAINT plan_valeurs_chk CHECK (type IN ('REALISATION','REALISATION_S1','CIBLE') AND annee BETWEEN 2000 AND 2100)`);

  await knex.schema.createTable('plan_postes_budgetaires', (t) => {
    t.increments('id');
    t.string('axe', 10).notNullable(); // RUBRIQUE | TITRE
    t.string('code', 20).notNullable();
    t.string('libelle', 200).notNullable();
    t.integer('ordre').notNullable().defaultTo(0);
    t.unique(['axe', 'code']);
  });
  await knex('plan_postes_budgetaires').insert([
    ...RUBRIQUES.map(([code, libelle, ordre]) => ({ axe: 'RUBRIQUE', code, libelle, ordre })),
    ...TITRES.map(([code, libelle, ordre]) => ({ axe: 'TITRE', code, libelle, ordre })),
  ]);
  await knex.schema.createTable('plan_credits', (t) => {
    t.increments('id');
    t.integer('annee').notNullable();
    t.integer('programme_id').notNullable().references('plan_programmes.id');
    t.integer('action_id').references('plan_actions.id');
    t.integer('poste_id').notNullable().references('plan_postes_budgetaires.id');
    t.string('type', 20).notNullable(); // VOTE | EXECUTE | EXECUTE_S1 | PREVISION
    t.decimal('montant', 20, 2).notNullable();
    t.integer('saisi_par').notNullable().references('users.id');
    t.timestamp('saisi_at').notNullable().defaultTo(knex.fn.now());
  });
  await knex.raw(`ALTER TABLE plan_credits ADD CONSTRAINT plan_credits_chk CHECK (type IN ('VOTE','EXECUTE','EXECUTE_S1','PREVISION') AND montant >= 0 AND annee BETWEEN 2000 AND 2100)`);
  await knex.raw('CREATE UNIQUE INDEX plan_credits_unique ON plan_credits (annee, programme_id, coalesce(action_id, 0), poste_id, type)');

  await knex.schema.createTable('plan_documents', (t) => {
    t.increments('id');
    t.string('reference', 60).notNullable().unique();
    t.string('type', 10).notNullable(); // PAP | RAP | CDMT
    t.integer('annee').notNullable();
    t.jsonb('contenu').notNullable().defaultTo('{}');
    t.string('statut', 20).notNullable().defaultTo('BROUILLON');
    t.text('observations');
    t.integer('prepare_par').notNullable().references('users.id');
    t.integer('verifie_par').references('users.id');
    t.integer('consolide_par').references('users.id');
    t.integer('valide_par').references('users.id');
    t.timestamp('valide_at');
    t.timestamps(true, true);
    t.unique(['type', 'annee']);
  });
  await knex.raw(`ALTER TABLE plan_documents ADD CONSTRAINT plan_documents_chk CHECK (type IN ('PAP','RAP','CDMT') AND statut IN ('BROUILLON','SOUMIS','VERIFIE','CONSOLIDE','VALIDE','A_CORRIGER'))`);
  await knex.raw(`
    CREATE OR REPLACE FUNCTION plan_document_valide() RETURNS trigger AS $$
    BEGIN
      IF TG_OP = 'DELETE' AND OLD.statut = 'VALIDE' THEN RAISE EXCEPTION 'DOCUMENT_VERROUILLE: document validé'; END IF;
      IF TG_OP = 'UPDATE' AND OLD.statut = 'VALIDE' AND (NEW.contenu, NEW.statut) IS DISTINCT FROM (OLD.contenu, OLD.statut) THEN
        RAISE EXCEPTION 'DOCUMENT_VERROUILLE: document validé';
      END IF;
      IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
      RETURN NEW;
    END $$ LANGUAGE plpgsql;
    CREATE TRIGGER trg_plan_document_valide BEFORE UPDATE OR DELETE ON plan_documents FOR EACH ROW EXECUTE FUNCTION plan_document_valide();
  `);

  // Banque des projets : maturité et rattachement des fiches PIP à un programme
  await knex.schema.alterTable('pip_projects', (t) => {
    t.string('maturite', 20).notNullable().defaultTo('IDEE');
    t.integer('programme_id').references('plan_programmes.id');
    t.string('localisation', 200);
    t.string('partenaires', 300);
  });
  await knex.raw(`ALTER TABLE pip_projects ADD CONSTRAINT pip_maturite_chk CHECK (maturite IN ('IDEE','ETUDE','PRET','EN_COURS','ACHEVE','ABANDONNE'))`);
  await knex.schema.createTable('pip_jalons', (t) => {
    t.increments('id');
    t.integer('pip_id').notNullable().references('pip_projects.id').onDelete('CASCADE');
    t.string('libelle', 300).notNullable();
    t.date('date_prevue').notNullable();
    t.date('date_realisee');
    t.text('commentaire');
    t.timestamps(true, true);
  });

  await knex.schema.createTable('risques', (t) => {
    t.increments('id');
    t.string('entity_type', 20).notNullable(); // PIP | PROGRAMME | PTBA
    t.integer('entity_id').notNullable();
    t.text('libelle').notNullable();
    t.integer('probabilite').notNullable(); // 1 faible · 2 moyenne · 3 forte
    t.integer('impact').notNullable(); // 1 faible · 2 moyen · 3 fort
    t.text('mesures');
    t.string('responsable', 200);
    t.date('echeance');
    t.string('statut', 20).notNullable().defaultTo('OUVERT'); // OUVERT | MAITRISE | CLOS
    t.integer('created_by').notNullable().references('users.id');
    t.timestamps(true, true);
    t.index(['entity_type', 'entity_id']);
  });
  await knex.raw(`ALTER TABLE risques ADD CONSTRAINT risques_chk CHECK (entity_type IN ('PIP','PROGRAMME','PTBA')
    AND probabilite BETWEEN 1 AND 3 AND impact BETWEEN 1 AND 3 AND statut IN ('OUVERT','MAITRISE','CLOS'))`);
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('risques');
  await knex.schema.dropTableIfExists('pip_jalons');
  await knex.raw('ALTER TABLE pip_projects DROP CONSTRAINT IF EXISTS pip_maturite_chk');
  await knex.schema.alterTable('pip_projects', (t) => { t.dropColumn('maturite'); t.dropColumn('programme_id'); t.dropColumn('localisation'); t.dropColumn('partenaires'); });
  await knex.raw('DROP TRIGGER IF EXISTS trg_plan_document_valide ON plan_documents');
  await knex.raw('DROP FUNCTION IF EXISTS plan_document_valide()');
  await knex.schema.dropTableIfExists('plan_documents');
  await knex.schema.dropTableIfExists('plan_credits');
  await knex.schema.dropTableIfExists('plan_postes_budgetaires');
  await knex.schema.dropTableIfExists('plan_indicateur_valeurs');
  await knex.schema.dropTableIfExists('plan_indicateurs');
  await knex.schema.dropTableIfExists('plan_objectifs');
};

'use strict';

/**
 * Organisation administrative de la Direction d’Études et Planification (DEP).
 *
 * Distinction fondamentale :
 *  - rang_organique : ce qu’est la structure (DIRECTION, DIVISION, BUREAU) ;
 *  - rattachement (parent_type / division_id / superieur_direct) : à qui elle rend compte.
 *
 * Un Bureau peut être rattaché à une Division (cas ordinaire) ou directement à la Direction
 * (Bureau Secrétariat de Direction). Dans les deux cas son rang reste BUREAU : les contraintes
 * CHECK ci-dessous l’imposent au niveau de la base de données.
 */
exports.up = async function up(knex) {
  await knex.schema.createTable('directions', (t) => {
    t.increments('id');
    t.string('code', 20).notNullable().unique();
    t.string('sigle', 20).notNullable();
    t.string('nom', 200).notNullable();
    t.string('rang_organique', 20).notNullable().defaultTo('DIRECTION');
    t.string('autorite_tutelle', 200);
    t.text('missions');
    t.boolean('actif').notNullable().defaultTo(true);
    t.timestamps(true, true);
  });
  await knex.raw(`ALTER TABLE directions ADD CONSTRAINT directions_rang_chk CHECK (rang_organique = 'DIRECTION')`);

  await knex.schema.createTable('divisions', (t) => {
    t.increments('id');
    t.integer('direction_id').notNullable().references('directions.id').onDelete('RESTRICT');
    t.string('code', 20).notNullable().unique();
    t.string('nom', 200).notNullable();
    t.string('type_structure', 20).notNullable().defaultTo('DIVISION');
    t.string('rang_organique', 20).notNullable().defaultTo('DIVISION');
    t.string('responsable_role', 30).notNullable().defaultTo('CHEF_DIVISION');
    t.string('perimetre_acces', 30).notNullable().defaultTo('DIVISION');
    t.string('superieur_direct', 30).notNullable().defaultTo('DIRECTEUR');
    t.text('missions');
    t.integer('ordre').notNullable().defaultTo(0);
    t.boolean('actif').notNullable().defaultTo(true);
    t.timestamp('archived_at');
    t.timestamps(true, true);
    t.index(['direction_id']);
  });
  await knex.raw(`ALTER TABLE divisions ADD CONSTRAINT divisions_rang_chk CHECK (
    type_structure = 'DIVISION' AND rang_organique = 'DIVISION' AND responsable_role = 'CHEF_DIVISION'
    AND perimetre_acces = 'DIVISION' AND superieur_direct = 'DIRECTEUR')`);

  await knex.schema.createTable('bureaux', (t) => {
    t.increments('id');
    t.integer('direction_id').notNullable().references('directions.id').onDelete('RESTRICT');
    t.integer('division_id').nullable().references('divisions.id').onDelete('RESTRICT');
    t.string('code', 20).notNullable().unique();
    t.string('nom', 200).notNullable();
    t.string('type_structure', 20).notNullable().defaultTo('BUREAU');
    t.string('rang_organique', 20).notNullable().defaultTo('BUREAU');
    t.string('parent_type', 20).notNullable(); // DIVISION | DIRECTION (rattachement uniquement)
    t.string('responsable_role', 30).notNullable().defaultTo('CHEF_BUREAU');
    t.string('perimetre_acces', 30).notNullable().defaultTo('BUREAU');
    t.string('superieur_direct', 30).notNullable(); // CHEF_DIVISION | DIRECTEUR
    t.boolean('est_secretariat_direction').notNullable().defaultTo(false);
    t.text('missions');
    t.integer('ordre').notNullable().defaultTo(0);
    t.boolean('actif').notNullable().defaultTo(true);
    t.timestamp('archived_at');
    t.timestamps(true, true);
    t.index(['direction_id']);
    t.index(['division_id']);
  });
  await knex.raw(`ALTER TABLE bureaux ADD CONSTRAINT bureaux_rang_chk CHECK (
    type_structure = 'BUREAU' AND rang_organique = 'BUREAU'
    AND responsable_role = 'CHEF_BUREAU' AND perimetre_acces = 'BUREAU')`);
  await knex.raw(`ALTER TABLE bureaux ADD CONSTRAINT bureaux_rattachement_chk CHECK (
    (parent_type = 'DIVISION' AND division_id IS NOT NULL AND superieur_direct = 'CHEF_DIVISION')
    OR (parent_type = 'DIRECTION' AND division_id IS NULL AND superieur_direct = 'DIRECTEUR'))`);
  await knex.raw(`ALTER TABLE bureaux ADD CONSTRAINT bureaux_secretariat_chk CHECK (
    est_secretariat_direction = false OR parent_type = 'DIRECTION')`);
  // Un seul Bureau Secrétariat de Direction par Direction
  await knex.raw(`CREATE UNIQUE INDEX bureaux_un_secretariat_par_direction ON bureaux(direction_id) WHERE est_secretariat_direction`);

  // Vue unifiée des structures : rang et rattachement présentés séparément.
  await knex.raw(`CREATE VIEW v_structures AS
    SELECT 'DIRECTION'::text AS type_structure, d.id, d.code, d.nom, d.rang_organique,
           NULL::text AS parent_type, NULL::int AS parent_id, d.id AS direction_id, NULL::int AS division_id,
           NULL::text AS superieur_direct, 'DIRECTION'::text AS perimetre_acces, 'DIRECTEUR'::text AS responsable_role,
           false AS est_secretariat_direction, d.actif
      FROM directions d
    UNION ALL
    SELECT 'DIVISION', v.id, v.code, v.nom, v.rang_organique, 'DIRECTION', v.direction_id, v.direction_id, v.id,
           v.superieur_direct, v.perimetre_acces, v.responsable_role, false, v.actif
      FROM divisions v
    UNION ALL
    SELECT 'BUREAU', b.id, b.code, b.nom, b.rang_organique, b.parent_type,
           COALESCE(b.division_id, b.direction_id), b.direction_id, b.division_id,
           b.superieur_direct, b.perimetre_acces, b.responsable_role, b.est_secretariat_direction, b.actif
      FROM bureaux b`);

  await knex.schema.createTable('grades', (t) => {
    t.increments('id');
    t.string('code', 20).notNullable().unique();
    t.string('libelle', 150).notNullable();
    t.string('categorie', 80);
    t.integer('niveau').notNullable().defaultTo(0);
    t.boolean('actif').notNullable().defaultTo(true);
    t.timestamps(true, true);
  });

  await knex.schema.createTable('fonctions', (t) => {
    t.increments('id');
    t.string('code', 30).notNullable().unique();
    t.string('libelle', 150).notNullable();
    t.integer('grade_id').references('grades.id').onDelete('SET NULL'); // grade correspondant
    t.text('description');
    t.boolean('actif').notNullable().defaultTo(true);
    t.timestamps(true, true);
  });

  await knex.schema.createTable('postes_organiques', (t) => {
    t.increments('id');
    t.string('code', 30).notNullable().unique();
    t.string('libelle', 200).notNullable();
    t.string('niveau', 20).notNullable(); // DIRECTION | DIVISION | BUREAU
    t.string('role_associe', 30).notNullable(); // DIRECTEUR | CHEF_DIVISION | CHEF_BUREAU | AGENT
    t.integer('direction_id').references('directions.id');
    t.integer('division_id').references('divisions.id');
    t.integer('bureau_id').references('bureaux.id');
    t.integer('grade_minimum_id').references('grades.id');
    t.text('description');
    t.boolean('actif').notNullable().defaultTo(true);
    t.timestamps(true, true);
  });
  await knex.raw(`ALTER TABLE postes_organiques ADD CONSTRAINT postes_niveau_chk CHECK (
    (niveau = 'DIRECTION' AND role_associe IN ('DIRECTEUR'))
    OR (niveau = 'DIVISION' AND role_associe IN ('CHEF_DIVISION') AND division_id IS NOT NULL)
    OR (niveau = 'BUREAU' AND role_associe IN ('CHEF_BUREAU','AGENT')))`);

  // Missions, attributions et responsabilités (cadre organique)
  await knex.schema.createTable('attributions', (t) => {
    t.increments('id');
    t.string('cible_type', 20).notNullable(); // DIRECTION | DIVISION | BUREAU | POSTE | ROLE
    t.integer('direction_id').references('directions.id');
    t.integer('division_id').references('divisions.id');
    t.integer('bureau_id').references('bureaux.id');
    t.integer('poste_id').references('postes_organiques.id');
    t.string('role_code', 30); // pour les responsabilités par rôle
    t.string('categorie', 20).notNullable(); // MISSION | ATTRIBUTION | RESPONSABILITE
    t.string('libelle', 500).notNullable();
    t.text('description');
    t.integer('ordre').notNullable().defaultTo(0);
    t.boolean('actif').notNullable().defaultTo(true);
    t.timestamps(true, true);
    t.index(['cible_type', 'direction_id', 'division_id', 'bureau_id']);
  });
  await knex.raw(`ALTER TABLE attributions ADD CONSTRAINT attributions_cat_chk CHECK (categorie IN ('MISSION','ATTRIBUTION','RESPONSABILITE'))`);

  await knex.schema.createTable('agents', (t) => {
    t.increments('id');
    t.string('matricule', 40).notNullable().unique();
    t.string('nom', 100).notNullable();
    t.string('postnom', 100);
    t.string('prenom', 100);
    t.string('sexe', 1).notNullable();
    t.date('date_naissance');
    t.integer('grade_id').references('grades.id');
    t.integer('fonction_id').references('fonctions.id');
    t.string('telephone', 40);
    t.string('email', 150);
    t.string('adresse', 300);
    t.string('photo_path', 200);
    t.string('statut', 20).notNullable().defaultTo('ACTIF'); // ACTIF | CONGE | DETACHE | SUSPENDU | RETRAITE | ARCHIVE
    t.boolean('est_autorite').notNullable().defaultTo(false); // Secrétaire Général : autorité hors DEP
    t.timestamp('archived_at');
    t.timestamps(true, true);
    t.index(['nom']);
  });
  await knex.raw(`ALTER TABLE agents ADD CONSTRAINT agents_sexe_chk CHECK (sexe IN ('M','F'))`);

  await knex.schema.createTable('affectations', (t) => {
    t.increments('id');
    t.integer('agent_id').notNullable().references('agents.id').onDelete('RESTRICT');
    t.integer('direction_id').notNullable().references('directions.id');
    t.integer('division_id').references('divisions.id');
    t.integer('bureau_id').references('bureaux.id');
    t.integer('poste_id').references('postes_organiques.id');
    t.string('niveau', 20).notNullable(); // DIRECTION | DIVISION | BUREAU
    t.date('date_debut').notNullable();
    t.date('date_fin');
    t.boolean('est_active').notNullable().defaultTo(true);
    t.string('motif', 300);
    t.string('motif_cloture', 300);
    t.integer('created_by');
    t.integer('closed_by');
    t.timestamps(true, true);
    t.index(['agent_id']);
    t.index(['bureau_id']);
    t.index(['division_id']);
  });
  await knex.raw(`CREATE UNIQUE INDEX affectations_une_active_par_agent ON affectations(agent_id) WHERE est_active`);
  await knex.raw(`ALTER TABLE affectations ADD CONSTRAINT affectations_niveau_chk CHECK (
    (niveau = 'DIRECTION' AND division_id IS NULL AND bureau_id IS NULL)
    OR (niveau = 'DIVISION' AND division_id IS NOT NULL AND bureau_id IS NULL)
    OR (niveau = 'BUREAU' AND bureau_id IS NOT NULL))`);
  await knex.raw(`ALTER TABLE affectations ADD CONSTRAINT affectations_cloture_chk CHECK (
    est_active OR date_fin IS NOT NULL)`);

  // Cohérence : la division d’une affectation en Bureau doit être celle du Bureau (NULL pour le Secrétariat).
  await knex.raw(`
    CREATE OR REPLACE FUNCTION sigdep_affectation_coherence() RETURNS trigger AS $$
    DECLARE b_div int; b_dir int;
    BEGIN
      IF NEW.bureau_id IS NOT NULL THEN
        SELECT division_id, direction_id INTO b_div, b_dir FROM bureaux WHERE id = NEW.bureau_id;
        NEW.division_id := b_div;
        NEW.direction_id := b_dir;
      END IF;
      RETURN NEW;
    END; $$ LANGUAGE plpgsql;
    CREATE TRIGGER trg_affectation_coherence BEFORE INSERT OR UPDATE ON affectations
      FOR EACH ROW EXECUTE FUNCTION sigdep_affectation_coherence();
  `);
};

exports.down = async function down(knex) {
  await knex.raw('DROP TRIGGER IF EXISTS trg_affectation_coherence ON affectations');
  await knex.raw('DROP FUNCTION IF EXISTS sigdep_affectation_coherence()');
  await knex.schema.dropTableIfExists('affectations');
  await knex.schema.dropTableIfExists('agents');
  await knex.schema.dropTableIfExists('attributions');
  await knex.schema.dropTableIfExists('postes_organiques');
  await knex.schema.dropTableIfExists('fonctions');
  await knex.schema.dropTableIfExists('grades');
  await knex.raw('DROP VIEW IF EXISTS v_structures');
  await knex.schema.dropTableIfExists('bureaux');
  await knex.schema.dropTableIfExists('divisions');
  await knex.schema.dropTableIfExists('directions');
};

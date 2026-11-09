'use strict';
/**
 * Lot E (étape 2) — Évaluation des politiques : circuit, lettre de transmission et CDS-MT
 * (cahier, §§ 33, 34 et 51).
 *  - circuit : Bureau Suivi-Évaluation (préparation, soumission) → Chef de la Division Programme et
 *    Suivi (vérification) → Directeur (validation et signature de la lettre, qui reçoit son numéro
 *    officiel) → transmission au Secrétaire Général (Directeur ou Secrétariat de Direction), puis
 *    archivage : le dossier transmis est intangible ;
 *  - lettre de transmission : contenu, numéro officiel (séquence de la correspondance), date ;
 *  - CDS-MT : projections sur trois ans reportées depuis l’annexe II à la transmission, en ajout seul.
 */
exports.up = async function up(knex) {
  await knex.schema.alterTable('evaluations', (t) => {
    t.jsonb('lettre').notNullable().defaultTo('{}');
    t.string('numero_lettre', 120);
    t.timestamp('numerote_at');
    t.integer('identite_version_id');
    t.integer('soumis_par').references('users.id');
    t.timestamp('soumis_at');
    t.integer('transmis_par').references('users.id');
    t.timestamp('transmis_at');
  });
  // Intangibilité étendue à la lettre et à son numéro ; seule la transmission suit la validation.
  await knex.raw(`
    CREATE OR REPLACE FUNCTION evaluation_valide_intangible() RETURNS trigger AS $$
    BEGIN
      IF TG_OP = 'DELETE' AND OLD.statut IN ('VALIDE','TRANSMIS') THEN RAISE EXCEPTION 'EVALUATION_VERROUILLEE: dossier d’évaluation validé, non supprimable'; END IF;
      IF TG_OP = 'UPDATE' AND OLD.statut IN ('VALIDE','TRANSMIS')
         AND ((NEW.annee, NEW.annee_projection, NEW.note, NEW.convocation_reference, NEW.convocation_date, NEW.lettre, NEW.numero_lettre, NEW.numerote_at)
              IS DISTINCT FROM (OLD.annee, OLD.annee_projection, OLD.note, OLD.convocation_reference, OLD.convocation_date, OLD.lettre, OLD.numero_lettre, OLD.numerote_at)
           OR NOT (NEW.statut = OLD.statut OR (OLD.statut = 'VALIDE' AND NEW.statut = 'TRANSMIS'))
           OR (OLD.statut = 'TRANSMIS' AND (NEW.transmis_at, NEW.transmis_par) IS DISTINCT FROM (OLD.transmis_at, OLD.transmis_par))) THEN
        RAISE EXCEPTION 'EVALUATION_VERROUILLEE: dossier d’évaluation validé, non modifiable';
      END IF;
      IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
      RETURN NEW;
    END $$ LANGUAGE plpgsql;`);

  await knex.schema.createTable('cdsmt_projections', (t) => {
    t.increments('id');
    t.integer('evaluation_id').notNullable().references('evaluations.id');
    t.string('cle', 60).notNullable(); // action ou programme repris (ACTION:12) ; LIGNE:id pour une ligne ajoutée
    t.text('action').notNullable();
    t.integer('annee').notNullable();
    t.decimal('montant', 20, 2).notNullable();
    t.boolean('etude_faisabilite');
    t.text('objectif_pag');
    t.integer('reporte_par').references('users.id');
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.unique(['evaluation_id', 'cle', 'annee']);
    t.index(['annee']);
  });
  await knex.raw(`ALTER TABLE cdsmt_projections ADD CONSTRAINT cdsmt_projections_chk CHECK (montant >= 0 AND annee BETWEEN 2000 AND 2110)`);
  await knex.raw(`
    CREATE OR REPLACE FUNCTION cdsmt_ajout_seul() RETURNS trigger AS $$
    BEGIN RAISE EXCEPTION 'APPEND_ONLY: les projections reportées dans le CDS-MT ne se modifient pas'; END $$ LANGUAGE plpgsql;
    CREATE TRIGGER trg_cdsmt_ajout_seul BEFORE UPDATE OR DELETE ON cdsmt_projections FOR EACH ROW EXECUTE FUNCTION cdsmt_ajout_seul();`);

  // Validation du dossier : Directeur (rôle) ; vérification et transmission : par structure (context.js)
  const [perm] = await knex('permissions').insert({ code: 'evaluation.valider', module: 'planification', libelle: 'Valider le dossier d’évaluation des politiques et signer la lettre de transmission' })
    .onConflict('code').merge(['libelle']).returning('id');
  const dir = await knex('roles').where({ code: 'DIRECTEUR' }).first();
  if (dir) await knex('role_permissions').insert({ role_id: dir.id, permission_id: perm.id || perm }).onConflict(['role_id', 'permission_id']).ignore();
};

exports.down = async function down(knex) {
  const perm = await knex('permissions').where({ code: 'evaluation.valider' }).first();
  if (perm) {
    await knex('role_permissions').where({ permission_id: perm.id }).del();
    await knex('user_permissions').where({ permission_id: perm.id }).del();
    await knex('permissions').where({ id: perm.id }).del();
  }
  await knex.raw('DROP TRIGGER IF EXISTS trg_cdsmt_ajout_seul ON cdsmt_projections');
  await knex.raw('DROP FUNCTION IF EXISTS cdsmt_ajout_seul()');
  await knex.schema.dropTableIfExists('cdsmt_projections');
  await knex.raw(`
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
    END $$ LANGUAGE plpgsql;`);
  await knex.schema.alterTable('evaluations', (t) => {
    for (const c of ['lettre', 'numero_lettre', 'numerote_at', 'identite_version_id', 'soumis_par', 'soumis_at', 'transmis_par', 'transmis_at']) t.dropColumn(c);
  });
};

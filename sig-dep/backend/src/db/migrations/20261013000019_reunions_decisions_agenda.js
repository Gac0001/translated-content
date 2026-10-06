'use strict';
/**
 * Lot 8B — Réunions, décisions et agenda du Directeur (cahier des charges, §§ 14, 16 et 25).
 *  - réunions : ordre du jour, participants internes et externes, convocation, présence,
 *    compte rendu rédigé puis validé par le président, verrouillé une fois validé ;
 *  - décisions : issues d’une réunion ou prises par le Directeur, avec responsable, échéance et
 *    résultat ; transformables en instruction ou en tâche ; registre des décisions ;
 *  - agenda du Directeur tenu par le Bureau Secrétariat de Direction, avec rappels.
 */
const PERMISSIONS = [
  ['reunions.organiser', 'reunions', 'Organiser les réunions de sa structure (ordre du jour, convocation, compte rendu)', ['DIRECTEUR', 'CHEF_DIVISION', 'CHEF_BUREAU']],
  ['decisions.prendre', 'decisions', 'Prendre et enregistrer les décisions du Directeur, les abandonner', ['DIRECTEUR']],
  ['agenda.consulter', 'agenda', 'Consulter l’agenda du Directeur', ['DIRECTEUR']],
  ['agenda.gerer', 'agenda', 'Tenir l’agenda du Directeur (audiences, réunions, rappels)', ['DIRECTEUR']],
];

exports.up = async function up(knex) {
  await knex.schema.createTable('reunions', (t) => {
    t.increments('id');
    t.string('reference', 60).notNullable().unique();
    t.string('objet', 300).notNullable();
    t.string('niveau', 20).notNullable(); // DIRECTION | DIVISION | BUREAU
    t.timestamp('debut').notNullable();
    t.timestamp('fin');
    t.string('lieu', 200);
    t.jsonb('ordre_du_jour').notNullable().defaultTo('[]'); // [{ titre, rapporteur, duree }]
    t.integer('president_user_id').notNullable().references('users.id');
    t.integer('organisateur_user_id').notNullable().references('users.id');
    t.integer('redacteur_user_id').references('users.id'); // rédige le compte rendu
    t.string('statut', 20).notNullable().defaultTo('BROUILLON');
    t.string('confidentialite', 20).notNullable().defaultTo('ORDINAIRE');
    t.text('compte_rendu');
    t.text('observations_president');
    t.timestamp('convoquee_at');
    t.timestamp('tenue_at');
    t.timestamp('cr_soumis_at');
    t.integer('cr_valide_par').references('users.id');
    t.timestamp('cr_valide_at');
    t.text('motif_annulation');
    t.boolean('rappel_envoye').notNullable().defaultTo(false);
    t.integer('direction_id').notNullable().references('directions.id');
    t.integer('division_id').references('divisions.id');
    t.integer('bureau_id').references('bureaux.id');
    t.timestamps(true, true);
    t.index(['debut']);
    t.index(['statut']);
  });
  await knex.raw(`ALTER TABLE reunions ADD CONSTRAINT reunions_chk CHECK (
    niveau IN ('DIRECTION','DIVISION','BUREAU')
    AND statut IN ('BROUILLON','CONVOQUEE','TENUE','CR_A_VALIDER','CLOTUREE','ANNULEE')
    AND confidentialite IN ('ORDINAIRE','CONFIDENTIEL','SECRET')
    AND (fin IS NULL OR fin > debut))`);
  // Compte rendu validé : intangible (aucune modification, aucune suppression)
  await knex.raw(`
    CREATE OR REPLACE FUNCTION reunions_cr_intangible() RETURNS trigger AS $$
    BEGIN
      IF TG_OP = 'DELETE' THEN
        IF OLD.statut = 'CLOTUREE' THEN RAISE EXCEPTION 'CR_VERROUILLE: compte rendu validé, réunion intangible'; END IF;
        RETURN OLD;
      END IF;
      IF OLD.statut = 'CLOTUREE' AND (NEW.compte_rendu, NEW.ordre_du_jour, NEW.objet, NEW.debut, NEW.president_user_id, NEW.statut)
         IS DISTINCT FROM (OLD.compte_rendu, OLD.ordre_du_jour, OLD.objet, OLD.debut, OLD.president_user_id, OLD.statut) THEN
        RAISE EXCEPTION 'CR_VERROUILLE: compte rendu validé, réunion intangible';
      END IF;
      RETURN NEW;
    END $$ LANGUAGE plpgsql;
    CREATE TRIGGER trg_reunions_cr_intangible BEFORE UPDATE OR DELETE ON reunions FOR EACH ROW EXECUTE FUNCTION reunions_cr_intangible();
  `);

  await knex.schema.createTable('reunion_participants', (t) => {
    t.increments('id');
    t.integer('reunion_id').notNullable().references('reunions.id').onDelete('CASCADE');
    t.integer('user_id').references('users.id');
    t.string('nom_externe', 200);
    t.string('qualite_externe', 200);
    t.string('presence', 20); // PRESENT | ABSENT | EXCUSE | REPRESENTE
    t.string('represente_par', 200);
    t.unique(['reunion_id', 'user_id']);
  });
  await knex.raw(`ALTER TABLE reunion_participants ADD CONSTRAINT reunion_participants_chk CHECK (
    (user_id IS NOT NULL) <> (nom_externe IS NOT NULL)
    AND (presence IS NULL OR presence IN ('PRESENT','ABSENT','EXCUSE','REPRESENTE')))`);

  await knex.schema.createTable('decisions', (t) => {
    t.increments('id');
    t.string('reference', 60).notNullable().unique();
    t.string('origine', 20).notNullable(); // REUNION | DIRECTEUR
    t.integer('reunion_id').references('reunions.id');
    t.string('libelle', 500).notNullable();
    t.text('description');
    t.text('resultat_attendu');
    t.integer('responsable_user_id').notNullable().references('users.id');
    t.date('echeance');
    t.string('statut', 20).notNullable().defaultTo('PROJET');
    t.text('resultat');
    t.text('motif_abandon');
    t.integer('decideur_user_id').notNullable().references('users.id'); // président de réunion ou Directeur
    t.integer('instruction_id').references('instructions.id');
    t.integer('task_id').references('tasks.id');
    t.integer('direction_id').notNullable().references('directions.id');
    t.integer('division_id').references('divisions.id');
    t.integer('bureau_id').references('bureaux.id');
    t.integer('created_by').notNullable().references('users.id');
    t.timestamp('decidee_at');
    t.timestamp('executee_at');
    t.timestamps(true, true);
    t.index(['statut']);
    t.index(['responsable_user_id']);
  });
  await knex.raw(`ALTER TABLE decisions ADD CONSTRAINT decisions_chk CHECK (
    origine IN ('REUNION','DIRECTEUR')
    AND statut IN ('PROJET','A_EXECUTER','EN_COURS','EXECUTEE','ABANDONNEE')
    AND (origine <> 'REUNION' OR reunion_id IS NOT NULL))`);

  await knex.schema.createTable('agenda_evenements', (t) => {
    t.increments('id');
    t.string('type', 20).notNullable(); // AUDIENCE | REUNION | DEPLACEMENT | CEREMONIE | AUTRE
    t.string('titre', 300).notNullable();
    t.timestamp('debut').notNullable();
    t.timestamp('fin');
    t.string('lieu', 200);
    t.string('interlocuteur', 300);
    t.text('notes');
    t.string('statut', 20).notNullable().defaultTo('PREVU'); // PREVU | CONFIRME | TENU | ANNULE
    t.boolean('confidentiel').notNullable().defaultTo(false);
    t.integer('reunion_id').references('reunions.id').onDelete('SET NULL');
    t.boolean('rappel_veille_envoye').notNullable().defaultTo(false);
    t.boolean('rappel_heure_envoye').notNullable().defaultTo(false);
    t.integer('created_by').notNullable().references('users.id');
    t.timestamps(true, true);
    t.index(['debut']);
  });
  await knex.raw(`ALTER TABLE agenda_evenements ADD CONSTRAINT agenda_chk CHECK (
    type IN ('AUDIENCE','REUNION','DEPLACEMENT','CEREMONIE','AUTRE')
    AND statut IN ('PREVU','CONFIRME','TENU','ANNULE') AND (fin IS NULL OR fin > debut))`);

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
  await knex.schema.dropTableIfExists('agenda_evenements');
  await knex.schema.dropTableIfExists('decisions');
  await knex.schema.dropTableIfExists('reunion_participants');
  await knex.raw('DROP TRIGGER IF EXISTS trg_reunions_cr_intangible ON reunions');
  await knex.raw('DROP FUNCTION IF EXISTS reunions_cr_intangible()');
  await knex.schema.dropTableIfExists('reunions');
};

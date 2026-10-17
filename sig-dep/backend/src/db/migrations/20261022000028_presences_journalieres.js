'use strict';
/**
 * Lot B — Présences journalières (cahier des charges, sections 25 et 46, annexe 11).
 *  - Seul le Secrétariat de Direction gère les présences (permission « presences.preparer_direction »,
 *    accordée par la structure d’affectation et désignable) ; les Chefs de Division et de Bureau
 *    passent en consultation ; le Directeur verrouille, rejette et valide les rectificatifs.
 *  - Chaque jour ouvrable : deux listes, Cadres (Chef de Bureau et au-dessus) et Agents ; pour
 *    chaque agent, heure d’arrivée (H-A) et heure de départ (H-D), ou un motif d’absence avec
 *    éventuellement une pièce.
 *  - Rapport hebdomadaire : en préparation → transmis (verrouillage des listes de la semaine) →
 *    verrouillé définitivement ou rejeté (motif) ; correction par rectificatif validé par le
 *    Directeur, l’original restant intact.
 *  - Horaires de référence et tolérance de retard (paramètres), jours fériés.
 *  - Les anciennes listes hebdomadaires par Bureau restent consultables, en lecture seule.
 */
const MOTIFS = ['MISSION', 'CONGE', 'MALADIE', 'PERMISSION', 'FORMATION', 'ABSENT_NON_JUSTIFIE'];

exports.MOTIFS = MOTIFS;

exports.up = async function up(knex) {
  await knex.schema.createTable('jours_feries', (t) => {
    t.increments('id');
    t.date('date').notNullable().unique();
    t.string('libelle', 200).notNullable();
    t.integer('created_by');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });

  await knex.schema.createTable('presence_semaines', (t) => {
    t.increments('id');
    t.string('reference', 60).notNullable().unique();
    t.date('semaine_debut').notNullable().unique(); // lundi
    t.date('semaine_fin').notNullable(); // vendredi
    t.integer('annee').notNullable();
    t.integer('numero_semaine').notNullable();
    t.string('statut', 20).notNullable().defaultTo('EN_PREPARATION');
    t.integer('transmis_par').references('users.id');
    t.timestamp('transmis_at', { useTz: true });
    t.integer('verrouille_par').references('users.id');
    t.timestamp('verrouille_at', { useTz: true });
    t.text('commentaire_verrouillage');
    t.integer('rejete_par').references('users.id');
    t.timestamp('rejete_at', { useTz: true });
    t.text('motif_rejet');
    t.integer('created_by').references('users.id');
    t.timestamps(true, true);
  });
  await knex.raw(`ALTER TABLE presence_semaines ADD CONSTRAINT presence_semaines_chk CHECK (statut IN ('EN_PREPARATION','TRANSMIS','VERROUILLE','REJETE'))`);

  await knex.schema.createTable('presence_listes', (t) => {
    t.increments('id');
    t.integer('semaine_id').notNullable().references('presence_semaines.id').onDelete('RESTRICT');
    t.date('date').notNullable();
    t.string('categorie', 10).notNullable(); // CADRES | AGENTS
    t.string('statut', 20).notNullable().defaultTo('BROUILLON');
    // Horaires de référence au moment de la saisie (le calcul des retards ne change pas après coup)
    t.string('heure_arrivee_ref', 5).notNullable();
    t.string('heure_depart_ref', 5).notNullable();
    t.integer('tolerance_minutes').notNullable();
    t.integer('created_by').references('users.id');
    t.integer('updated_by').references('users.id');
    t.timestamps(true, true);
    t.unique(['date', 'categorie']);
  });
  await knex.raw(`ALTER TABLE presence_listes ADD CONSTRAINT presence_listes_chk CHECK (categorie IN ('CADRES','AGENTS') AND statut IN ('BROUILLON','TRANSMISE','VERROUILLEE')
    AND EXTRACT(ISODOW FROM date) BETWEEN 1 AND 5)`);

  await knex.schema.createTable('presence_lignes', (t) => {
    t.increments('id');
    t.integer('liste_id').notNullable().references('presence_listes.id').onDelete('RESTRICT');
    t.integer('agent_id').notNullable().references('agents.id');
    t.integer('ordre').notNullable().defaultTo(0);
    t.string('structure_code', 20); // regroupement de l’annexe 11 (I.1, I.2.1…)
    t.string('structure_libelle', 200);
    t.string('grade_code', 20);
    t.integer('division_id'); // affectation au moment de la saisie (périmètre de consultation des Chefs)
    t.integer('bureau_id');
    t.string('heure_arrivee', 5);
    t.string('heure_depart', 5);
    t.string('motif', 24);
    t.integer('piece_id').references('attachments.id');
    t.integer('retard_minutes').notNullable().defaultTo(0);
    t.text('observation');
    t.unique(['liste_id', 'agent_id']);
  });
  await knex.raw(`ALTER TABLE presence_lignes ADD CONSTRAINT presence_lignes_chk CHECK (
    (motif IS NULL OR motif IN (${MOTIFS.map((m) => `'${m}'`).join(',')}))
    AND (motif IS NULL OR (heure_arrivee IS NULL AND heure_depart IS NULL))
    AND (heure_arrivee IS NULL OR heure_arrivee ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')
    AND (heure_depart IS NULL OR heure_depart ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')
    AND (heure_arrivee IS NULL OR heure_depart IS NULL OR heure_depart >= heure_arrivee)
    AND retard_minutes >= 0)`);

  await knex.schema.createTable('presence_rectificatifs', (t) => {
    t.increments('id');
    t.string('reference', 60).notNullable().unique();
    t.integer('liste_id').notNullable().references('presence_listes.id').onDelete('RESTRICT');
    t.string('statut', 20).notNullable().defaultTo('PROPOSE');
    t.text('motif').notNullable();
    t.jsonb('lignes').notNullable(); // [{ agent_id, heure_arrivee, heure_depart, motif, piece_id, observation, retard_minutes, avant: {...} }]
    t.integer('cree_par').notNullable().references('users.id');
    t.timestamp('cree_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.integer('decide_par').references('users.id');
    t.timestamp('decide_at', { useTz: true });
    t.text('commentaire_decision');
  });
  await knex.raw(`ALTER TABLE presence_rectificatifs ADD CONSTRAINT presence_rectificatifs_chk CHECK (statut IN ('PROPOSE','VALIDE','REFUSE'))`);

  // Verrous : une liste transmise ou verrouillée est intangible (lignes comprises) ; une semaine
  // verrouillée l’est aussi ; un rectificatif décidé ne change plus.
  await knex.raw(`
    CREATE OR REPLACE FUNCTION trg_fn_presence_lignes_lock() RETURNS trigger AS $$
    DECLARE s text;
    BEGIN
      SELECT statut INTO s FROM presence_listes WHERE id = COALESCE(NEW.liste_id, OLD.liste_id);
      IF s <> 'BROUILLON' THEN
        RAISE EXCEPTION 'PRESENCE_LOCKED: Liste transmise ou verrouillée : toute correction passe par un rectificatif.';
      END IF;
      IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
      RETURN NEW;
    END; $$ LANGUAGE plpgsql;
    CREATE TRIGGER trg_presence_lignes_lock BEFORE INSERT OR UPDATE OR DELETE ON presence_lignes
      FOR EACH ROW EXECUTE FUNCTION trg_fn_presence_lignes_lock();

    CREATE OR REPLACE FUNCTION trg_fn_presence_listes_lock() RETURNS trigger AS $$
    BEGIN
      IF TG_OP = 'DELETE' THEN
        IF OLD.statut <> 'BROUILLON' THEN RAISE EXCEPTION 'PRESENCE_LOCKED: Seule une liste en préparation peut être supprimée.'; END IF;
        RETURN OLD;
      END IF;
      IF OLD.statut = 'VERROUILLEE' THEN RAISE EXCEPTION 'PRESENCE_LOCKED: Liste verrouillée : aucune modification possible.'; END IF;
      IF OLD.statut = 'TRANSMISE' AND NOT (NEW.statut = 'VERROUILLEE' AND (NEW.date, NEW.categorie, NEW.semaine_id) IS NOT DISTINCT FROM (OLD.date, OLD.categorie, OLD.semaine_id)) THEN
        RAISE EXCEPTION 'PRESENCE_LOCKED: Liste transmise : seule la transition vers « Verrouillée » est permise.';
      END IF;
      RETURN NEW;
    END; $$ LANGUAGE plpgsql;
    CREATE TRIGGER trg_presence_listes_lock BEFORE UPDATE OR DELETE ON presence_listes
      FOR EACH ROW EXECUTE FUNCTION trg_fn_presence_listes_lock();

    CREATE OR REPLACE FUNCTION trg_fn_presence_semaines_lock() RETURNS trigger AS $$
    BEGIN
      IF TG_OP = 'DELETE' AND OLD.statut <> 'EN_PREPARATION' THEN RAISE EXCEPTION 'PRESENCE_LOCKED: Rapport transmis : suppression impossible.'; END IF;
      IF TG_OP = 'UPDATE' AND OLD.statut = 'VERROUILLE' THEN RAISE EXCEPTION 'PRESENCE_LOCKED: Rapport verrouillé définitivement.'; END IF;
      IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
      RETURN NEW;
    END; $$ LANGUAGE plpgsql;
    CREATE TRIGGER trg_presence_semaines_lock BEFORE UPDATE OR DELETE ON presence_semaines
      FOR EACH ROW EXECUTE FUNCTION trg_fn_presence_semaines_lock();

    CREATE OR REPLACE FUNCTION trg_fn_presence_rectificatifs_lock() RETURNS trigger AS $$
    BEGIN
      IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'APPEND_ONLY: Un rectificatif ne se supprime pas.'; END IF;
      IF OLD.statut <> 'PROPOSE' THEN RAISE EXCEPTION 'PRESENCE_LOCKED: Rectificatif déjà décidé.'; END IF;
      IF (NEW.liste_id, NEW.motif, NEW.lignes, NEW.cree_par) IS DISTINCT FROM (OLD.liste_id, OLD.motif, OLD.lignes, OLD.cree_par) THEN
        RAISE EXCEPTION 'PRESENCE_LOCKED: Seule la décision du Directeur s’enregistre sur un rectificatif.';
      END IF;
      RETURN NEW;
    END; $$ LANGUAGE plpgsql;
    CREATE TRIGGER trg_presence_rectificatifs_lock BEFORE UPDATE OR DELETE ON presence_rectificatifs
      FOR EACH ROW EXECUTE FUNCTION trg_fn_presence_rectificatifs_lock();
  `);

  // Horaires de référence (modifiables par le Directeur)
  for (const [cle, valeur, libelle] of [
    ['presence_heure_arrivee', '08:00', 'Heure normale d’arrivée (présences)'],
    ['presence_heure_depart', '15:30', 'Heure normale de départ (présences)'],
    ['presence_tolerance_minutes', '15', 'Tolérance avant de compter un retard (minutes)'],
  ]) {
    await knex('parametres').insert({ cle, valeur, libelle }).onConflict('cle').ignore();
  }

  // Droits : le Secrétariat gère (accordé par la structure dans context.js) ; les Chefs consultent.
  const p = await knex('permissions').where({ code: 'presences.preparer_direction' }).first();
  if (p) await knex('permissions').where({ id: p.id }).update({ libelle: 'Gérer les présences de la Direction (listes journalières, rapport hebdomadaire, rectificatifs)' });
  await knex('permissions').where({ code: 'presences.verrouiller' }).update({ libelle: 'Verrouiller ou rejeter le rapport hebdomadaire de présence, valider les rectificatifs' });
  const retirer = await knex('permissions').whereIn('code', ['presences.saisir', 'presences.verifier', 'presences.soumettre']).pluck('id');
  if (retirer.length) await knex('role_permissions').whereIn('permission_id', retirer).del();
};

exports.down = async function down(knex) {
  for (const t of ['presence_rectificatifs', 'presence_lignes', 'presence_listes', 'presence_semaines']) {
    await knex.raw(`DROP TRIGGER IF EXISTS trg_${t}_lock ON ${t}`);
  }
  await knex.schema.dropTableIfExists('presence_rectificatifs');
  await knex.schema.dropTableIfExists('presence_lignes');
  await knex.schema.dropTableIfExists('presence_listes');
  await knex.schema.dropTableIfExists('presence_semaines');
  await knex.schema.dropTableIfExists('jours_feries');
  for (const f of ['trg_fn_presence_lignes_lock', 'trg_fn_presence_listes_lock', 'trg_fn_presence_semaines_lock', 'trg_fn_presence_rectificatifs_lock']) await knex.raw(`DROP FUNCTION IF EXISTS ${f}()`);
  await knex('parametres').whereIn('cle', ['presence_heure_arrivee', 'presence_heure_depart', 'presence_tolerance_minutes']).del();
  const ids = await knex('permissions').whereIn('code', ['presences.saisir', 'presences.verifier', 'presences.soumettre']).select('id', 'code');
  const roles = Object.fromEntries((await knex('roles').whereIn('code', ['CHEF_BUREAU', 'CHEF_DIVISION'])).map((r) => [r.code, r.id]));
  for (const x of ids) {
    if (roles.CHEF_BUREAU) await knex('role_permissions').insert({ role_id: roles.CHEF_BUREAU, permission_id: x.id }).onConflict(['role_id', 'permission_id']).ignore();
    if (roles.CHEF_DIVISION && x.code === 'presences.verifier') await knex('role_permissions').insert({ role_id: roles.CHEF_DIVISION, permission_id: x.id }).onConflict(['role_id', 'permission_id']).ignore();
  }
};

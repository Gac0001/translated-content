'use strict';
/**
 * Lot C (1.40.0) — Grades, actes et cohérence poste-grade-rôle (cahier des charges, §§ 9, 12, 13, 44, 56).
 *  - Référentiel des grades au format du cahier : codes 110 (Secrétaire Général) à 340 (Agent
 *    Auxiliaire de 2e classe) et Huissier (HUI), catégories Commandement, Collaboration, Exécution
 *    et Huissier. Le code interne et le rang (niveau) sont conservés.
 *  - Historique des grades de chaque agent (ajout seul), alimenté par les élévations en grade.
 *  - Acte d’élévation en grade ; effets des actes de nomination, d’affectation et de fin de
 *    fonction appliqués à la date d’effet (effet_applique_at).
 *  - Un seul titulaire actif par poste de commandement (déclencheur).
 */
const GRADES = [
  ['SG', '110', 'SG', 'Commandement'], ['DIR', '120', 'DIR', 'Commandement'], ['CD', '130', 'CD', 'Commandement'], ['CB', '140', 'CB', 'Commandement'],
  ['ATA1', '210', 'ATA 1', 'Collaboration'], ['ATA2', '220', 'ATA 2', 'Collaboration'],
  ['AGA1', '310', 'AGA 1', 'Exécution'], ['AGA2', '320', 'AGA 2', 'Exécution'], ['AA1', '330', 'AA 1', 'Exécution'], ['AA2', '340', 'AA 2', 'Exécution'],
];
const A_CONFIRMER = 'Appellation de la catégorie et abréviation à confirmer par la Direction des Ressources Humaines.';

exports.up = async function up(knex) {
  await knex.schema.alterTable('grades', (t) => {
    t.string('code_officiel', 10);
    t.string('abreviation', 20);
    t.text('observation');
  });
  for (const [code, officiel, abreviation, categorie] of GRADES) {
    await knex('grades').where({ code }).update({ code_officiel: officiel, abreviation, categorie, observation: ['AA1', 'AA2'].includes(code) ? A_CONFIRMER : null });
  }
  const hui = await knex('grades').where({ code: 'HUI' }).first();
  if (!hui) await knex('grades').insert({ code: 'HUI', code_officiel: 'HUI', abreviation: 'HUI', libelle: 'Huissier', categorie: 'Huissier', niveau: 5 });
  const gradeHui = await knex('grades').where({ code: 'HUI' }).first();
  await knex('fonctions').where({ code: 'F-HUI' }).update({ grade_id: gradeHui.id });
  // Grades ajoutés auparavant par l’application : code officiel provisoire égal au code interne.
  await knex('grades').whereNull('code_officiel').update({ code_officiel: knex.raw('left(code, 10)') });
  await knex.raw('ALTER TABLE grades ALTER COLUMN code_officiel SET NOT NULL');
  await knex.raw('CREATE UNIQUE INDEX grades_code_officiel_uniq ON grades (code_officiel)');

  // Historique des grades (ajout seul)
  await knex.schema.createTable('agent_grades', (t) => {
    t.increments('id');
    t.integer('agent_id').notNullable().references('agents.id');
    t.integer('grade_id').notNullable().references('grades.id');
    t.integer('ancien_grade_id').references('grades.id');
    t.date('date_effet').notNullable();
    t.integer('acte_id').references('actes_administratifs.id');
    t.string('motif', 300);
    t.integer('created_by').references('users.id');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index(['agent_id', 'date_effet']);
  });
  await knex.raw(`
    CREATE OR REPLACE FUNCTION trg_fn_agent_grades_ajout_seul() RETURNS trigger AS $$
    BEGIN RAISE EXCEPTION 'APPEND_ONLY: L’historique des grades est en ajout seul.'; END; $$ LANGUAGE plpgsql;
    CREATE TRIGGER trg_agent_grades_ajout_seul BEFORE UPDATE OR DELETE ON agent_grades FOR EACH ROW EXECUTE FUNCTION trg_fn_agent_grades_ajout_seul();`);
  // Situation initiale : le grade actuel de chaque agent
  await knex.raw(`INSERT INTO agent_grades (agent_id, grade_id, date_effet, motif)
    SELECT a.id, a.grade_id, COALESCE(a.date_mise_en_service, a.created_at::date), 'Situation initiale (reprise des données)'
      FROM agents a WHERE a.grade_id IS NOT NULL`);

  // Tout changement de grade s’inscrit à l’historique : à l’enregistrement de l’agent, par un acte
  // (l’acte, la date d’effet et l’auteur sont transmis par des réglages locaux à la transaction),
  // ou par une correction de la fiche.
  await knex.raw(`
    CREATE OR REPLACE FUNCTION trg_fn_agents_grade_historique() RETURNS trigger AS $$
    DECLARE acte int; effet date; auteur int;
    BEGIN
      IF NEW.grade_id IS NULL OR (TG_OP = 'UPDATE' AND NEW.grade_id IS NOT DISTINCT FROM OLD.grade_id) THEN RETURN NEW; END IF;
      acte := NULLIF(current_setting('sigdep.acte_id', true), '')::int;
      effet := NULLIF(current_setting('sigdep.date_effet', true), '')::date;
      auteur := NULLIF(current_setting('sigdep.user_id', true), '')::int;
      INSERT INTO agent_grades (agent_id, grade_id, ancien_grade_id, date_effet, acte_id, motif, created_by)
      VALUES (NEW.id, NEW.grade_id, CASE WHEN TG_OP = 'UPDATE' THEN OLD.grade_id END,
              COALESCE(effet, CASE WHEN TG_OP = 'INSERT' THEN COALESCE(NEW.date_mise_en_service, CURRENT_DATE) ELSE CURRENT_DATE END),
              acte,
              CASE WHEN acte IS NOT NULL THEN 'Élévation en grade' WHEN TG_OP = 'INSERT' THEN 'Grade à l’enregistrement' ELSE 'Correction de la fiche' END,
              auteur);
      RETURN NEW;
    END; $$ LANGUAGE plpgsql;
    CREATE TRIGGER trg_agents_grade_historique AFTER INSERT OR UPDATE OF grade_id ON agents FOR EACH ROW EXECUTE FUNCTION trg_fn_agents_grade_historique();`);

  // Actes : élévation en grade, effets des actes permanents
  await knex.schema.alterTable('actes_administratifs', (t) => {
    t.integer('grade_id').references('grades.id'); // nouveau grade (élévation)
    t.timestamp('effet_applique_at', { useTz: true });
    t.text('effet_detail');
  });
  await knex.raw('ALTER TABLE actes_administratifs DROP CONSTRAINT actes_type_chk');
  await knex.raw(`ALTER TABLE actes_administratifs ADD CONSTRAINT actes_type_chk CHECK (type IN ('NOMINATION','AFFECTATION','INTERIM','DESIGNATION','FIN_FONCTION','ELEVATION_GRADE','AUTRE'))`);
  await knex.raw(`ALTER TABLE actes_administratifs ADD CONSTRAINT actes_permanent_chk CHECK (
    type NOT IN ('NOMINATION','AFFECTATION','FIN_FONCTION','ELEVATION_GRADE') OR statut IN ('BROUILLON')
    OR (agent_id IS NOT NULL AND date_debut IS NOT NULL AND (type = 'ELEVATION_GRADE' OR poste_id IS NOT NULL) AND (type <> 'ELEVATION_GRADE' OR grade_id IS NOT NULL)))`);
  // Intangibilité : le nouveau grade fait partie des éléments figés à la décision.
  await knex.raw(`
    CREATE OR REPLACE FUNCTION trg_fn_actes_controle() RETURNS trigger AS $$
    DECLARE n int;
    BEGIN
      IF TG_OP = 'DELETE' THEN
        IF OLD.statut <> 'BROUILLON' THEN RAISE EXCEPTION 'ACTE_INTANGIBLE : un acte soumis ou décidé ne peut être supprimé'; END IF;
        RETURN OLD;
      END IF;
      IF TG_OP = 'UPDATE' AND OLD.statut NOT IN ('BROUILLON','SOUMIS') THEN
        IF (NEW.type, NEW.reference, NEW.date_acte, NEW.autorite, NEW.objet, NEW.motif, NEW.agent_id, NEW.poste_id,
            NEW.titulaire_agent_id, NEW.permissions, NEW.date_debut, NEW.date_fin, NEW.validation_par, NEW.decide_par, NEW.decide_at, NEW.grade_id)
           IS DISTINCT FROM
           (OLD.type, OLD.reference, OLD.date_acte, OLD.autorite, OLD.objet, OLD.motif, OLD.agent_id, OLD.poste_id,
            OLD.titulaire_agent_id, OLD.permissions, OLD.date_debut, OLD.date_fin, OLD.validation_par, OLD.decide_par, OLD.decide_at, OLD.grade_id) THEN
          RAISE EXCEPTION 'ACTE_INTANGIBLE : un acte décidé ne se modifie pas ; établissez un rectificatif';
        END IF;
        IF OLD.effet_applique_at IS NOT NULL AND NEW.effet_applique_at IS DISTINCT FROM OLD.effet_applique_at THEN
          RAISE EXCEPTION 'ACTE_INTANGIBLE : les effets d’un acte sont appliqués une seule fois';
        END IF;
        IF NOT (OLD.statut = NEW.statut OR (OLD.statut = 'VALIDE' AND NEW.statut IN ('REVOQUE','EXPIRE','REMPLACE'))) THEN
          RAISE EXCEPTION 'ACTE_INTANGIBLE : transition de statut interdite (% vers %)', OLD.statut, NEW.statut;
        END IF;
      END IF;
      IF NEW.type = 'INTERIM' AND NEW.statut = 'VALIDE' THEN
        PERFORM pg_advisory_xact_lock(424242, NEW.poste_id);
        SELECT count(*) INTO n FROM actes_administratifs a
         WHERE a.id <> NEW.id AND a.type = 'INTERIM' AND a.statut = 'VALIDE'
           AND (a.poste_id = NEW.poste_id OR a.agent_id = NEW.agent_id)
           AND daterange(a.date_debut, a.date_fin, '[]') && daterange(NEW.date_debut, NEW.date_fin, '[]');
        IF n > 0 THEN RAISE EXCEPTION 'INTERIM_CONCURRENT : un autre intérim couvre déjà ce poste ou cet intérimaire sur la période'; END IF;
      END IF;
      RETURN NEW;
    END $$ LANGUAGE plpgsql`);

  // Un seul titulaire actif par poste de commandement
  await knex.raw(`
    CREATE OR REPLACE FUNCTION trg_fn_affectations_titulaire() RETURNS trigger AS $$
    DECLARE r text; n int;
    BEGIN
      IF NEW.est_active AND NEW.poste_id IS NOT NULL THEN
        SELECT role_associe INTO r FROM postes_organiques WHERE id = NEW.poste_id;
        IF r IN ('DIRECTEUR','CHEF_DIVISION','CHEF_BUREAU') THEN
          PERFORM pg_advisory_xact_lock(434343, NEW.poste_id);
          SELECT count(*) INTO n FROM affectations WHERE poste_id = NEW.poste_id AND est_active AND id <> NEW.id;
          IF n > 0 THEN RAISE EXCEPTION 'TITULAIRE_UNIQUE: Ce poste de commandement a déjà un titulaire en fonction.'; END IF;
        END IF;
      END IF;
      RETURN NEW;
    END; $$ LANGUAGE plpgsql;
    CREATE TRIGGER trg_affectations_titulaire BEFORE INSERT OR UPDATE ON affectations FOR EACH ROW EXECUTE FUNCTION trg_fn_affectations_titulaire();`);
};

exports.down = async function down(knex) {
  await knex.raw('DROP TRIGGER IF EXISTS trg_affectations_titulaire ON affectations; DROP FUNCTION IF EXISTS trg_fn_affectations_titulaire()');
  await knex.raw(`
    CREATE OR REPLACE FUNCTION trg_fn_actes_controle() RETURNS trigger AS $$
    DECLARE n int;
    BEGIN
      IF TG_OP = 'DELETE' THEN
        IF OLD.statut <> 'BROUILLON' THEN RAISE EXCEPTION 'ACTE_INTANGIBLE : un acte soumis ou décidé ne peut être supprimé'; END IF;
        RETURN OLD;
      END IF;
      IF TG_OP = 'UPDATE' AND OLD.statut NOT IN ('BROUILLON','SOUMIS') THEN
        IF (NEW.type, NEW.reference, NEW.date_acte, NEW.autorite, NEW.objet, NEW.motif, NEW.agent_id, NEW.poste_id,
            NEW.titulaire_agent_id, NEW.permissions, NEW.date_debut, NEW.date_fin, NEW.validation_par, NEW.decide_par, NEW.decide_at)
           IS DISTINCT FROM
           (OLD.type, OLD.reference, OLD.date_acte, OLD.autorite, OLD.objet, OLD.motif, OLD.agent_id, OLD.poste_id,
            OLD.titulaire_agent_id, OLD.permissions, OLD.date_debut, OLD.date_fin, OLD.validation_par, OLD.decide_par, OLD.decide_at) THEN
          RAISE EXCEPTION 'ACTE_INTANGIBLE : un acte décidé ne se modifie pas ; établissez un rectificatif';
        END IF;
        IF NOT (OLD.statut = NEW.statut OR (OLD.statut = 'VALIDE' AND NEW.statut IN ('REVOQUE','EXPIRE','REMPLACE'))) THEN
          RAISE EXCEPTION 'ACTE_INTANGIBLE : transition de statut interdite (% vers %)', OLD.statut, NEW.statut;
        END IF;
      END IF;
      IF NEW.type = 'INTERIM' AND NEW.statut = 'VALIDE' THEN
        PERFORM pg_advisory_xact_lock(424242, NEW.poste_id);
        SELECT count(*) INTO n FROM actes_administratifs a
         WHERE a.id <> NEW.id AND a.type = 'INTERIM' AND a.statut = 'VALIDE'
           AND (a.poste_id = NEW.poste_id OR a.agent_id = NEW.agent_id)
           AND daterange(a.date_debut, a.date_fin, '[]') && daterange(NEW.date_debut, NEW.date_fin, '[]');
        IF n > 0 THEN RAISE EXCEPTION 'INTERIM_CONCURRENT : un autre intérim couvre déjà ce poste ou cet intérimaire sur la période'; END IF;
      END IF;
      RETURN NEW;
    END $$ LANGUAGE plpgsql`);
  await knex.raw('ALTER TABLE actes_administratifs DROP CONSTRAINT IF EXISTS actes_permanent_chk');
  // Les actes d’élévation deviennent des actes « Autre » (le type n’existait pas avant cette version).
  await knex.raw('ALTER TABLE actes_administratifs DISABLE TRIGGER trg_actes_controle');
  await knex('actes_administratifs').where({ type: 'ELEVATION_GRADE' }).update({ type: 'AUTRE' });
  await knex.raw('ALTER TABLE actes_administratifs ENABLE TRIGGER trg_actes_controle');
  await knex.raw('ALTER TABLE actes_administratifs DROP CONSTRAINT actes_type_chk');
  await knex.raw(`ALTER TABLE actes_administratifs ADD CONSTRAINT actes_type_chk CHECK (type IN ('NOMINATION','AFFECTATION','INTERIM','DESIGNATION','FIN_FONCTION','AUTRE'))`);
  await knex.schema.alterTable('actes_administratifs', (t) => { t.dropColumn('grade_id'); t.dropColumn('effet_applique_at'); t.dropColumn('effet_detail'); });
  await knex.raw('DROP TRIGGER IF EXISTS trg_agents_grade_historique ON agents; DROP FUNCTION IF EXISTS trg_fn_agents_grade_historique()');
  await knex.raw('DROP TRIGGER IF EXISTS trg_agent_grades_ajout_seul ON agent_grades; DROP FUNCTION IF EXISTS trg_fn_agent_grades_ajout_seul()');
  await knex.schema.dropTable('agent_grades');
  const gradeAa1 = await knex('grades').where({ code: 'AA1' }).first();
  if (gradeAa1) await knex('fonctions').where({ code: 'F-HUI' }).update({ grade_id: gradeAa1.id });
  await knex('grades').where({ code: 'HUI' }).whereNotExists(knex('agents').whereRaw('agents.grade_id = grades.id')).del();
  const anciennes = { SG: 'Haut cadre', DIR: 'Haut cadre', CD: 'Haut cadre', CB: 'Cadre de collaboration', ATA1: 'Cadre de collaboration', ATA2: 'Cadre de collaboration' };
  for (const [code] of GRADES) await knex('grades').where({ code }).update({ categorie: anciennes[code] || 'Agent d’exécution' });
  await knex.raw('DROP INDEX IF EXISTS grades_code_officiel_uniq');
  await knex.schema.alterTable('grades', (t) => { t.dropColumn('code_officiel'); t.dropColumn('abreviation'); t.dropColumn('observation'); });
};

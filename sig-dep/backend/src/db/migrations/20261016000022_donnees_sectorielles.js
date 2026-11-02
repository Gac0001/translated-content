'use strict';
/**
 * Lot 10A — Données sectorielles : collecte (cahier des charges, § 26).
 *  - référentiel : zones (provinces) et catégories d’acteurs, modifiables ;
 *  - annuaire des acteurs du secteur numérique (fournisseurs, exploitants…), sans doublon
 *    (RCCM, identification nationale, raison sociale dans une même province) ;
 *  - questionnaires configurables, versionnés : une version publiée est figée en base ;
 *  - campagnes de collecte (questionnaire, période, zones, catégories, acteurs ciblés,
 *    responsable, échéance) : Brouillon → Ouverte → Clôturée → Validée ; campagne validée
 *    intangible, ainsi que ses réponses ;
 *  - réponses saisies par la DEP à partir de la source reçue, contrôlées par le Bureau
 *    Documentation et Information (anomalies de qualité conservées avec la réponse).
 * Rôles (cadre organique) : Bureau Études, Analyses et Prospective (questionnaires, campagnes),
 * Bureau Documentation et Information (annuaire, contrôle), Chef de la Division Études,
 * Documentation et Information et Directeur (validation).
 */
const PERMISSIONS = [
  ['donnees.consulter', 'donnees', 'Consulter les données sectorielles (annuaire, campagnes, résultats)', ['SECRETAIRE_GENERAL', 'DIRECTEUR', 'CHEF_DIVISION', 'CHEF_BUREAU', 'AGENT']],
  ['donnees.annuaire', 'donnees', 'Tenir l’annuaire des acteurs et le référentiel des données sectorielles', ['DIRECTEUR']],
  ['donnees.questionnaires', 'donnees', 'Concevoir les questionnaires et organiser les campagnes de collecte', ['DIRECTEUR']],
  ['donnees.valider', 'donnees', 'Valider les campagnes de collecte', ['DIRECTEUR']],
];

const PROVINCES = [
  'Kinshasa', 'Kongo-Central', 'Kwango', 'Kwilu', 'Maï-Ndombe', 'Kasaï', 'Kasaï-Central', 'Kasaï-Oriental', 'Lomami', 'Sankuru',
  'Maniema', 'Sud-Kivu', 'Nord-Kivu', 'Ituri', 'Haut-Uele', 'Tshopo', 'Bas-Uele', 'Nord-Ubangi', 'Mongala', 'Sud-Ubangi',
  'Équateur', 'Tshuapa', 'Tanganyika', 'Haut-Lomami', 'Lualaba', 'Haut-Katanga',
];
const CATEGORIES = [
  ['OPT', 'Opérateurs de télécommunications'], ['FAI', 'Fournisseurs d’accès à Internet'], ['DC', 'Centres de données et hébergeurs'],
  ['LOG', 'Éditeurs de logiciels et d’applications'], ['ESN', 'Intégrateurs et entreprises de services numériques'],
  ['FIN', 'Services financiers numériques et monnaie électronique'], ['ECO', 'Commerce électronique et plateformes'],
  ['MED', 'Médias et contenus numériques'], ['STA', 'Start-up et incubateurs du numérique'], ['FOR', 'Formation et compétences numériques'],
  ['TEL', 'Cybercafés, télécentres et points d’accès publics'], ['EQP', 'Distribution et maintenance d’équipements numériques'], ['AUT', 'Autres acteurs du numérique'],
];

exports.up = async function up(knex) {
  await knex.schema.createTable('sect_zones', (t) => {
    t.increments('id');
    t.string('libelle', 120).notNullable().unique();
    t.integer('ordre').notNullable().defaultTo(0);
    t.boolean('actif').notNullable().defaultTo(true);
  });
  await knex('sect_zones').insert(PROVINCES.map((libelle, i) => ({ libelle, ordre: i + 1 })));
  await knex.schema.createTable('sect_categories', (t) => {
    t.increments('id');
    t.string('code', 20).notNullable().unique();
    t.string('libelle', 200).notNullable();
    t.integer('ordre').notNullable().defaultTo(0);
    t.boolean('actif').notNullable().defaultTo(true);
  });
  await knex('sect_categories').insert(CATEGORIES.map(([code, libelle], i) => ({ code, libelle, ordre: i + 1 })));

  await knex.schema.createTable('sect_acteurs', (t) => {
    t.increments('id');
    t.string('reference', 40).notNullable().unique();
    t.string('raison_sociale', 300).notNullable();
    t.string('sigle', 60);
    t.integer('categorie_id').notNullable().references('sect_categories.id');
    t.string('forme_juridique', 60);
    t.string('rccm', 60);
    t.string('id_nat', 60);
    t.string('numero_impot', 60);
    t.integer('zone_id').notNullable().references('sect_zones.id');
    t.string('ville', 120);
    t.string('adresse', 300);
    t.string('telephone', 60);
    t.string('email', 200);
    t.string('site_web', 200);
    t.string('responsable', 200);
    t.integer('annee_creation');
    t.integer('effectif');
    t.string('statut', 20).notNullable().defaultTo('ACTIF'); // ACTIF | SUSPENDU | CESSE
    t.text('observations');
    t.integer('created_by').notNullable().references('users.id');
    t.timestamps(true, true);
  });
  await knex.raw(`ALTER TABLE sect_acteurs ADD CONSTRAINT sect_acteurs_chk CHECK (statut IN ('ACTIF','SUSPENDU','CESSE')
    AND (annee_creation IS NULL OR annee_creation BETWEEN 1900 AND 2100) AND (effectif IS NULL OR effectif >= 0))`);
  await knex.raw('CREATE UNIQUE INDEX sect_acteurs_rccm ON sect_acteurs (upper(rccm)) WHERE rccm IS NOT NULL');
  await knex.raw('CREATE UNIQUE INDEX sect_acteurs_idnat ON sect_acteurs (upper(id_nat)) WHERE id_nat IS NOT NULL');
  await knex.raw('CREATE UNIQUE INDEX sect_acteurs_nom ON sect_acteurs (lower(raison_sociale), zone_id)');

  await knex.schema.createTable('sect_questionnaires', (t) => {
    t.increments('id');
    t.string('code', 30).notNullable().unique();
    t.string('titre', 300).notNullable();
    t.text('description');
    t.boolean('actif').notNullable().defaultTo(true);
    t.integer('created_by').notNullable().references('users.id');
    t.timestamps(true, true);
  });
  await knex.schema.createTable('sect_questionnaire_versions', (t) => {
    t.increments('id');
    t.integer('questionnaire_id').notNullable().references('sect_questionnaires.id');
    t.integer('version').notNullable();
    t.string('statut', 20).notNullable().defaultTo('BROUILLON'); // BROUILLON | PUBLIEE
    t.jsonb('questions').notNullable().defaultTo('[]');
    t.jsonb('controles').notNullable().defaultTo('[]');
    t.integer('publiee_par').references('users.id');
    t.timestamp('publiee_at');
    t.timestamps(true, true);
    t.unique(['questionnaire_id', 'version']);
  });
  await knex.raw(`ALTER TABLE sect_questionnaire_versions ADD CONSTRAINT sect_qv_chk CHECK (statut IN ('BROUILLON','PUBLIEE'))`);
  await knex.raw(`
    CREATE OR REPLACE FUNCTION sect_version_figee() RETURNS trigger AS $$
    BEGIN
      IF TG_OP = 'DELETE' AND OLD.statut = 'PUBLIEE' THEN RAISE EXCEPTION 'VERSION_FIGEE: version publiée'; END IF;
      IF TG_OP = 'UPDATE' AND OLD.statut = 'PUBLIEE' AND (NEW.questions, NEW.controles, NEW.statut) IS DISTINCT FROM (OLD.questions, OLD.controles, OLD.statut) THEN
        RAISE EXCEPTION 'VERSION_FIGEE: version publiée';
      END IF;
      IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
      RETURN NEW;
    END $$ LANGUAGE plpgsql;
    CREATE TRIGGER trg_sect_version_figee BEFORE UPDATE OR DELETE ON sect_questionnaire_versions FOR EACH ROW EXECUTE FUNCTION sect_version_figee();
  `);

  await knex.schema.createTable('sect_campagnes', (t) => {
    t.increments('id');
    t.string('reference', 40).notNullable().unique();
    t.string('titre', 300).notNullable();
    t.integer('version_id').notNullable().references('sect_questionnaire_versions.id');
    t.string('periode', 40).notNullable(); // ex. « 2025 », « 2026-T1 »
    t.date('periode_debut').notNullable();
    t.date('periode_fin').notNullable();
    t.date('echeance').notNullable();
    t.specificType('zones', 'integer[]').notNullable().defaultTo('{}'); // vide : toutes les zones
    t.specificType('categories', 'integer[]').notNullable().defaultTo('{}'); // vide : toutes les catégories
    t.integer('responsable_id').notNullable().references('users.id');
    t.text('instructions');
    t.string('statut', 20).notNullable().defaultTo('BROUILLON');
    t.text('observations');
    t.integer('created_by').notNullable().references('users.id');
    t.timestamp('ouverte_at');
    t.timestamp('cloturee_at');
    t.integer('validee_par').references('users.id');
    t.timestamp('validee_at');
    t.timestamps(true, true);
  });
  await knex.raw(`ALTER TABLE sect_campagnes ADD CONSTRAINT sect_campagnes_chk CHECK (statut IN ('BROUILLON','OUVERTE','CLOTUREE','VALIDEE') AND periode_fin >= periode_debut)`);
  await knex.schema.createTable('sect_campagne_cibles', (t) => {
    t.integer('campagne_id').notNullable().references('sect_campagnes.id').onDelete('CASCADE');
    t.integer('acteur_id').notNullable().references('sect_acteurs.id');
    t.primary(['campagne_id', 'acteur_id']);
  });
  await knex.schema.createTable('sect_reponses', (t) => {
    t.increments('id');
    t.integer('campagne_id').notNullable().references('sect_campagnes.id');
    t.integer('acteur_id').notNullable().references('sect_acteurs.id');
    t.string('statut', 20).notNullable().defaultTo('BROUILLON'); // BROUILLON | SAISIE | CONTROLEE | A_CORRIGER
    t.jsonb('valeurs').notNullable().defaultTo('{}');
    t.jsonb('anomalies').notNullable().defaultTo('[]');
    t.text('justification'); // explication des alertes maintenues
    t.string('source', 20).notNullable().defaultTo('PAPIER'); // PAPIER | FICHIER | COURRIEL | ENTRETIEN
    t.date('date_reception');
    t.text('observations');
    t.integer('saisi_par').notNullable().references('users.id');
    t.timestamp('saisi_at');
    t.integer('controle_par').references('users.id');
    t.timestamp('controle_at');
    t.timestamps(true, true);
    t.unique(['campagne_id', 'acteur_id']);
  });
  await knex.raw(`ALTER TABLE sect_reponses ADD CONSTRAINT sect_reponses_chk CHECK (statut IN ('BROUILLON','SAISIE','CONTROLEE','A_CORRIGER') AND source IN ('PAPIER','FICHIER','COURRIEL','ENTRETIEN'))`);
  await knex.raw(`
    CREATE OR REPLACE FUNCTION sect_campagne_validee() RETURNS trigger AS $$
    BEGIN
      IF TG_OP = 'DELETE' AND OLD.statut = 'VALIDEE' THEN RAISE EXCEPTION 'CAMPAGNE_VALIDEE: campagne validée'; END IF;
      IF TG_OP = 'UPDATE' AND OLD.statut = 'VALIDEE' THEN RAISE EXCEPTION 'CAMPAGNE_VALIDEE: campagne validée'; END IF;
      IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
      RETURN NEW;
    END $$ LANGUAGE plpgsql;
    CREATE TRIGGER trg_sect_campagne_validee BEFORE UPDATE OR DELETE ON sect_campagnes FOR EACH ROW EXECUTE FUNCTION sect_campagne_validee();
    CREATE OR REPLACE FUNCTION sect_reponse_verrou() RETURNS trigger AS $$
    DECLARE s text; cid int;
    BEGIN
      cid := CASE WHEN TG_OP = 'DELETE' THEN OLD.campagne_id ELSE NEW.campagne_id END;
      SELECT statut INTO s FROM sect_campagnes WHERE id = cid;
      IF s = 'VALIDEE' THEN RAISE EXCEPTION 'CAMPAGNE_VALIDEE: réponses figées'; END IF;
      IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
      RETURN NEW;
    END $$ LANGUAGE plpgsql;
    CREATE TRIGGER trg_sect_reponse_verrou BEFORE INSERT OR UPDATE OR DELETE ON sect_reponses FOR EACH ROW EXECUTE FUNCTION sect_reponse_verrou();
    CREATE TRIGGER trg_sect_cibles_verrou BEFORE INSERT OR UPDATE OR DELETE ON sect_campagne_cibles FOR EACH ROW EXECUTE FUNCTION sect_reponse_verrou();
  `);

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
  await knex.raw('DROP TRIGGER IF EXISTS trg_sect_cibles_verrou ON sect_campagne_cibles');
  await knex.raw('DROP TRIGGER IF EXISTS trg_sect_reponse_verrou ON sect_reponses');
  await knex.raw('DROP TRIGGER IF EXISTS trg_sect_campagne_validee ON sect_campagnes');
  await knex.schema.dropTableIfExists('sect_reponses');
  await knex.schema.dropTableIfExists('sect_campagne_cibles');
  await knex.schema.dropTableIfExists('sect_campagnes');
  await knex.raw('DROP FUNCTION IF EXISTS sect_reponse_verrou()');
  await knex.raw('DROP FUNCTION IF EXISTS sect_campagne_validee()');
  await knex.raw('DROP TRIGGER IF EXISTS trg_sect_version_figee ON sect_questionnaire_versions');
  await knex.schema.dropTableIfExists('sect_questionnaire_versions');
  await knex.raw('DROP FUNCTION IF EXISTS sect_version_figee()');
  await knex.schema.dropTableIfExists('sect_questionnaires');
  await knex.schema.dropTableIfExists('sect_acteurs');
  await knex.schema.dropTableIfExists('sect_categories');
  await knex.schema.dropTableIfExists('sect_zones');
};

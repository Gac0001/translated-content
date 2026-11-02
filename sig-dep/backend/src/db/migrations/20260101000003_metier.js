'use strict';

/**
 * Modules métier : présences, courriers, instructions, tâches, documents de service,
 * projets PIP, pièces jointes, notifications, historiques et journal d’audit.
 */
exports.up = async function up(knex) {
  // Numérotation séquentielle (références administratives)
  await knex.schema.createTable('sequences', (t) => {
    t.string('cle', 60).notNullable();
    t.integer('annee').notNullable();
    t.integer('valeur').notNullable().defaultTo(0);
    t.primary(['cle', 'annee']);
  });

  // Historique générique des workflows (horodaté, jamais supprimé)
  await knex.schema.createTable('historiques', (t) => {
    t.bigIncrements('id');
    t.string('entity_type', 30).notNullable();
    t.integer('entity_id').notNullable();
    t.integer('user_id').references('users.id');
    t.string('action', 60).notNullable();
    t.string('ancien_statut', 30);
    t.string('nouveau_statut', 30);
    t.integer('avancement');
    t.text('commentaire');
    t.jsonb('details');
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.index(['entity_type', 'entity_id']);
  });

  // ─── Présences hebdomadaires ───────────────────────────────────────────────
  await knex.schema.createTable('presence_sheets', (t) => {
    t.increments('id');
    t.string('reference', 60).notNullable().unique();
    t.string('structure_type', 20).notNullable(); // BUREAU | DIRECTION
    t.integer('direction_id').notNullable().references('directions.id');
    t.integer('division_id').references('divisions.id');
    t.integer('bureau_id').references('bureaux.id');
    t.date('semaine_debut').notNullable();
    t.date('semaine_fin').notNullable();
    t.integer('annee').notNullable();
    t.integer('numero_semaine').notNullable();
    t.string('statut', 20).notNullable().defaultTo('BROUILLON');
    t.boolean('est_rectificatif').notNullable().defaultTo(false);
    t.integer('rectifie_sheet_id').references('presence_sheets.id');
    t.text('motif_rectification');
    t.text('observations');
    t.integer('created_by').references('users.id');
    t.integer('verified_by').references('users.id');
    t.timestamp('verified_at');
    t.integer('submitted_by').references('users.id');
    t.timestamp('submitted_at');
    t.integer('locked_by').references('users.id');
    t.timestamp('locked_at');
    t.timestamps(true, true);
    t.index(['bureau_id']);
    t.index(['division_id']);
  });
  await knex.raw(`ALTER TABLE presence_sheets ADD CONSTRAINT presence_statut_chk CHECK (statut IN ('BROUILLON','VERIFIEE','SOUMISE','VERROUILLEE'))`);
  await knex.raw(`ALTER TABLE presence_sheets ADD CONSTRAINT presence_rectif_chk CHECK (est_rectificatif = (rectifie_sheet_id IS NOT NULL))`);
  await knex.raw(`CREATE UNIQUE INDEX presence_unique_originale ON presence_sheets(structure_type, COALESCE(bureau_id, 0), semaine_debut) WHERE NOT est_rectificatif`);

  await knex.schema.createTable('presence_entries', (t) => {
    t.increments('id');
    t.integer('sheet_id').notNullable().references('presence_sheets.id').onDelete('RESTRICT');
    t.integer('agent_id').notNullable().references('agents.id');
    for (const j of ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi']) t.string(j, 12).notNullable().defaultTo('PRESENT');
    t.text('observation');
    t.timestamps(true, true);
    t.unique(['sheet_id', 'agent_id']);
  });
  await knex.raw(`ALTER TABLE presence_entries ADD CONSTRAINT presence_entries_valeurs_chk CHECK (
    lundi IN ('PRESENT','ABSENT','RETARD','CONGE','MISSION','MALADIE') AND
    mardi IN ('PRESENT','ABSENT','RETARD','CONGE','MISSION','MALADIE') AND
    mercredi IN ('PRESENT','ABSENT','RETARD','CONGE','MISSION','MALADIE') AND
    jeudi IN ('PRESENT','ABSENT','RETARD','CONGE','MISSION','MALADIE') AND
    vendredi IN ('PRESENT','ABSENT','RETARD','CONGE','MISSION','MALADIE'))`);
  // Une liste soumise ou verrouillée n’est plus modifiable (garde-fou base de données)
  await knex.raw(`
    CREATE OR REPLACE FUNCTION trg_fn_presence_entries_lock() RETURNS trigger AS $$
    DECLARE s text;
    BEGIN
      SELECT statut INTO s FROM presence_sheets WHERE id = COALESCE(NEW.sheet_id, OLD.sheet_id);
      IF s IN ('SOUMISE','VERROUILLEE') THEN
        RAISE EXCEPTION 'PRESENCE_LOCKED: Liste de présence soumise ou verrouillée : toute correction doit passer par un rectificatif.';
      END IF;
      IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
      RETURN NEW;
    END; $$ LANGUAGE plpgsql;
    CREATE TRIGGER trg_presence_entries_lock BEFORE INSERT OR UPDATE OR DELETE ON presence_entries
      FOR EACH ROW EXECUTE FUNCTION trg_fn_presence_entries_lock();

    CREATE OR REPLACE FUNCTION trg_fn_presence_sheets_lock() RETURNS trigger AS $$
    BEGIN
      IF TG_OP = 'DELETE' THEN
        IF OLD.statut <> 'BROUILLON' THEN RAISE EXCEPTION 'PRESENCE_LOCKED: Seul un brouillon peut être supprimé.'; END IF;
        RETURN OLD;
      END IF;
      IF OLD.statut = 'VERROUILLEE' THEN
        RAISE EXCEPTION 'PRESENCE_LOCKED: Liste verrouillée : aucune modification possible.';
      END IF;
      IF OLD.statut = 'SOUMISE' AND NOT (NEW.statut = 'VERROUILLEE') THEN
        RAISE EXCEPTION 'PRESENCE_LOCKED: Liste soumise : seule la transition vers « Verrouillée » est permise.';
      END IF;
      RETURN NEW;
    END; $$ LANGUAGE plpgsql;
    CREATE TRIGGER trg_presence_sheets_lock BEFORE UPDATE OR DELETE ON presence_sheets
      FOR EACH ROW EXECUTE FUNCTION trg_fn_presence_sheets_lock();
  `);

  // ─── Courriers ─────────────────────────────────────────────────────────────
  await knex.schema.createTable('courriers', (t) => {
    t.increments('id');
    t.string('numero_enregistrement', 60).notNullable().unique();
    t.string('sens', 10).notNullable(); // ENTRANT | SORTANT
    t.string('reference_externe', 120);
    t.string('expediteur', 250).notNullable();
    t.string('destinataire', 250).notNullable();
    t.string('objet', 500).notNullable();
    t.date('date_courrier').notNullable();
    t.date('date_enregistrement').notNullable().defaultTo(knex.fn.now());
    t.string('urgence', 20).notNullable().defaultTo('NORMAL'); // NORMAL | URGENT | TRES_URGENT
    t.string('confidentialite', 20).notNullable().defaultTo('ORDINAIRE'); // ORDINAIRE | CONFIDENTIEL | SECRET
    t.text('resume');
    t.string('statut', 20).notNullable().defaultTo('ENREGISTRE'); // ENREGISTRE | EN_CIRCULATION | TRAITE | CLASSE | ARCHIVE
    t.string('classement', 120);
    t.integer('direction_id').notNullable().references('directions.id');
    t.integer('division_id').references('divisions.id');
    t.integer('bureau_id').references('bureaux.id');
    t.integer('detenteur_user_id').references('users.id');
    t.integer('created_by').references('users.id');
    t.timestamp('archived_at');
    t.timestamps(true, true);
    t.index(['sens', 'statut']);
  });
  await knex.raw(`ALTER TABLE courriers ADD CONSTRAINT courriers_chk CHECK (
    sens IN ('ENTRANT','SORTANT') AND urgence IN ('NORMAL','URGENT','TRES_URGENT')
    AND confidentialite IN ('ORDINAIRE','CONFIDENTIEL','SECRET')
    AND statut IN ('ENREGISTRE','EN_CIRCULATION','TRAITE','CLASSE','ARCHIVE'))`);

  await knex.schema.createTable('courrier_transmissions', (t) => {
    t.increments('id');
    t.integer('courrier_id').notNullable().references('courriers.id').onDelete('RESTRICT');
    t.integer('from_user_id').notNullable().references('users.id');
    t.integer('to_user_id').notNullable().references('users.id');
    t.string('sens_hierarchique', 20).notNullable(); // DESCENDANT | ASCENDANT
    t.integer('to_division_id').references('divisions.id');
    t.integer('to_bureau_id').references('bureaux.id');
    t.text('observations');
    t.string('etat_reception', 20).notNullable().defaultTo('EN_ATTENTE'); // EN_ATTENTE | RECU
    t.timestamp('recu_at');
    t.text('observation_reception');
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.index(['courrier_id']);
    t.index(['to_user_id']);
  });

  await knex.schema.createTable('courrier_annotations', (t) => {
    t.increments('id');
    t.integer('courrier_id').notNullable().references('courriers.id').onDelete('RESTRICT');
    t.integer('user_id').notNullable().references('users.id');
    t.text('texte').notNullable();
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
  });

  // ─── Instructions et tâches ────────────────────────────────────────────────
  await knex.schema.createTable('instructions', (t) => {
    t.increments('id');
    t.string('reference', 60).notNullable().unique();
    t.integer('parent_id').references('instructions.id');
    t.integer('emetteur_user_id').notNullable().references('users.id');
    t.integer('destinataire_user_id').notNullable().references('users.id');
    t.string('emetteur_role', 30).notNullable();
    t.string('destinataire_role', 30).notNullable();
    t.string('objet', 500).notNullable();
    t.text('contenu').notNullable();
    t.string('priorite', 20).notNullable().defaultTo('NORMALE');
    t.timestamp('date_emission');
    t.date('echeance');
    t.string('statut', 20).notNullable().defaultTo('BROUILLON');
    t.integer('avancement').notNullable().defaultTo(0);
    t.text('observations');
    t.text('reponse');
    t.timestamp('date_reponse');
    t.timestamp('date_cloture');
    t.integer('direction_id').notNullable().references('directions.id');
    t.integer('division_id').references('divisions.id');
    t.integer('bureau_id').references('bureaux.id');
    t.integer('courrier_id').references('courriers.id');
    t.boolean('rappel_envoye').notNullable().defaultTo(false);
    t.timestamps(true, true);
    t.index(['emetteur_user_id']);
    t.index(['destinataire_user_id']);
    t.index(['statut']);
  });
  await knex.raw(`ALTER TABLE instructions ADD CONSTRAINT instructions_chk CHECK (
    statut IN ('BROUILLON','TRANSMISE','RECUE','EN_COURS','A_CORRIGER','EXECUTEE','VALIDEE','CLOTUREE','EN_RETARD')
    AND priorite IN ('BASSE','NORMALE','HAUTE','URGENTE') AND avancement BETWEEN 0 AND 100
    AND emetteur_user_id <> destinataire_user_id)`);

  await knex.schema.createTable('tasks', (t) => {
    t.increments('id');
    t.string('reference', 60).notNullable().unique();
    t.integer('instruction_id').references('instructions.id');
    t.integer('assigne_par_user_id').notNullable().references('users.id');
    t.integer('agent_user_id').notNullable().references('users.id');
    t.string('titre', 300).notNullable();
    t.text('description');
    t.string('priorite', 20).notNullable().defaultTo('NORMALE');
    t.date('date_debut');
    t.date('echeance');
    t.string('statut', 20).notNullable().defaultTo('TRANSMISE');
    t.integer('avancement').notNullable().defaultTo(0);
    t.text('rapport_execution');
    t.text('observations');
    t.timestamp('date_cloture');
    t.integer('direction_id').notNullable().references('directions.id');
    t.integer('division_id').references('divisions.id');
    t.integer('bureau_id').notNullable().references('bureaux.id');
    t.boolean('rappel_envoye').notNullable().defaultTo(false);
    t.timestamps(true, true);
    t.index(['agent_user_id']);
    t.index(['bureau_id']);
  });
  await knex.raw(`ALTER TABLE tasks ADD CONSTRAINT tasks_chk CHECK (
    statut IN ('BROUILLON','TRANSMISE','RECUE','EN_COURS','A_CORRIGER','EXECUTEE','VALIDEE','CLOTUREE','EN_RETARD')
    AND priorite IN ('BASSE','NORMALE','HAUTE','URGENTE') AND avancement BETWEEN 0 AND 100)`);

  // ─── Documents de service ──────────────────────────────────────────────────
  await knex.schema.createTable('documents', (t) => {
    t.increments('id');
    t.string('reference', 60).notNullable().unique();
    t.string('type_document', 40).notNullable();
    t.string('titre', 300).notNullable();
    t.jsonb('contenu').notNullable().defaultTo('{}');
    t.integer('version_courante').notNullable().defaultTo(1);
    t.string('statut', 20).notNullable().defaultTo('BROUILLON');
    t.string('niveau_actuel', 20).notNullable().defaultTo('AUTEUR'); // AUTEUR | BUREAU | DIVISION | DIRECTION
    t.integer('auteur_user_id').notNullable().references('users.id');
    t.integer('detenteur_user_id').references('users.id');
    t.string('confidentialite', 20).notNullable().defaultTo('ORDINAIRE');
    t.integer('direction_id').notNullable().references('directions.id');
    t.integer('division_id').references('divisions.id');
    t.integer('bureau_id').references('bureaux.id');
    t.integer('instruction_id').references('instructions.id');
    t.integer('task_id').references('tasks.id');
    t.jsonb('visas').notNullable().defaultTo('[]');
    t.integer('valide_par').references('users.id');
    t.timestamp('valide_at');
    t.timestamp('archived_at');
    t.timestamps(true, true);
    t.index(['auteur_user_id']);
    t.index(['detenteur_user_id']);
    t.index(['statut']);
  });
  await knex.raw(`ALTER TABLE documents ADD CONSTRAINT documents_chk CHECK (
    statut IN ('BROUILLON','EN_EXAMEN','A_CORRIGER','VALIDE_DIVISION','VALIDE','REJETE','ARCHIVE')
    AND confidentialite IN ('ORDINAIRE','CONFIDENTIEL','SECRET'))`);

  await knex.schema.createTable('document_versions', (t) => {
    t.increments('id');
    t.integer('document_id').notNullable().references('documents.id').onDelete('RESTRICT');
    t.integer('numero').notNullable();
    t.string('titre', 300).notNullable();
    t.jsonb('contenu').notNullable();
    t.string('commentaire', 500);
    t.integer('created_by').references('users.id');
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.unique(['document_id', 'numero']);
  });

  await knex.schema.createTable('document_comments', (t) => {
    t.increments('id');
    t.integer('document_id').notNullable().references('documents.id').onDelete('RESTRICT');
    t.integer('version_numero');
    t.integer('user_id').notNullable().references('users.id');
    t.string('type', 20).notNullable().defaultTo('COMMENTAIRE'); // COMMENTAIRE | CORRECTION
    t.text('texte').notNullable();
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
  });

  // ─── Projets PIP ───────────────────────────────────────────────────────────
  await knex.schema.createTable('pip_projects', (t) => {
    t.increments('id');
    t.string('code', 60).notNullable().unique();
    t.string('intitule', 400).notNullable();
    t.string('secteur', 150);
    t.string('statut', 20).notNullable().defaultTo('BROUILLON');
    t.jsonb('donnees').notNullable().defaultTo('{}');
    t.decimal('cout_total', 18, 2).notNullable().defaultTo(0);
    t.string('devise', 10).notNullable().defaultTo('USD');
    t.integer('duree_mois');
    t.date('date_debut');
    t.integer('version').notNullable().defaultTo(1);
    t.integer('auteur_user_id').notNullable().references('users.id');
    t.integer('detenteur_user_id').references('users.id');
    t.integer('verifie_par').references('users.id');
    t.timestamp('verifie_at');
    t.integer('valide_par').references('users.id');
    t.timestamp('valide_at');
    t.integer('direction_id').notNullable().references('directions.id');
    t.integer('division_id').references('divisions.id');
    t.integer('bureau_id').references('bureaux.id');
    t.timestamp('archived_at');
    t.timestamps(true, true);
  });
  await knex.raw(`ALTER TABLE pip_projects ADD CONSTRAINT pip_chk CHECK (
    statut IN ('BROUILLON','EN_VERIFICATION','A_CORRIGER','VERIFIE','VALIDE','ARCHIVE'))`);

  await knex.schema.createTable('pip_versions', (t) => {
    t.increments('id');
    t.integer('pip_id').notNullable().references('pip_projects.id').onDelete('RESTRICT');
    t.integer('numero').notNullable();
    t.jsonb('donnees').notNullable();
    t.integer('created_by').references('users.id');
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.unique(['pip_id', 'numero']);
  });

  // ─── Pièces jointes ────────────────────────────────────────────────────────
  await knex.schema.createTable('attachments', (t) => {
    t.increments('id');
    t.string('entity_type', 30).notNullable(); // COURRIER | INSTRUCTION | TASK | DOCUMENT | PIP
    t.integer('entity_id').notNullable();
    t.string('original_name', 255).notNullable();
    t.string('stored_name', 80).notNullable().unique();
    t.string('mime_type', 120).notNullable();
    t.integer('size_bytes').notNullable();
    t.string('sha256', 64).notNullable();
    t.integer('uploaded_by').references('users.id');
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('deleted_at');
    t.integer('deleted_by').references('users.id');
    t.index(['entity_type', 'entity_id']);
  });

  // ─── Notifications ─────────────────────────────────────────────────────────
  await knex.schema.createTable('notifications', (t) => {
    t.bigIncrements('id');
    t.integer('user_id').notNullable().references('users.id').onDelete('CASCADE');
    t.string('type', 40).notNullable();
    t.string('titre', 250).notNullable();
    t.text('message');
    t.string('lien', 250);
    t.integer('expediteur_user_id').references('users.id');
    t.boolean('lu').notNullable().defaultTo(false);
    t.timestamp('lu_at');
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.index(['user_id', 'lu']);
  });

  // ─── Journal d’audit (lecture seule) ───────────────────────────────────────
  await knex.schema.createTable('audit_logs', (t) => {
    t.bigIncrements('id');
    t.integer('user_id');
    t.string('username', 60);
    t.string('role', 60);
    t.string('ip', 64);
    t.string('action', 40).notNullable();
    t.string('module', 40).notNullable();
    t.string('entite', 40);
    t.string('entite_id', 40);
    t.jsonb('ancienne_valeur');
    t.jsonb('nouvelle_valeur');
    t.string('resultat', 10).notNullable(); // SUCCES | ECHEC
    t.text('message');
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.index(['created_at']);
    t.index(['module', 'action']);
    t.index(['user_id']);
  });

  // Tables en ajout seul : ni modification ni suppression
  await knex.raw(`
    CREATE OR REPLACE FUNCTION trg_fn_append_only() RETURNS trigger AS $$
    BEGIN
      RAISE EXCEPTION 'APPEND_ONLY: La table % est en lecture seule (ajout uniquement).', TG_TABLE_NAME;
    END; $$ LANGUAGE plpgsql;
    CREATE TRIGGER trg_audit_append_only BEFORE UPDATE OR DELETE ON audit_logs
      FOR EACH ROW EXECUTE FUNCTION trg_fn_append_only();
    CREATE TRIGGER trg_doc_versions_append_only BEFORE UPDATE OR DELETE ON document_versions
      FOR EACH ROW EXECUTE FUNCTION trg_fn_append_only();
    CREATE TRIGGER trg_pip_versions_append_only BEFORE UPDATE OR DELETE ON pip_versions
      FOR EACH ROW EXECUTE FUNCTION trg_fn_append_only();
    CREATE TRIGGER trg_historiques_append_only BEFORE UPDATE OR DELETE ON historiques
      FOR EACH ROW EXECUTE FUNCTION trg_fn_append_only();
    CREATE TRIGGER trg_transmissions_no_delete BEFORE DELETE ON courrier_transmissions
      FOR EACH ROW EXECUTE FUNCTION trg_fn_append_only();
  `);
};

exports.down = async function down(knex) {
  await knex.raw(`
    DROP TRIGGER IF EXISTS trg_transmissions_no_delete ON courrier_transmissions;
    DROP TRIGGER IF EXISTS trg_historiques_append_only ON historiques;
    DROP TRIGGER IF EXISTS trg_pip_versions_append_only ON pip_versions;
    DROP TRIGGER IF EXISTS trg_doc_versions_append_only ON document_versions;
    DROP TRIGGER IF EXISTS trg_audit_append_only ON audit_logs;
    DROP TRIGGER IF EXISTS trg_presence_sheets_lock ON presence_sheets;
    DROP TRIGGER IF EXISTS trg_presence_entries_lock ON presence_entries;
    DROP FUNCTION IF EXISTS trg_fn_append_only();
    DROP FUNCTION IF EXISTS trg_fn_presence_sheets_lock();
    DROP FUNCTION IF EXISTS trg_fn_presence_entries_lock();
  `);
  for (const t of ['audit_logs', 'notifications', 'attachments', 'pip_versions', 'pip_projects', 'document_comments',
    'document_versions', 'documents', 'tasks', 'instructions', 'courrier_annotations', 'courrier_transmissions',
    'courriers', 'presence_entries', 'presence_sheets', 'historiques', 'sequences']) {
    await knex.schema.dropTableIfExists(t);
  }
};

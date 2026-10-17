'use strict';
/**
 * 1.6 — Sécurité du compte Admin Système (lot 1) :
 *  - double authentification (TOTP) et codes de secours ;
 *  - e-mail de récupération, codes à usage unique (connexion 2FA, récupération) ;
 *  - acceptation des règles de sécurité ;
 *  - historique des mots de passe ;
 *  - alertes de sécurité ;
 *  - journal d’audit chaîné (SHA-256) et protégé contre TRUNCATE ;
 *  - historique de connexion en ajout seul (plus de clé étrangère : il survit aux comptes) ;
 *  - autorisation nominative, par le Directeur, de l’enrôlement d’un agent du Secrétariat par l’Admin ;
 *  - paramètres de la politique des mots de passe et des sessions.
 */
const PARAMETRES = [
  ['mdp_longueur_min', '10', 'Mots de passe : longueur minimale'],
  ['mdp_exiger_majuscule', 'true', 'Mots de passe : au moins une majuscule'],
  ['mdp_exiger_minuscule', 'true', 'Mots de passe : au moins une minuscule'],
  ['mdp_exiger_chiffre', 'true', 'Mots de passe : au moins un chiffre'],
  ['mdp_exiger_special', 'true', 'Mots de passe : au moins un caractère spécial'],
  ['mdp_historique', '5', 'Mots de passe : nombre d’anciens mots de passe interdits'],
  ['mdp_expiration_jours', '0', 'Mots de passe : expiration en jours (0 = jamais)'],
  ['verrouillage_tentatives', '5', 'Verrouillage : échecs de connexion avant blocage'],
  ['verrouillage_minutes', '15', 'Verrouillage : durée du blocage automatique (minutes)'],
  ['session_duree_jours', '7', 'Sessions : durée maximale d’une session (jours)'],
  ['session_inactivite_minutes', '30', 'Sessions : déconnexion après inactivité (minutes)'],
  ['inactivite_compte_jours', '90', 'Comptes inactifs : seuil de détection (jours sans connexion)'],
  ['inactivite_desactivation_auto', 'false', 'Comptes inactifs : désactivation automatique'],
  ['alerte_echecs_seuil', '10', 'Alertes : échecs de connexion en 15 minutes déclenchant une alerte'],
  ['regles_securite_version', '1', 'Règles de sécurité : version en vigueur'],
];

exports.up = async function up(knex) {
  // ─── Comptes ───────────────────────────────────────────────────────────────
  await knex.schema.alterTable('users', (t) => {
    t.text('totp_secret'); // chiffré (AES-256-GCM)
    t.boolean('totp_actif').notNullable().defaultTo(false);
    t.timestamp('totp_active_at');
    t.string('email_recuperation', 150);
    t.timestamp('email_recuperation_verifie_at');
    t.integer('regles_acceptees_version');
    t.timestamp('regles_acceptees_at');
    t.string('motif_blocage', 300);
  });
  await knex.schema.createTable('codes_secours', (t) => {
    t.increments('id');
    t.integer('user_id').notNullable().references('users.id').onDelete('CASCADE');
    t.string('code_hash', 64).notNullable();
    t.timestamp('utilise_at');
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.index(['user_id']);
  });
  await knex.schema.createTable('defis_auth', (t) => {
    t.uuid('id').primary();
    t.integer('user_id').notNullable().references('users.id').onDelete('CASCADE');
    t.string('type', 30).notNullable(); // CONNEXION_2FA | RECUPERATION | VERIF_EMAIL
    t.string('code_hash', 64);
    t.integer('tentatives').notNullable().defaultTo(0);
    t.timestamp('expires_at').notNullable();
    t.timestamp('utilise_at');
    t.string('ip', 64);
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.index(['user_id', 'type']);
  });
  await knex.schema.createTable('historique_mots_de_passe', (t) => {
    t.increments('id');
    t.integer('user_id').notNullable().references('users.id').onDelete('CASCADE');
    t.string('password_hash', 100).notNullable();
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.index(['user_id']);
  });
  await knex.raw(`INSERT INTO historique_mots_de_passe (user_id, password_hash, created_at)
    SELECT id, password_hash, coalesce(password_changed_at, created_at) FROM users`);

  // ─── Alertes de sécurité ──────────────────────────────────────────────────
  await knex.schema.createTable('alertes_securite', (t) => {
    t.increments('id');
    t.string('type', 40).notNullable();
    t.string('gravite', 10).notNullable(); // INFO | ATTENTION | CRITIQUE
    t.string('titre', 200).notNullable();
    t.text('message');
    t.jsonb('details');
    t.integer('user_id');
    t.string('username', 60);
    t.string('ip', 64);
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('acquittee_at');
    t.integer('acquittee_par');
    t.index(['created_at']);
  });

  // ─── Historique de connexion : indépendant des comptes, en ajout seul ─────
  await knex.raw('ALTER TABLE login_history DROP CONSTRAINT IF EXISTS login_history_user_id_foreign');
  await knex.raw(`
    CREATE OR REPLACE FUNCTION trg_fn_no_truncate() RETURNS trigger AS $$
    BEGIN
      RAISE EXCEPTION 'APPEND_ONLY: La table % ne peut pas être vidée.', TG_TABLE_NAME;
    END; $$ LANGUAGE plpgsql;
    CREATE TRIGGER trg_login_history_append_only BEFORE UPDATE OR DELETE ON login_history
      FOR EACH ROW EXECUTE FUNCTION trg_fn_append_only();
    CREATE TRIGGER trg_login_history_no_truncate BEFORE TRUNCATE ON login_history
      FOR EACH STATEMENT EXECUTE FUNCTION trg_fn_no_truncate();
    CREATE TRIGGER trg_audit_no_truncate BEFORE TRUNCATE ON audit_logs
      FOR EACH STATEMENT EXECUTE FUNCTION trg_fn_no_truncate();
  `);

  // ─── Journal d’audit chaîné ───────────────────────────────────────────────
  // Chaque entrée porte l’empreinte de la précédente : toute modification, suppression
  // ou insertion frauduleuse, même directement en base, rompt la chaîne.
  await knex.schema.alterTable('audit_logs', (t) => {
    t.bigInteger('maillon');
    t.string('empreinte_precedente', 64);
    t.string('empreinte', 64);
  });
  await knex.raw(`
    CREATE OR REPLACE FUNCTION audit_empreinte(a audit_logs) RETURNS text AS $$
      SELECT encode(sha256(convert_to(concat_ws('|',
        a.maillon::text, a.empreinte_precedente, coalesce(a.user_id::text, ''), coalesce(a.username, ''), coalesce(a.role, ''),
        coalesce(a.ip, ''), a.action, a.module, coalesce(a.entite, ''), coalesce(a.entite_id, ''),
        coalesce(a.ancienne_valeur::text, ''), coalesce(a.nouvelle_valeur::text, ''), a.resultat, coalesce(a.message, ''),
        to_char(a.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US')), 'UTF8')), 'hex');
    $$ LANGUAGE sql STABLE;

    CREATE OR REPLACE FUNCTION trg_fn_audit_chaine() RETURNS trigger AS $$
    DECLARE dernier RECORD;
    BEGIN
      PERFORM pg_advisory_xact_lock(424242);
      SELECT maillon, empreinte INTO dernier FROM audit_logs WHERE maillon IS NOT NULL ORDER BY maillon DESC LIMIT 1;
      NEW.created_at := coalesce(NEW.created_at, now());
      NEW.maillon := coalesce(dernier.maillon, 0) + 1;
      NEW.empreinte_precedente := coalesce(dernier.empreinte, repeat('0', 64));
      NEW.empreinte := audit_empreinte(NEW);
      RETURN NEW;
    END; $$ LANGUAGE plpgsql;
  `);
  // Chaînage des entrées existantes (dans l’ordre chronologique)
  await knex.raw('ALTER TABLE audit_logs DISABLE TRIGGER trg_audit_append_only');
  await knex.raw(`
    DO $$
    DECLARE r audit_logs; n bigint := 0; prev text := repeat('0', 64);
    BEGIN
      FOR r IN SELECT * FROM audit_logs ORDER BY id LOOP
        n := n + 1;
        r.maillon := n; r.empreinte_precedente := prev; r.empreinte := audit_empreinte(r);
        UPDATE audit_logs SET maillon = r.maillon, empreinte_precedente = r.empreinte_precedente, empreinte = r.empreinte WHERE id = r.id;
        prev := r.empreinte;
      END LOOP;
    END $$;
  `);
  await knex.raw('ALTER TABLE audit_logs ENABLE TRIGGER trg_audit_append_only');
  await knex.raw(`
    CREATE TRIGGER trg_audit_chaine BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION trg_fn_audit_chaine();
    CREATE UNIQUE INDEX audit_logs_maillon_uniq ON audit_logs (maillon);
  `);

  // ─── Enrôlement du Secrétariat par l’Admin : autorisation du Directeur ───
  await knex.schema.alterTable('agents', (t) => {
    t.timestamp('enrolement_autorise_at');
    t.integer('enrolement_autorise_par').references('users.id');
  });

  // ─── Rôles institutionnels : ni suppression, ni changement de code ou de libellé ─
  await knex.raw(`
    CREATE OR REPLACE FUNCTION trg_fn_roles_proteges() RETURNS trigger AS $$
    BEGIN
      IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'ROLE_PROTEGE: Le rôle institutionnel % ne peut pas être supprimé.', OLD.code;
      END IF;
      IF NEW.code IS DISTINCT FROM OLD.code OR NEW.libelle IS DISTINCT FROM OLD.libelle THEN
        RAISE EXCEPTION 'ROLE_PROTEGE: Le rôle institutionnel % ne peut pas être renommé.', OLD.code;
      END IF;
      RETURN NEW;
    END; $$ LANGUAGE plpgsql;
    CREATE TRIGGER trg_roles_proteges BEFORE UPDATE OR DELETE ON roles FOR EACH ROW EXECUTE FUNCTION trg_fn_roles_proteges();
  `);

  for (const [cle, valeur, libelle] of PARAMETRES) {
    await knex('parametres').insert({ cle, valeur, libelle }).onConflict('cle').ignore();
  }
};

exports.down = async function down(knex) {
  await knex.raw('DROP TRIGGER IF EXISTS trg_roles_proteges ON roles; DROP FUNCTION IF EXISTS trg_fn_roles_proteges();');
  await knex('parametres').whereIn('cle', PARAMETRES.map((p) => p[0])).del();
  await knex.schema.alterTable('agents', (t) => { t.dropColumn('enrolement_autorise_at'); t.dropColumn('enrolement_autorise_par'); });
  await knex.raw(`
    DROP TRIGGER IF EXISTS trg_audit_chaine ON audit_logs;
    DROP INDEX IF EXISTS audit_logs_maillon_uniq;
    DROP FUNCTION IF EXISTS trg_fn_audit_chaine();
    DROP TRIGGER IF EXISTS trg_audit_no_truncate ON audit_logs;
    DROP TRIGGER IF EXISTS trg_login_history_no_truncate ON login_history;
    DROP TRIGGER IF EXISTS trg_login_history_append_only ON login_history;
  `);
  await knex.raw('ALTER TABLE audit_logs DISABLE TRIGGER trg_audit_append_only');
  await knex.schema.alterTable('audit_logs', (t) => { t.dropColumn('maillon'); t.dropColumn('empreinte_precedente'); t.dropColumn('empreinte'); });
  await knex.raw('ALTER TABLE audit_logs ENABLE TRIGGER trg_audit_append_only');
  await knex.raw('DROP FUNCTION IF EXISTS audit_empreinte(audit_logs); DROP FUNCTION IF EXISTS trg_fn_no_truncate();');
  await knex.schema.dropTableIfExists('alertes_securite');
  await knex.schema.dropTableIfExists('historique_mots_de_passe');
  await knex.schema.dropTableIfExists('defis_auth');
  await knex.schema.dropTableIfExists('codes_secours');
  await knex.schema.alterTable('users', (t) => {
    for (const c of ['totp_secret', 'totp_actif', 'totp_active_at', 'email_recuperation', 'email_recuperation_verifie_at', 'regles_acceptees_version', 'regles_acceptees_at', 'motif_blocage']) t.dropColumn(c);
  });
};

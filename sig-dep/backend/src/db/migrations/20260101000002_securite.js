'use strict';

/**
 * Comptes, rôles, permissions, sessions (refresh tokens), historique des connexions,
 * paramètres du système. Contient les déclencheurs empêchant l’attribution des permissions
 * de Division au Bureau Secrétariat de Direction ou à son Chef.
 */
exports.up = async function up(knex) {
  await knex.schema.createTable('roles', (t) => {
    t.increments('id');
    t.string('code', 40).notNullable().unique();
    t.string('libelle', 100).notNullable();
    t.string('perimetre_defaut', 30).notNullable();
    t.text('description');
    t.boolean('systeme').notNullable().defaultTo(true);
    t.timestamps(true, true);
  });

  await knex.schema.createTable('permissions', (t) => {
    t.increments('id');
    t.string('code', 60).notNullable().unique();
    t.string('module', 40).notNullable();
    t.string('libelle', 200).notNullable();
    t.boolean('delegable').notNullable().defaultTo(false);
    t.boolean('reservee_division').notNullable().defaultTo(false);
  });

  await knex.schema.createTable('role_permissions', (t) => {
    t.integer('role_id').notNullable().references('roles.id').onDelete('CASCADE');
    t.integer('permission_id').notNullable().references('permissions.id').onDelete('CASCADE');
    t.primary(['role_id', 'permission_id']);
  });

  await knex.schema.createTable('users', (t) => {
    t.increments('id');
    t.string('username', 60).notNullable().unique();
    t.string('password_hash', 100).notNullable();
    t.integer('agent_id').unique().references('agents.id').onDelete('RESTRICT');
    t.string('statut', 20).notNullable().defaultTo('ACTIF'); // ACTIF | DESACTIVE | VERROUILLE
    t.boolean('must_change_password').notNullable().defaultTo(true);
    t.integer('failed_attempts').notNullable().defaultTo(0);
    t.timestamp('locked_until');
    t.timestamp('last_login_at');
    t.timestamp('password_changed_at');
    t.integer('token_version').notNullable().defaultTo(0);
    t.integer('created_by').references('users.id');
    t.integer('autorise_par').references('users.id'); // Directeur ayant autorisé la création
    t.timestamp('autorise_at');
    t.timestamps(true, true);
  });
  await knex.raw(`ALTER TABLE users ADD CONSTRAINT users_statut_chk CHECK (statut IN ('ACTIF','DESACTIVE','VERROUILLE'))`);

  await knex.schema.createTable('user_roles', (t) => {
    t.integer('user_id').notNullable().references('users.id').onDelete('CASCADE');
    t.integer('role_id').notNullable().references('roles.id').onDelete('RESTRICT');
    t.integer('granted_by').references('users.id');
    t.timestamp('granted_at').notNullable().defaultTo(knex.fn.now());
    t.primary(['user_id', 'role_id']);
  });

  // Permissions individuelles (délégations du Directeur)
  await knex.schema.createTable('user_permissions', (t) => {
    t.increments('id');
    t.integer('user_id').notNullable().references('users.id').onDelete('CASCADE');
    t.integer('permission_id').notNullable().references('permissions.id').onDelete('RESTRICT');
    t.integer('granted_by').references('users.id');
    t.string('motif', 300);
    t.timestamp('granted_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('revoked_at');
    t.integer('revoked_by').references('users.id');
  });
  await knex.raw(`CREATE UNIQUE INDEX user_permissions_active_uniq ON user_permissions(user_id, permission_id) WHERE revoked_at IS NULL`);

  await knex.schema.createTable('refresh_tokens', (t) => {
    t.increments('id');
    t.integer('user_id').notNullable().references('users.id').onDelete('CASCADE');
    t.string('token_hash', 64).notNullable().unique();
    t.uuid('family_id').notNullable();
    t.timestamp('expires_at').notNullable();
    t.timestamp('revoked_at');
    t.string('revoked_reason', 60);
    t.integer('replaced_by');
    t.string('ip', 64);
    t.string('user_agent', 300);
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('last_used_at');
    t.index(['user_id']);
    t.index(['family_id']);
  });

  await knex.schema.createTable('login_history', (t) => {
    t.increments('id');
    t.integer('user_id').references('users.id').onDelete('SET NULL');
    t.string('username', 60);
    t.string('ip', 64);
    t.string('user_agent', 300);
    t.boolean('succes').notNullable();
    t.string('motif', 200);
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.index(['user_id']);
  });

  await knex.schema.createTable('parametres', (t) => {
    t.string('cle', 80).primary();
    t.text('valeur');
    t.string('libelle', 200);
    t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    t.integer('updated_by');
  });

  // ─── Garde-fous du Bureau Secrétariat de Direction ─────────────────────────
  await knex.raw(`
    CREATE OR REPLACE FUNCTION sigdep_user_in_secretariat(uid int) RETURNS boolean AS $$
      SELECT EXISTS (
        SELECT 1 FROM users u
          JOIN affectations a ON a.agent_id = u.agent_id AND a.est_active
          JOIN bureaux b ON b.id = a.bureau_id
         WHERE u.id = uid AND b.est_secretariat_direction);
    $$ LANGUAGE sql STABLE;

    CREATE OR REPLACE FUNCTION sigdep_user_has_division_perm(uid int) RETURNS boolean AS $$
      SELECT EXISTS (
        SELECT 1 FROM user_roles ur
          JOIN role_permissions rp ON rp.role_id = ur.role_id
          JOIN permissions p ON p.id = rp.permission_id
         WHERE ur.user_id = uid AND p.reservee_division)
      OR EXISTS (
        SELECT 1 FROM user_permissions up JOIN permissions p ON p.id = up.permission_id
         WHERE up.user_id = uid AND up.revoked_at IS NULL AND p.reservee_division);
    $$ LANGUAGE sql STABLE;

    CREATE OR REPLACE FUNCTION sigdep_check_user_secretariat(uid int) RETURNS void AS $$
    BEGIN
      IF sigdep_user_in_secretariat(uid) AND sigdep_user_has_division_perm(uid) THEN
        RAISE EXCEPTION 'SECRETARIAT_DIVISION_PERMISSION: Le Bureau Secrétariat de Direction conserve le rang de Bureau ; aucune permission réservée aux Divisions ne peut être attribuée à ce Bureau ou à son Chef.'
          USING ERRCODE = 'P0001';
      END IF;
    END; $$ LANGUAGE plpgsql;

    CREATE OR REPLACE FUNCTION trg_fn_user_roles_secretariat() RETURNS trigger AS $$
    BEGIN PERFORM sigdep_check_user_secretariat(NEW.user_id); RETURN NEW; END; $$ LANGUAGE plpgsql;
    CREATE CONSTRAINT TRIGGER trg_user_roles_secretariat AFTER INSERT OR UPDATE ON user_roles
      DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION trg_fn_user_roles_secretariat();
    CREATE CONSTRAINT TRIGGER trg_user_permissions_secretariat AFTER INSERT OR UPDATE ON user_permissions
      DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION trg_fn_user_roles_secretariat();

    CREATE OR REPLACE FUNCTION trg_fn_role_permissions_secretariat() RETURNS trigger AS $$
    DECLARE r record;
    BEGIN
      FOR r IN SELECT user_id FROM user_roles WHERE role_id = NEW.role_id LOOP
        PERFORM sigdep_check_user_secretariat(r.user_id);
      END LOOP;
      RETURN NEW;
    END; $$ LANGUAGE plpgsql;
    CREATE CONSTRAINT TRIGGER trg_role_permissions_secretariat AFTER INSERT OR UPDATE ON role_permissions
      DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION trg_fn_role_permissions_secretariat();

    CREATE OR REPLACE FUNCTION trg_fn_affectations_secretariat() RETURNS trigger AS $$
    DECLARE r record;
    BEGIN
      FOR r IN SELECT id FROM users WHERE agent_id = NEW.agent_id LOOP
        PERFORM sigdep_check_user_secretariat(r.id);
      END LOOP;
      RETURN NEW;
    END; $$ LANGUAGE plpgsql;
    CREATE CONSTRAINT TRIGGER trg_affectations_secretariat AFTER INSERT OR UPDATE ON affectations
      DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION trg_fn_affectations_secretariat();
  `);
};

exports.down = async function down(knex) {
  await knex.raw(`
    DROP TRIGGER IF EXISTS trg_affectations_secretariat ON affectations;
    DROP FUNCTION IF EXISTS trg_fn_affectations_secretariat();
    DROP TRIGGER IF EXISTS trg_role_permissions_secretariat ON role_permissions;
    DROP FUNCTION IF EXISTS trg_fn_role_permissions_secretariat();
    DROP TRIGGER IF EXISTS trg_user_permissions_secretariat ON user_permissions;
    DROP TRIGGER IF EXISTS trg_user_roles_secretariat ON user_roles;
    DROP FUNCTION IF EXISTS trg_fn_user_roles_secretariat();
    DROP FUNCTION IF EXISTS sigdep_check_user_secretariat(int);
    DROP FUNCTION IF EXISTS sigdep_user_has_division_perm(int);
    DROP FUNCTION IF EXISTS sigdep_user_in_secretariat(int);
  `);
  for (const t of ['parametres', 'login_history', 'refresh_tokens', 'user_permissions', 'user_roles', 'users', 'role_permissions', 'permissions', 'roles']) {
    await knex.schema.dropTableIfExists(t);
  }
};

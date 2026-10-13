'use strict';
/**
 * Lot C (1.41.0) — Effectifs, groupes de travail, référentiel versionné (cahier des charges,
 * §§ 10, 11, 14, 24).
 *  - Effectif organique par structure et par grade (postes d’emploi du cadre organique) : la
 *    comparaison avec l’effectif réel donne les vacances et sureffectifs de chaque structure.
 *  - Versions du référentiel (grades, postes d’emploi, effectif organique) avec leur source et leur
 *    date d’application ; chaque version est un instantané intangible.
 *  - Groupes de travail rattachés à la Direction : objet, acte de création, dates, membres avec
 *    leur rôle, participants externes sans compte. Ils ne comptent jamais dans l’effectif.
 */
// Cahier, § 10 : postes d’emploi par structure (code de grade interne, ou fonction pour le Huissier).
const ORGANIQUE = [
  ['DIRECTION', 'DIR', 1],
  ['BSD', 'CB', 1], ['BSD', 'ATA1', 1], ['BSD', 'F-HUI', 1],
  ['DIV-EDI', 'CD', 1], ['BUR-EAP', 'CB', 1], ['BUR-EAP', 'ATA1', 1], ['BUR-DOI', 'CB', 1], ['BUR-DOI', 'ATA1', 1],
  ['DIV-SCI', 'CD', 1], ['BUR-STR', 'CB', 1], ['BUR-STR', 'ATA1', 1], ['BUR-COI', 'CB', 1], ['BUR-COI', 'ATA1', 1],
  ['DIV-PS', 'CD', 1], ['BUR-PRG', 'CB', 1], ['BUR-PRG', 'ATA1', 1], ['BUR-PRG', 'ATA2', 1], ['BUR-SEV', 'CB', 1], ['BUR-SEV', 'ATA1', 1],
];
const SOURCE = 'Cadre organique de la Direction d’Études et Planification (cahier des charges fonctionnel v2, §§ 9 et 10)';

exports.ORGANIQUE = ORGANIQUE;

exports.up = async function up(knex) {
  await knex.schema.createTable('effectif_structure', (t) => {
    t.increments('id');
    t.string('structure_code', 30).notNullable(); // DIRECTION, code de Division ou de Bureau
    t.string('critere_type', 10).notNullable(); // GRADE | FONCTION
    t.string('critere_code', 30).notNullable();
    t.integer('nombre').notNullable().defaultTo(1);
    t.string('source', 300);
    t.integer('updated_by'); // sans clé étrangère : table conservée à la réinitialisation
    t.timestamps(true, true);
    t.unique(['structure_code', 'critere_type', 'critere_code']);
  });
  await knex.raw(`ALTER TABLE effectif_structure ADD CONSTRAINT effectif_structure_chk CHECK (critere_type IN ('GRADE','FONCTION') AND nombre >= 0)`);
  await knex('effectif_structure').insert(ORGANIQUE.map(([s, c, n]) => ({ structure_code: s, critere_type: c.startsWith('F-') ? 'FONCTION' : 'GRADE', critere_code: c, nombre: n, source: SOURCE })));

  await knex.schema.createTable('referentiel_versions', (t) => {
    t.increments('id');
    t.integer('numero').notNullable().unique();
    t.string('source', 500).notNullable();
    t.date('date_application').notNullable();
    t.text('observation');
    t.jsonb('contenu').notNullable(); // { grades, postes, effectif_reference, effectif_structure }
    t.integer('created_by'); // sans clé étrangère : table conservée à la réinitialisation
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });
  await knex.raw(`
    CREATE OR REPLACE FUNCTION trg_fn_referentiel_versions_ajout_seul() RETURNS trigger AS $$
    BEGIN RAISE EXCEPTION 'APPEND_ONLY: Une version du référentiel ne se modifie ni ne se supprime.'; END; $$ LANGUAGE plpgsql;
    CREATE TRIGGER trg_referentiel_versions_ajout_seul BEFORE UPDATE OR DELETE ON referentiel_versions FOR EACH ROW EXECUTE FUNCTION trg_fn_referentiel_versions_ajout_seul();`);

  // Version 1 : le référentiel tel que fixé par le cadre organique (installation existante ; sur
  // une installation neuve, elle est consignée à la fin du chargement initial, seed 01).
  if (await knex('postes_organiques').first('id')) {
    const contenu = {
      grades: await knex('grades').orderBy('niveau', 'desc').select('code', 'code_officiel', 'abreviation', 'libelle', 'categorie', 'niveau', 'actif'),
      postes: await knex('postes_organiques as p').leftJoin('grades as g', 'g.id', 'p.grade_minimum_id').orderBy('p.id')
        .select('p.code', 'p.libelle', 'p.niveau', 'p.role_associe', 'g.code_officiel as grade_requis', 'p.actif'),
      effectif_reference: await knex('effectif_reference').orderBy('ordre').select('code', 'libelle', 'nombre', 'critere_type', 'critere_code'),
      effectif_structure: await knex('effectif_structure').orderBy('id').select('structure_code', 'critere_type', 'critere_code', 'nombre'),
    };
    await knex('referentiel_versions').insert({ numero: 1, source: SOURCE, date_application: '2026-10-09', observation: 'Version initiale chargée au démarrage.', contenu: JSON.stringify(contenu) });
  }

  await knex.schema.createTable('groupes_travail', (t) => {
    t.increments('id');
    t.string('code', 30).notNullable().unique();
    t.string('nom', 200).notNullable();
    t.text('objet').notNullable();
    t.integer('acte_id').references('actes_administratifs.id');
    t.string('acte_reference', 200); // acte ou décision de création (référence officielle)
    t.date('date_debut').notNullable();
    t.date('date_fin');
    t.string('statut', 10).notNullable().defaultTo('ACTIF');
    t.text('motif_cloture');
    t.integer('created_by').references('users.id');
    t.timestamps(true, true);
  });
  await knex.raw(`ALTER TABLE groupes_travail ADD CONSTRAINT groupes_travail_chk CHECK (statut IN ('ACTIF','CLOS') AND (date_fin IS NULL OR date_fin >= date_debut))`);
  await knex.schema.createTable('groupe_membres', (t) => {
    t.increments('id');
    t.integer('groupe_id').notNullable().references('groupes_travail.id').onDelete('CASCADE');
    t.integer('agent_id').notNullable().references('agents.id');
    t.string('role', 15).notNullable().defaultTo('MEMBRE');
    t.date('date_debut').notNullable();
    t.date('date_fin');
    t.integer('created_by').references('users.id');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });
  await knex.raw(`ALTER TABLE groupe_membres ADD CONSTRAINT groupe_membres_chk CHECK (role IN ('COORDONNATEUR','MEMBRE','RAPPORTEUR'))`);
  await knex.raw('CREATE UNIQUE INDEX groupe_membres_actif_uniq ON groupe_membres (groupe_id, agent_id) WHERE date_fin IS NULL');
  await knex.schema.createTable('groupe_participants', (t) => {
    t.increments('id');
    t.integer('groupe_id').notNullable().references('groupes_travail.id').onDelete('CASCADE');
    t.string('nom', 200).notNullable();
    t.string('service', 200); // service ou organisme représenté
    t.string('fonction', 200);
    t.string('contact', 200);
    t.integer('created_by').references('users.id');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });

  // Permission de gestion des groupes : Directeur (rôle) et Secrétariat de Direction (structure)
  const [perm] = await knex('permissions').insert({ code: 'groupes.gerer', module: 'organisation', libelle: 'Créer et gérer les groupes de travail de la Direction' })
    .onConflict('code').merge(['libelle']).returning('id');
  const dir = await knex('roles').where({ code: 'DIRECTEUR' }).first();
  if (dir) await knex('role_permissions').insert({ role_id: dir.id, permission_id: perm.id || perm }).onConflict(['role_id', 'permission_id']).ignore();
};

exports.down = async function down(knex) {
  const perm = await knex('permissions').where({ code: 'groupes.gerer' }).first();
  if (perm) {
    await knex('role_permissions').where({ permission_id: perm.id }).del();
    await knex('user_permissions').where({ permission_id: perm.id }).del();
    await knex('permissions').where({ id: perm.id }).del();
  }
  await knex.schema.dropTable('groupe_participants');
  await knex.schema.dropTable('groupe_membres');
  await knex.schema.dropTable('groupes_travail');
  await knex.raw('DROP TRIGGER IF EXISTS trg_referentiel_versions_ajout_seul ON referentiel_versions; DROP FUNCTION IF EXISTS trg_fn_referentiel_versions_ajout_seul()');
  await knex.schema.dropTable('referentiel_versions');
  await knex.schema.dropTable('effectif_structure');
};

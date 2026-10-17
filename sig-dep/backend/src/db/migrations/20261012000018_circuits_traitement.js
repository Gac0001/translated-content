'use strict';
/**
 * Lot 8A — Compléments des circuits de traitement (cahier des charges, §§ 13, 14, 25 et annexe 2).
 *  - Instructions et tâches : statuts « bloquée », « rapport intermédiaire » et « annulée » ;
 *    prolongations motivées (demande de l’exécutant, décision de l’émetteur) ;
 *  - instruction exceptionnelle du Directeur à tout agent, avec justification et copie
 *    automatique au supérieur immédiat du destinataire ;
 *  - tâches : sous-tâches, dépendances et preuves d’exécution ;
 *  - documents : en relecture → visé → validé → publié → archivé, avec liste de diffusion ;
 *  - demandes d’information du Secrétaire Général au Directeur.
 */
const STATUTS_TRAITEMENT = "'BROUILLON','TRANSMISE','RECUE','EN_COURS','BLOQUEE','RAPPORT_INTERMEDIAIRE','A_CORRIGER','EXECUTEE','VALIDEE','CLOTUREE','EN_RETARD','ANNULEE'";
const ANCIENS_TRAITEMENT = "'BROUILLON','TRANSMISE','RECUE','EN_COURS','A_CORRIGER','EXECUTEE','VALIDEE','CLOTUREE','EN_RETARD'";

const PERMISSIONS = [
  ['documents.viser', 'documents', 'Viser les documents avant validation par le Directeur', ['CHEF_DIVISION', 'CHEF_BUREAU']],
  ['documents.publier', 'documents', 'Publier les documents validés et choisir leur diffusion', ['DIRECTEUR']],
  ['instructions.exceptionnelle', 'instructions', 'Adresser une instruction exceptionnelle à tout agent (copie au supérieur immédiat)', ['DIRECTEUR']],
  ['demandes_info.emettre', 'demandes_info', 'Adresser une demande d’information au Directeur', ['SECRETAIRE_GENERAL']],
  ['demandes_info.repondre', 'demandes_info', 'Répondre aux demandes d’information du Secrétaire Général', ['DIRECTEUR']],
  // Un Agent peut recevoir une instruction exceptionnelle du Directeur : il doit pouvoir l’exécuter.
  ['instructions.executer', null, null, ['AGENT']],
];

exports.up = async function up(knex) {
  // ─── Instructions et tâches ────────────────────────────────────────────────
  for (const table of ['instructions', 'tasks']) {
    await knex.raw(`ALTER TABLE ${table} ALTER COLUMN statut TYPE varchar(30)`); // « RAPPORT_INTERMEDIAIRE »
    await knex.schema.alterTable(table, (t) => {
      t.string('statut_avant_blocage', 30);
      t.text('motif_blocage');
      t.timestamp('bloquee_at');
      t.text('motif_annulation');
      t.timestamp('annulee_at');
      t.date('echeance_initiale');
    });
  }
  await knex.raw('ALTER TABLE instructions DROP CONSTRAINT instructions_chk');
  await knex.raw(`ALTER TABLE instructions ADD CONSTRAINT instructions_chk CHECK (
    statut IN (${STATUTS_TRAITEMENT})
    AND priorite IN ('BASSE','NORMALE','HAUTE','URGENTE') AND avancement BETWEEN 0 AND 100
    AND emetteur_user_id <> destinataire_user_id)`);
  await knex.raw('ALTER TABLE tasks DROP CONSTRAINT tasks_chk');
  await knex.raw(`ALTER TABLE tasks ADD CONSTRAINT tasks_chk CHECK (
    statut IN (${STATUTS_TRAITEMENT})
    AND priorite IN ('BASSE','NORMALE','HAUTE','URGENTE') AND avancement BETWEEN 0 AND 100)`);

  await knex.schema.alterTable('instructions', (t) => {
    t.boolean('exceptionnelle').notNullable().defaultTo(false);
    t.text('justification_exception');
    t.integer('copie_user_id').references('users.id');
  });
  await knex.raw(`ALTER TABLE instructions ADD CONSTRAINT instructions_exception_chk CHECK (
    NOT exceptionnelle OR (justification_exception IS NOT NULL AND length(trim(justification_exception)) >= 10))`);

  await knex.schema.alterTable('tasks', (t) => {
    t.integer('parent_task_id').references('tasks.id');
    t.index(['parent_task_id']);
  });
  await knex.schema.createTable('task_dependances', (t) => {
    t.integer('task_id').notNullable().references('tasks.id').onDelete('CASCADE');
    t.integer('depend_de_task_id').notNullable().references('tasks.id').onDelete('CASCADE');
    t.primary(['task_id', 'depend_de_task_id']);
  });
  await knex.raw('ALTER TABLE task_dependances ADD CONSTRAINT task_dep_chk CHECK (task_id <> depend_de_task_id)');

  // Preuves d’exécution : pièces jointes marquées comme telles
  await knex.schema.alterTable('attachments', (t) => { t.string('categorie', 20); });

  await knex.schema.createTable('prolongations', (t) => {
    t.increments('id');
    t.string('entity_type', 20).notNullable(); // INSTRUCTION | TASK
    t.integer('entity_id').notNullable();
    t.integer('demandeur_user_id').notNullable().references('users.id');
    t.date('echeance_actuelle');
    t.date('echeance_demandee').notNullable();
    t.text('motif').notNullable();
    t.string('statut', 20).notNullable().defaultTo('DEMANDEE'); // DEMANDEE | ACCORDEE | REFUSEE
    t.integer('decide_par').references('users.id');
    t.timestamp('decide_at');
    t.text('commentaire');
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.index(['entity_type', 'entity_id']);
  });
  await knex.raw(`ALTER TABLE prolongations ADD CONSTRAINT prolongations_chk CHECK (
    entity_type IN ('INSTRUCTION','TASK') AND statut IN ('DEMANDEE','ACCORDEE','REFUSEE'))`);
  await knex.raw(`CREATE UNIQUE INDEX prolongations_une_demande ON prolongations(entity_type, entity_id) WHERE statut = 'DEMANDEE'`);

  // ─── Documents ─────────────────────────────────────────────────────────────
  await knex.raw('ALTER TABLE documents DROP CONSTRAINT documents_chk');
  await knex('documents').where({ statut: 'EN_EXAMEN' }).update({ statut: 'EN_RELECTURE' });
  await knex('documents').where({ statut: 'VALIDE_DIVISION' }).update({ statut: 'VISE' });
  // L’historique (ajout seul) garde les anciens libellés « En examen » et « Validé (Division) ».
  await knex.raw(`ALTER TABLE documents ADD CONSTRAINT documents_chk CHECK (
    statut IN ('BROUILLON','EN_RELECTURE','A_CORRIGER','VISE','VALIDE','PUBLIE','REJETE','ARCHIVE')
    AND confidentialite IN ('ORDINAIRE','CONFIDENTIEL','SECRET'))`);
  await knex.schema.alterTable('documents', (t) => {
    t.string('diffusion', 20); // DIRECTION | STRUCTURES
    t.boolean('diffusion_sg').notNullable().defaultTo(false);
    t.integer('publie_par').references('users.id');
    t.timestamp('publie_at');
  });
  await knex.schema.createTable('document_diffusions', (t) => {
    t.increments('id');
    t.integer('document_id').notNullable().references('documents.id').onDelete('CASCADE');
    t.integer('division_id').references('divisions.id');
    t.integer('bureau_id').references('bureaux.id');
    t.index(['document_id']);
  });
  await knex.raw('ALTER TABLE document_diffusions ADD CONSTRAINT document_diffusions_chk CHECK ((division_id IS NULL) <> (bureau_id IS NULL))');

  // ─── Demandes d’information du SG au Directeur ─────────────────────────────
  await knex.schema.createTable('demandes_information', (t) => {
    t.increments('id');
    t.string('reference', 60).notNullable().unique();
    t.integer('emetteur_user_id').notNullable().references('users.id');
    t.string('objet', 300).notNullable();
    t.text('question').notNullable();
    t.string('priorite', 20).notNullable().defaultTo('NORMALE');
    t.date('echeance');
    t.string('statut', 20).notNullable().defaultTo('ENVOYEE'); // ENVOYEE | REPONDUE | CLOSE
    t.text('reponse');
    t.integer('repondu_par').references('users.id');
    t.timestamp('repondu_at');
    t.timestamp('cloture_at');
    t.timestamps(true, true);
    t.index(['statut']);
  });
  await knex.raw(`ALTER TABLE demandes_information ADD CONSTRAINT demandes_info_chk CHECK (
    statut IN ('ENVOYEE','REPONDUE','CLOSE') AND priorite IN ('BASSE','NORMALE','HAUTE','URGENTE'))`);

  for (const [code, module, libelle, roles] of PERMISSIONS) {
    const p = module
      ? (await knex('permissions').insert({ code, module, libelle, delegable: false, reservee_division: false }).onConflict('code').merge().returning('*'))[0]
      : await knex('permissions').where({ code }).first();
    if (!p) continue;
    for (const r of roles) {
      const ro = await knex('roles').where({ code: r }).first();
      if (ro) await knex('role_permissions').insert({ role_id: ro.id, permission_id: p.id }).onConflict(['role_id', 'permission_id']).ignore();
    }
  }
};

exports.down = async function down(knex) {
  const nouvelles = PERMISSIONS.filter((p) => p[1]).map((p) => p[0]);
  const ids = await knex('permissions').whereIn('code', nouvelles).pluck('id');
  await knex('role_permissions').whereIn('permission_id', ids).del();
  await knex('permissions').whereIn('id', ids).del();
  const exec = await knex('permissions').where({ code: 'instructions.executer' }).first();
  const agent = await knex('roles').where({ code: 'AGENT' }).first();
  if (exec && agent) await knex('role_permissions').where({ role_id: agent.id, permission_id: exec.id }).del();

  await knex.schema.dropTableIfExists('demandes_information');
  await knex.schema.dropTableIfExists('document_diffusions');
  await knex.schema.alterTable('documents', (t) => { t.dropColumn('diffusion'); t.dropColumn('diffusion_sg'); t.dropColumn('publie_par'); t.dropColumn('publie_at'); });
  await knex.raw('ALTER TABLE documents DROP CONSTRAINT documents_chk');
  await knex('documents').where({ statut: 'EN_RELECTURE' }).update({ statut: 'EN_EXAMEN' });
  await knex('documents').where({ statut: 'VISE' }).update({ statut: 'VALIDE_DIVISION' });
  await knex('documents').where({ statut: 'PUBLIE' }).update({ statut: 'VALIDE' });
  await knex.raw(`ALTER TABLE documents ADD CONSTRAINT documents_chk CHECK (
    statut IN ('BROUILLON','EN_EXAMEN','A_CORRIGER','VALIDE_DIVISION','VALIDE','REJETE','ARCHIVE')
    AND confidentialite IN ('ORDINAIRE','CONFIDENTIEL','SECRET'))`);

  await knex.schema.dropTableIfExists('prolongations');
  await knex.schema.alterTable('attachments', (t) => { t.dropColumn('categorie'); });
  await knex.schema.dropTableIfExists('task_dependances');
  await knex.schema.alterTable('tasks', (t) => { t.dropColumn('parent_task_id'); });
  await knex.raw('ALTER TABLE instructions DROP CONSTRAINT instructions_exception_chk');
  await knex.schema.alterTable('instructions', (t) => { t.dropColumn('exceptionnelle'); t.dropColumn('justification_exception'); t.dropColumn('copie_user_id'); });
  for (const table of ['instructions', 'tasks']) {
    await knex(table).whereIn('statut', ['BLOQUEE', 'RAPPORT_INTERMEDIAIRE']).update({ statut: 'EN_COURS' });
    await knex(table).where({ statut: 'ANNULEE' }).update({ statut: 'CLOTUREE' });
    await knex.raw(`ALTER TABLE ${table} DROP CONSTRAINT ${table}_chk`);
    await knex.schema.alterTable(table, (t) => {
      ['statut_avant_blocage', 'motif_blocage', 'bloquee_at', 'motif_annulation', 'annulee_at', 'echeance_initiale'].forEach((c) => t.dropColumn(c));
    });
  }
  await knex.raw(`ALTER TABLE instructions ADD CONSTRAINT instructions_chk CHECK (
    statut IN (${ANCIENS_TRAITEMENT})
    AND priorite IN ('BASSE','NORMALE','HAUTE','URGENTE') AND avancement BETWEEN 0 AND 100
    AND emetteur_user_id <> destinataire_user_id)`);
  await knex.raw(`ALTER TABLE tasks ADD CONSTRAINT tasks_chk CHECK (
    statut IN (${ANCIENS_TRAITEMENT})
    AND priorite IN ('BASSE','NORMALE','HAUTE','URGENTE') AND avancement BETWEEN 0 AND 100)`);
};

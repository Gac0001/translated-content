'use strict';
/**
 * 1.10 — Actes administratifs, intérims et désignations (cahier des charges, §§ 9, 33 et 36) :
 *  - registre des actes (nomination, affectation, intérim, désignation, fin de fonction, autre),
 *    préparés par le Bureau Secrétariat de Direction, validés par le Directeur ; les actes relatifs
 *    au poste de Directeur sont enregistrés par l’Admin Système et validés par le Secrétaire Général ;
 *  - un acte validé n’est plus modifiable : il se corrige par un rectificatif ou se révoque ;
 *  - un seul intérim en vigueur par poste de commandement (contrôlé en base) ;
 *  - les « délégations » deviennent des désignations : acte, période et expiration automatique ;
 *    les droits accordés sans acte sont à régulariser sous 30 jours.
 */
const PERMISSIONS = [
  ['actes.consulter', 'Consulter le registre des actes administratifs', ['DIRECTEUR', 'SECRETAIRE_GENERAL']],
  ['actes.preparer', 'Préparer l’enregistrement des actes administratifs', ['DIRECTEUR']],
  ['actes.valider', 'Valider les actes administratifs relevant du Directeur', ['DIRECTEUR']],
  ['actes.valider_direction', 'Valider les actes relatifs au poste de Directeur', ['SECRETAIRE_GENERAL']],
  ['actes.enregistrer_direction', 'Enregistrer les actes relatifs au poste de Directeur', ['ADMIN_SYSTEME']],
];

exports.up = async function up(knex) {
  await knex.schema.createTable('actes_administratifs', (t) => {
    t.increments('id');
    t.string('numero', 30).notNullable().unique(); // numéro d’enregistrement interne DEP/ACT/AAAA/NNNN
    t.string('type', 20).notNullable(); // NOMINATION | AFFECTATION | INTERIM | DESIGNATION | FIN_FONCTION | AUTRE
    t.string('reference', 150).notNullable(); // référence officielle de l’acte (ex. Note de service n° …)
    t.date('date_acte').notNullable();
    t.string('autorite', 150).notNullable(); // autorité signataire
    t.string('objet', 300).notNullable();
    t.text('motif');
    t.integer('agent_id').references('agents.id'); // personne concernée (intérimaire, bénéficiaire…)
    t.integer('poste_id').references('postes_organiques.id');
    t.integer('titulaire_agent_id').references('agents.id'); // titulaire remplacé (intérim)
    t.jsonb('permissions').notNullable().defaultTo('[]'); // désignation : codes des permissions accordées
    t.date('date_debut');
    t.date('date_fin');
    t.string('validation_par', 20).notNullable().defaultTo('DIRECTEUR'); // DIRECTEUR | SECRETAIRE_GENERAL
    t.string('statut', 12).notNullable().defaultTo('BROUILLON'); // BROUILLON | SOUMIS | VALIDE | REFUSE | REVOQUE | EXPIRE | REMPLACE
    t.integer('rectifie_acte_id').references('actes_administratifs.id');
    t.integer('prepare_par').references('users.id');
    t.timestamp('soumis_at');
    t.integer('decide_par').references('users.id');
    t.timestamp('decide_at');
    t.text('commentaire_decision');
    t.integer('revoque_par').references('users.id');
    t.timestamp('revoque_at');
    t.text('motif_revocation');
    t.timestamp('debut_notifie_at');
    t.timestamp('rappel_notifie_at');
    t.timestamp('fin_notifiee_at');
    t.timestamps(true, true);
    t.index(['type', 'statut']);
    t.index(['agent_id']);
    t.index(['poste_id']);
  });
  await knex.raw(`ALTER TABLE actes_administratifs ADD CONSTRAINT actes_type_chk CHECK (type IN ('NOMINATION','AFFECTATION','INTERIM','DESIGNATION','FIN_FONCTION','AUTRE'))`);
  await knex.raw(`ALTER TABLE actes_administratifs ADD CONSTRAINT actes_statut_chk CHECK (statut IN ('BROUILLON','SOUMIS','VALIDE','REFUSE','REVOQUE','EXPIRE','REMPLACE'))`);
  await knex.raw(`ALTER TABLE actes_administratifs ADD CONSTRAINT actes_validation_chk CHECK (validation_par IN ('DIRECTEUR','SECRETAIRE_GENERAL'))`);
  await knex.raw(`ALTER TABLE actes_administratifs ADD CONSTRAINT actes_periode_chk CHECK (date_fin IS NULL OR date_debut IS NULL OR date_fin >= date_debut)`);
  // Un intérim et une désignation exigent une personne, une période complète ; l’intérim exige un poste.
  await knex.raw(`ALTER TABLE actes_administratifs ADD CONSTRAINT actes_temporaire_chk CHECK (
    type NOT IN ('INTERIM','DESIGNATION') OR (agent_id IS NOT NULL AND date_debut IS NOT NULL AND date_fin IS NOT NULL))`);
  await knex.raw(`ALTER TABLE actes_administratifs ADD CONSTRAINT actes_interim_chk CHECK (type <> 'INTERIM' OR poste_id IS NOT NULL)`);
  await knex.raw(`ALTER TABLE actes_administratifs ADD CONSTRAINT actes_interim_personne_chk CHECK (titulaire_agent_id IS NULL OR titulaire_agent_id <> agent_id)`);

  // Intangibilité d’un acte décidé ; un seul intérim en vigueur par poste et par intérimaire.
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
  await knex.raw(`CREATE TRIGGER trg_actes_controle BEFORE INSERT OR UPDATE OR DELETE ON actes_administratifs
    FOR EACH ROW EXECUTE FUNCTION trg_fn_actes_controle()`);

  // Désignations : acte, période, régularisation des droits accordés sans acte.
  await knex.schema.alterTable('user_permissions', (t) => {
    t.integer('acte_id').references('actes_administratifs.id');
    t.date('date_debut');
    t.date('date_fin');
    t.timestamp('a_regulariser_avant');
    t.string('motif_revocation', 300);
  });
  await knex('user_permissions').whereNull('revoked_at').whereNull('acte_id')
    .update({ a_regulariser_avant: knex.raw(`now() + interval '30 days'`) });

  // Traçabilité : affectation fondée sur un acte.
  await knex.schema.alterTable('affectations', (t) => { t.integer('acte_id').references('actes_administratifs.id'); });

  // Permissions : délégations → désignations ; registre des actes.
  await knex('permissions').where({ code: 'delegations.gerer' })
    .update({ code: 'designations.gerer', libelle: 'Accorder et révoquer les désignations temporaires (sur acte)' });
  for (const [code, libelle, roles] of PERMISSIONS) {
    const [p] = await knex('permissions').insert({ code, module: 'gouvernance', libelle, delegable: false, reservee_division: false })
      .onConflict('code').merge().returning('*');
    for (const r of roles) {
      const role = await knex('roles').where({ code: r }).first();
      if (role) await knex('role_permissions').insert({ role_id: role.id, permission_id: p.id }).onConflict(['role_id', 'permission_id']).ignore();
    }
  }
};

exports.down = async function down(knex) {
  const codes = PERMISSIONS.map((p) => p[0]);
  const ids = await knex('permissions').whereIn('code', codes).pluck('id');
  await knex('role_permissions').whereIn('permission_id', ids).del();
  await knex('permissions').whereIn('id', ids).del();
  await knex('permissions').where({ code: 'designations.gerer' }).update({ code: 'delegations.gerer', libelle: 'Déléguer des opérations administratives au Bureau Secrétariat de Direction' });
  await knex.schema.alterTable('affectations', (t) => { t.dropColumn('acte_id'); });
  await knex.schema.alterTable('user_permissions', (t) => {
    t.dropColumn('acte_id'); t.dropColumn('date_debut'); t.dropColumn('date_fin'); t.dropColumn('a_regulariser_avant'); t.dropColumn('motif_revocation');
  });
  await knex.raw('DROP TRIGGER IF EXISTS trg_actes_controle ON actes_administratifs');
  await knex.raw('DROP FUNCTION IF EXISTS trg_fn_actes_controle()');
  await knex.schema.dropTableIfExists('actes_administratifs');
};

'use strict';
/**
 * Documents officiels (cahier des charges v2, section 7 et annexe 12) :
 *  - identité du Ministère versionnée (appellation, sigle, en-tête, pied de page, sceau, format des
 *    références), en ajout seul : une modification crée une nouvelle version datée ; un document signé
 *    conserve l’identité en vigueur à sa date de signature ;
 *  - numéro officiel des correspondances attribué à la signature (séquence annuelle commune) ;
 *  - la modification de l’identité est une opération critique confirmée par le Directeur.
 */
exports.up = async function up(knex) {
  await knex.schema.createTable('identite_versions', (t) => {
    t.increments('id');
    t.integer('version').notNullable().unique();
    t.date('date_application').notNullable();
    t.string('ministere', 200).notNullable();
    t.string('sigle', 30).notNullable();
    t.string('secretariat_general', 200).notNullable();
    t.string('direction', 200).notNullable();
    t.string('secretaire_general_titre', 200).notNullable(); // variante d’en-tête du Secrétaire Général
    t.string('adresse', 300).notNullable();
    t.string('courriel', 150).notNullable();
    t.string('site_web', 150).notNullable();
    t.string('qr_contenu', 500).notNullable(); // QR code du pied de page : aucune donnée personnelle
    t.string('format_reference', 200).notNullable();
    t.string('format_reference_sg', 200).notNullable();
    t.binary('sceau'); // sceau aux armoiries (PNG ou JPEG), déposé par l’Admin
    t.string('sceau_type', 30);
    t.text('motif');
    t.integer('created_by'); // sans clé étrangère : la version survit à la réinitialisation des comptes (comme l’audit)
    t.string('created_by_nom', 120);
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });
  await knex.raw(`CREATE TRIGGER trg_identite_versions_append_only BEFORE UPDATE OR DELETE ON identite_versions
    FOR EACH ROW EXECUTE FUNCTION trg_fn_append_only()`);
  await knex('identite_versions').insert({
    version: 1, date_application: '2026-10-09',
    ministere: 'MINISTERE DE L’ECONOMIE NUMERIQUE', sigle: 'MIN-ECN',
    secretariat_general: 'Secrétariat Général au Numérique', direction: 'Direction Etudes et Planification',
    secretaire_general_titre: 'Le Secrétaire Général',
    adresse: '45, Avenue Lubefu, Quartier Royal, Kinshasa - Gombe',
    courriel: 'sg@numerique.gouv.cd', site_web: 'www.numerique.gouv.cd', qr_contenu: 'https://www.numerique.gouv.cd',
    format_reference: 'N° {seq}/{sigle}/SGN/DEP/{signataire}/{redacteur}/{annee}',
    format_reference_sg: 'N° {seq}/{sigle}/SG/{signataire}/DEP/{redacteur}/{annee}',
    motif: 'Identité initiale : en-tête ENTETE_DEP (9 octobre 2026) et pied de page officiel (11 octobre 2026).',
    created_by_nom: 'installation',
  });

  await knex.schema.alterTable('documents', (t) => {
    t.string('numero_officiel', 120).unique();
    t.timestamp('numerote_at', { useTz: true });
    t.integer('identite_version_id').references('identite_versions.id');
  });

  await knex.raw('ALTER TABLE demandes_confirmation DROP CONSTRAINT demandes_confirmation_chk');
  await knex.raw(`ALTER TABLE demandes_confirmation ADD CONSTRAINT demandes_confirmation_chk CHECK (
    type IN ('REINITIALISATION','POLITIQUE','MIGRATIONS','ROLE_ADMIN','IDENTITE')
    AND statut IN ('EN_ATTENTE','CONFIRMEE','REFUSEE','EXPIREE','EXECUTEE','ANNULEE'))`);
};

exports.down = async function down(knex) {
  await knex('demandes_confirmation').where({ type: 'IDENTITE' }).del();
  await knex.raw('ALTER TABLE demandes_confirmation DROP CONSTRAINT demandes_confirmation_chk');
  await knex.raw(`ALTER TABLE demandes_confirmation ADD CONSTRAINT demandes_confirmation_chk CHECK (
    type IN ('REINITIALISATION','POLITIQUE','MIGRATIONS','ROLE_ADMIN')
    AND statut IN ('EN_ATTENTE','CONFIRMEE','REFUSEE','EXPIREE','EXECUTEE','ANNULEE'))`);
  await knex.schema.alterTable('documents', (t) => {
    t.dropColumn('identite_version_id');
    t.dropColumn('numerote_at');
    t.dropColumn('numero_officiel');
  });
  await knex.schema.dropTable('identite_versions');
};

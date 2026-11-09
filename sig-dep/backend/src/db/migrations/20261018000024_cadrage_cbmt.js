'use strict';
/**
 * Lot 11 — Cadrage budgétaire : le Cadre Budgétaire à Moyen Terme (CBMT) du Ministère du Budget
 * devient un document de programmation (type CBMT, année = première année de la période de trois
 * ans), avec le même circuit que le PAP (Bureau Programme → Chef du Bureau Programme → Chef de la
 * Division Programme et Suivi → Directeur) et la même intangibilité une fois validé. Son contenu
 * porte les hypothèses macroéconomiques, les plafonds du Ministère par année et par nature
 * (rubriques budgétaires) et les actions prioritaires du secteur, reliées aux programmes et aux
 * projets PIP.
 */
exports.up = async function up(knex) {
  await knex.raw('ALTER TABLE plan_documents DROP CONSTRAINT plan_documents_chk');
  await knex.raw(`ALTER TABLE plan_documents ADD CONSTRAINT plan_documents_chk CHECK (type IN ('PAP','RAP','CDMT','CBMT') AND statut IN ('BROUILLON','SOUMIS','VERIFIE','CONSOLIDE','VALIDE','A_CORRIGER'))`);
};

exports.down = async function down(knex) {
  await knex('plan_documents').where({ type: 'CBMT' }).whereNot('statut', 'VALIDE').del();
  await knex.raw('ALTER TABLE plan_documents DROP CONSTRAINT plan_documents_chk');
  await knex.raw(`ALTER TABLE plan_documents ADD CONSTRAINT plan_documents_chk CHECK (type IN ('PAP','RAP','CDMT','CBMT') AND statut IN ('BROUILLON','SOUMIS','VERIFIE','CONSOLIDE','VALIDE','A_CORRIGER'))`);
};

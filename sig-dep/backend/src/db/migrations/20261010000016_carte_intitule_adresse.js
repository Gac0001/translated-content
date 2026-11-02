'use strict';
/**
 * 1.12.1 — Modèle de carte de service : intitulé officiel et adresse.
 *  - intitulé : MINISTÈRE DE L’ÉCONOMIE NUMÉRIQUE / SECRÉTARIAT GÉNÉRAL / DIRECTION D’ÉTUDES ET PLANIFICATION ;
 *  - adresse : 45, Avenue Lubefu, Quartier Royal, Kinshasa-Gombe.
 * Nouvelle version du modèle : les cartes déjà validées conservent la leur.
 */
const INTITULE = ['MINISTÈRE DE L’ÉCONOMIE NUMÉRIQUE', 'SECRÉTARIAT GÉNÉRAL', 'DIRECTION D’ÉTUDES ET PLANIFICATION'];
const ADRESSE = '45, Avenue Lubefu, Quartier Royal, Kinshasa-Gombe';

exports.up = async function up(knex) {
  const actif = await knex('modeles_carte').where({ actif: true }).first();
  if (!actif) return;
  const version = Number((await knex('modeles_carte').max('version as v').first()).v) + 1;
  const { id, created_at: c, created_by: cb, version: v, ...base } = actif;
  await knex('modeles_carte').where({ id }).update({ actif: false });
  await knex('modeles_carte').insert({
    ...base, version, actif: true, intitule: JSON.stringify(INTITULE), adresse: ADRESSE,
    note: 'Intitulé officiel (Ministère, Secrétariat Général, Direction) et adresse de la Direction',
  });
};

exports.down = async function down(knex) {
  const actif = await knex('modeles_carte').where({ actif: true }).first();
  if (!actif || actif.adresse !== ADRESSE) return;
  await knex('modeles_carte').where({ id: actif.id }).del();
  const prec = await knex('modeles_carte').orderBy('version', 'desc').first();
  if (prec) await knex('modeles_carte').where({ id: prec.id }).update({ actif: true });
};

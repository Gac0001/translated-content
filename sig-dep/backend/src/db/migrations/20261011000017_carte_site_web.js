'use strict';
/**
 * 1.12.3 — Modèle de carte de service : site web www.numerique.cd au pied du verso.
 * Nouvelle version du modèle : les cartes déjà validées conservent la leur.
 */
const SITE_WEB = 'www.numerique.cd';

exports.up = async function up(knex) {
  const actif = await knex('modeles_carte').where({ actif: true }).first();
  if (!actif || actif.site_web === SITE_WEB) return;
  const version = Number((await knex('modeles_carte').max('version as v').first()).v) + 1;
  const { id, created_at: c, created_by: cb, version: v, ...base } = actif;
  await knex('modeles_carte').where({ id }).update({ actif: false });
  await knex('modeles_carte').insert({
    ...base, version, actif: true, intitule: JSON.stringify(base.intitule), site_web: SITE_WEB,
    note: 'Site web du ministère (www.numerique.cd)',
  });
};

exports.down = async function down(knex) {
  const actif = await knex('modeles_carte').where({ actif: true }).first();
  if (!actif || actif.site_web !== SITE_WEB || actif.note !== 'Site web du ministère (www.numerique.cd)') return;
  const prec = await knex('modeles_carte').where('version', '<', actif.version).orderBy('version', 'desc').first();
  const utilise = await knex('cartes_service').where({ modele_id: actif.id }).first();
  if (utilise) await knex('modeles_carte').where({ id: actif.id }).update({ actif: false });
  else await knex('modeles_carte').where({ id: actif.id }).del();
  if (prec) await knex('modeles_carte').where({ id: prec.id }).update({ actif: true });
};

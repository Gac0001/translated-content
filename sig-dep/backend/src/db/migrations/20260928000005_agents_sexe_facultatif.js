'use strict';

/**
 * Le sexe des Agents devient facultatif : les listes officielles importées ne le mentionnent
 * pas toujours, et il ne doit jamais être déduit du prénom. La contrainte M/F reste active.
 */
exports.up = async function up(knex) {
  await knex.raw('ALTER TABLE agents ALTER COLUMN sexe DROP NOT NULL');
};

exports.down = async function down(knex) {
  await knex.raw(`UPDATE agents SET sexe = 'M' WHERE sexe IS NULL`);
  await knex.raw('ALTER TABLE agents ALTER COLUMN sexe SET NOT NULL');
};

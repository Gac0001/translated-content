'use strict';
// Réinitialise la base de test : rollback complet, migrations, seeds (données de démonstration incluses).
module.exports = async () => {
  process.env.NODE_ENV = 'test';
  const knex = require('knex');
  const config = require('../knexfile').test;
  const db = knex(config);
  await db.migrate.rollback(undefined, true);
  await db.migrate.latest();
  await db.seed.run();
  await db.destroy();
};

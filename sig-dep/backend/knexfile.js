'use strict';
const config = require('./src/config/env');

const base = {
  client: 'pg',
  connection: config.databaseUrl,
  pool: { min: 0, max: 10 },
  migrations: { directory: './src/db/migrations', tableName: 'knex_migrations' },
  seeds: { directory: './src/db/seeds' },
};

module.exports = { development: base, test: base, production: base };

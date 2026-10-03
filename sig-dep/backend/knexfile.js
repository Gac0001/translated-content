'use strict';
const path = require('path');
const config = require('./src/config/env');

const base = {
  client: 'pg',
  connection: config.databaseUrl,
  pool: { min: 0, max: 10 },
  migrations: { directory: path.join(__dirname, 'src/db/migrations'), tableName: 'knex_migrations' },
  seeds: { directory: path.join(__dirname, 'src/db/seeds') },
};

module.exports = { development: base, test: base, production: base };

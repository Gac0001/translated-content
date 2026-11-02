'use strict';
const db = require('../src/db/knex');
afterAll(async () => { await db.destroy(); });

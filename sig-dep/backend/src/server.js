'use strict';
const fs = require('fs');
const config = require('./config/env');
const app = require('./app');
const db = require('./db/knex');
const jobs = require('./services/jobs');

for (const dir of [config.uploadDir, config.backupDir]) fs.mkdirSync(dir, { recursive: true });

async function start() {
  try {
    await db.raw('select 1');
  } catch (e) {
    console.error('Impossible de se connecter à PostgreSQL :', e.message);
    console.error('Vérifiez DATABASE_URL dans backend/.env puis exécutez « npm run migrate » et « npm run seed ».');
    process.exit(1);
  }
  app.listen(config.port, () => {
    console.log(`SIG-DEP — API de la Direction d’Études et Planification démarrée sur http://localhost:${config.port}`);
  });
  jobs.start();
}

start();

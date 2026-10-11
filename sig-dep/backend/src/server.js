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
  const quoi = config.frontendDir ? 'interface et API' : 'API';
  if (config.tls) {
    // HTTPS direct (certificat interne) ; le port HTTP facultatif ne fait que rediriger.
    const https = require('https');
    https.createServer({ cert: fs.readFileSync(config.tls.cert), key: fs.readFileSync(config.tls.key) }, app).listen(config.port, () => {
      console.log(`SIG-DEP — ${quoi} de la Direction d’Études et Planification démarrées sur https://localhost:${config.port}`);
    });
    if (config.tls.redirectPort) {
      require('http').createServer((req, res) => {
        const hote = String(req.headers.host || 'localhost').replace(/:\d+$/, '');
        res.writeHead(301, { Location: `https://${hote}${config.port === 443 ? '' : `:${config.port}`}${req.url}` }).end();
      }).listen(config.tls.redirectPort);
    }
  } else {
    app.listen(config.port, () => {
      console.log(`SIG-DEP — ${quoi} de la Direction d’Études et Planification démarrées sur http://localhost:${config.port}`);
    });
  }
  jobs.start();
}

start();

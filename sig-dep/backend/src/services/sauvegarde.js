'use strict';
/** Sauvegarde PostgreSQL (pg_dump, format personnalisé) dans BACKUP_DIR. */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const config = require('../config/env');
const { AppError } = require('../utils/errors');

async function creerSauvegarde(suffixe = '') {
  fs.mkdirSync(config.backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const file = path.join(config.backupDir, `sig-dep-${stamp}${suffixe}.dump`);
  const url = new URL(config.databaseUrl);
  const env = { ...process.env, PGPASSWORD: decodeURIComponent(url.password) };
  const args = ['-h', url.hostname, '-p', url.port || '5432', '-U', decodeURIComponent(url.username), '-F', 'c', '-f', file, url.pathname.slice(1)];
  await new Promise((resolve, reject) => {
    const p = spawn(config.pgDumpPath, args, { env });
    let err = '';
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', () => reject(new AppError(500, 'PG_DUMP_INDISPONIBLE', 'pg_dump est introuvable. Installez les outils clients PostgreSQL ou renseignez PG_DUMP_PATH dans le fichier .env.')));
    p.on('close', (code) => (code === 0 ? resolve() : reject(new AppError(500, 'SAUVEGARDE_ECHEC', `Échec de la sauvegarde : ${err.trim().slice(0, 300)}`))));
  });
  return { fichier: path.basename(file), tailleOctets: fs.statSync(file).size };
}

module.exports = { creerSauvegarde };

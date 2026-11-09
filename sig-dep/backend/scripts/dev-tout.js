#!/usr/bin/env node
'use strict';
/**
 * Environnement de développement complet, sur le poste (Windows, Git Bash ou PowerShell) comme dans le cloud.
 *
 *   npm run dev:tout                 démarre ce qui ne répond pas : PostgreSQL (Linux), API (4000), interface (5173)
 *   npm run dev:tout -- --relancer   arrête puis redémarre l’API et l’interface
 *   npm run dev:tout -- --arret      arrête l’API et l’interface
 *
 * Les serveurs sont lancés détachés (ils survivent à la fermeture du terminal) ; leurs sorties vont dans
 * <dossier temporaire>/sigdep-dev/api.log et vite.log, leurs numéros de processus dans pids.json.
 * L’API est lancée avec LOGIN_RATE_LIMIT_MAX=500 (sauf valeur déjà fixée) pour enchaîner les tests de l’interface.
 * Sous Windows, PostgreSQL tourne comme service : il n’est pas démarré ici.
 */
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const BACKEND = path.resolve(__dirname, '..');
const FRONTEND = path.resolve(BACKEND, '..', 'frontend');
const DOSSIER = path.join(os.tmpdir(), 'sigdep-dev');
const PIDS = path.join(DOSSIER, 'pids.json');
const WINDOWS = process.platform === 'win32';
const API = 'http://localhost:4000/api/health';
const INTERFACE = 'http://localhost:5173/';
fs.mkdirSync(DOSSIER, { recursive: true });

const attendre = (ms) => new Promise((r) => setTimeout(r, ms));
async function repond(url) {
  try { return (await fetch(url, { signal: AbortSignal.timeout(3000) })).ok; } catch { return false; }
}
const lirePids = () => { try { return JSON.parse(fs.readFileSync(PIDS, 'utf8')); } catch { return {}; } };
const ecrirePids = (p) => fs.writeFileSync(PIDS, JSON.stringify(p, null, 2));

/** Processus des serveurs lancés hors de ce script (Linux) : reconnus par leur ligne de commande. */
function processusLinux() {
  if (process.platform !== 'linux') return [];
  const trouves = [];
  for (const d of fs.readdirSync('/proc')) {
    if (!/^\d+$/.test(d) || Number(d) === process.pid) continue;
    let c;
    try { c = fs.readFileSync(`/proc/${d}/cmdline`, 'utf8').replace(/\0/g, ' '); } catch { continue; }
    if (/bash|\bsh -c/.test(c)) continue; // jamais un interpréteur de commandes (dont celui qui lance ce script)
    if (c.startsWith('node src/server.js') || /node_modules\/\.bin\/vite --port 5173/.test(c) || c.startsWith('npm exec vite --port 5173')) trouves.push(Number(d));
  }
  return trouves;
}

function tuer(pid) {
  try {
    if (WINDOWS) spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' });
    else { try { process.kill(-pid, 'SIGTERM'); } catch { process.kill(pid, 'SIGTERM'); } }
    return true;
  } catch { return false; }
}

async function arreter() {
  const pids = [...Object.values(lirePids()), ...processusLinux()];
  const arretes = [...new Set(pids)].filter(tuer);
  ecrirePids({});
  await attendre(1000);
  console.log(arretes.length ? `Arrêtés : ${arretes.join(', ')}` : 'Aucun serveur à arrêter.');
}

function lancer(nom, commande, args, cwd, env = {}) {
  const sortie = fs.openSync(path.join(DOSSIER, `${nom}.log`), 'w');
  const enfant = spawn(commande, args, { cwd, env: { ...process.env, ...env }, detached: true, stdio: ['ignore', sortie, sortie], shell: WINDOWS, windowsHide: true });
  enfant.unref();
  return enfant.pid;
}

async function demarrer() {
  if (process.platform === 'linux' && spawnSync('pg_isready', ['-q']).status !== 0) {
    spawnSync('service', ['postgresql', 'start'], { stdio: 'ignore' });
    for (let i = 0; i < 30 && spawnSync('pg_isready', ['-q']).status !== 0; i += 1) await attendre(500);
  }
  const pids = lirePids();
  if (!(await repond(API))) {
    pids.api = lancer('api', 'node', ['src/server.js'], BACKEND, { LOGIN_RATE_LIMIT_MAX: process.env.LOGIN_RATE_LIMIT_MAX || '500' });
  }
  if (!(await repond(INTERFACE))) {
    pids.vite = lancer('vite', 'npx', ['vite', '--port', '5173'], FRONTEND);
  }
  ecrirePids(pids);
  let ok = [false, false];
  for (let i = 0; i < 60; i += 1) {
    ok = [await repond(API), await repond(INTERFACE)];
    if (ok[0] && ok[1]) break;
    await attendre(500);
  }
  const etat = (b) => (b ? 'prête' : `ne répond pas (journaux : ${DOSSIER})`);
  console.log(`API ${etat(ok[0])} — http://localhost:4000 ; interface ${etat(ok[1])} — http://localhost:5173`);
  if (!ok[0] || !ok[1]) process.exitCode = 1;
}

(async () => {
  const arg = process.argv[2];
  if (arg === '--arret') return arreter();
  if (arg === '--relancer') await arreter();
  else if (arg) { console.error('Usage : npm run dev:tout [-- --relancer | --arret]'); process.exitCode = 2; return undefined; }
  return demarrer();
})();

#!/usr/bin/env node
'use strict';
/**
 * Construction du paquet d’installation de SIG-DEP (sur le poste de développement) :
 *   npm run paquet                       → paquets/sig-dep-x.y.z.zip (+ empreinte SHA-256)
 *   npm run paquet -- --sans-dependances → paquet plus léger ; le serveur devra accéder à Internet (npm ci)
 * Le paquet contient l’API (sans tests ni fichiers locaux), ses dépendances de production (valables sous
 * Windows et Linux), l’interface déjà construite, les fichiers de déploiement et le guide de mise en
 * service. Il ne contient jamais de .env, de pièces jointes ni de sauvegardes.
 */
const { spawnSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const JSZip = require('jszip');

const backend = path.resolve(__dirname, '..');
const projet = path.resolve(backend, '..');
const frontend = path.join(projet, 'frontend');
const { version } = require('../package.json');
const nom = `sig-dep-${version}`;
const sortie = path.join(backend, 'paquets');
const dossier = path.join(sortie, nom);
const WINDOWS = process.platform === 'win32';
const flag = (n) => process.argv.includes(`--${n}`);

function run(cmd, args, cwd) {
  const r = spawnSync(cmd, args, { cwd, stdio: 'inherit', shell: WINDOWS });
  if (r.status !== 0) { console.error(`Échec : ${cmd} ${args.join(' ')} (dans ${cwd})`); process.exit(1); }
}
const git = (...a) => (spawnSync('git', a, { cwd: projet, encoding: 'utf8' }).stdout || '').trim();

// Copie filtrée : jamais de secrets, de données locales, de tests ni de dépendances de développement.
const EXCLUS = /(^|[\\/])(\.env|node_modules|storage|tests|coverage|paquets|\.git)([\\/]|$)/;
const copier = (src, dst) => fs.cpSync(src, dst, { recursive: true, filter: (s) => !EXCLUS.test(path.relative(projet, s)) || path.relative(projet, s) === '' });

(async () => {
  console.log(`Paquet ${nom}`);
  const etat = git('status', '--porcelain');
  if (etat) console.warn('Attention : des modifications ne sont pas enregistrées (git) ; le paquet les contiendra.');

  console.log('\n── Interface (construction)');
  run('npm', ['run', 'build'], frontend);

  console.log('\n── Assemblage');
  fs.rmSync(dossier, { recursive: true, force: true });
  fs.mkdirSync(dossier, { recursive: true });
  const b = path.join(dossier, 'backend');
  fs.mkdirSync(b);
  for (const e of ['src', 'scripts', 'package.json', 'package-lock.json', 'knexfile.js', '.env.example']) copier(path.join(backend, e), path.join(b, e));
  fs.mkdirSync(path.join(b, 'storage'), { recursive: true });
  copier(path.join(frontend, 'dist'), path.join(dossier, 'frontend', 'dist'));
  copier(path.join(projet, 'deploy'), path.join(dossier, 'deploy'));
  fs.mkdirSync(path.join(dossier, 'docs'));
  fs.copyFileSync(path.join(projet, 'docs', 'MISE-EN-SERVICE.md'), path.join(dossier, 'docs', 'MISE-EN-SERVICE.md'));
  fs.copyFileSync(path.join(projet, 'CHANGELOG.md'), path.join(dossier, 'CHANGELOG.md'));
  const infos = { version, commit: git('rev-parse', '--short=8', 'HEAD') || null, date: new Date().toISOString(), dependances: !flag('sans-dependances') };
  fs.writeFileSync(path.join(dossier, 'paquet.json'), `${JSON.stringify(infos, null, 2)}\n`);
  fs.writeFileSync(path.join(dossier, 'LISEZ-MOI.txt'), [
    `SIG-DEP ${version} — paquet d’installation`,
    '',
    'Installation ou mise à jour, depuis ce dossier :',
    '  Linux   : sudo node backend/scripts/installer-serveur.js --service',
    '  Windows : node backend\\scripts\\installer-serveur.js --service   (invite de commandes en administrateur)',
    'Guide complet : docs/MISE-EN-SERVICE.md',
    '',
  ].join('\r\n'));

  if (!flag('sans-dependances')) {
    console.log('\n── Dépendances de production (Windows et Linux)');
    run('npm', ['ci', '--omit=dev', '--no-audit', '--no-fund', '--ignore-scripts'], b);
    // bcrypt fournit ses binaires précompilés pour Windows et Linux : pas de compilation sur le serveur.
    if (!fs.existsSync(path.join(b, 'node_modules', 'bcrypt', 'prebuilds', 'win32-x64'))) console.warn('Attention : binaires bcrypt pour Windows absents.');
  }

  console.log('\n── Archive');
  const zip = new JSZip();
  const ajouter = (abs, rel) => {
    for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
      const a = path.join(abs, e.name); const r = `${rel}/${e.name}`;
      if (e.isDirectory()) { zip.folder(r); ajouter(a, r); } else if (e.isFile()) zip.file(r, fs.readFileSync(a), { unixPermissions: fs.statSync(a).mode });
    }
  };
  ajouter(dossier, nom);
  const contenu = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 }, platform: 'UNIX' });
  const archive = path.join(sortie, `${nom}.zip`);
  fs.writeFileSync(archive, contenu);
  const empreinte = crypto.createHash('sha256').update(contenu).digest('hex');
  fs.writeFileSync(`${archive}.sha256`, `${empreinte}  ${nom}.zip\n`);
  console.log(`\n${archive} (${(contenu.length / 1048576).toFixed(1)} Mo)\nSHA-256 : ${empreinte}`);
  console.log('Vérifier l’empreinte sur le serveur avant d’installer (Windows : certutil -hashfile fichier.zip SHA256 ; Linux : sha256sum).');
})().catch((e) => { console.error(e); process.exit(1); });

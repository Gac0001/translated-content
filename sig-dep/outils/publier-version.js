#!/usr/bin/env node
'use strict';
/**
 * Préparation d’une version du SIG-DEP (CLAUDE.md, « Vérifier avant de publier », point 4).
 *
 *   node sig-dep/outils/publier-version.js 1.48.0
 *
 *  - refuse un numéro qui n’est pas strictement supérieur à la version courante ;
 *  - exige que CHANGELOG.md commence par la section « ## 1.48.0 » (rédigée avant, à partir du diff) ;
 *  - met à jour la version dans backend/ et frontend/ (package.json et package-lock.json) ;
 *  - affiche ce qu’il reste à faire (vérifications, commit, push).
 * Ne commite rien et ne pousse rien.
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const SIG = path.resolve(__dirname, '..');
const cible = process.argv[2];
const arreter = (msg) => { console.error(msg); process.exit(1); };

if (!/^\d+\.\d+\.\d+$/.test(cible || '')) arreter('Usage : node sig-dep/outils/publier-version.js X.Y.Z');
const lire = (p) => JSON.parse(fs.readFileSync(path.join(SIG, p), 'utf8'));
const actuelle = lire('backend/package.json').version;
if (lire('frontend/package.json').version !== actuelle) arreter(`Versions différentes : backend ${actuelle}, frontend ${lire('frontend/package.json').version}. Alignez-les d’abord.`);
const num = (v) => v.split('.').map(Number);
const plusGrande = (a, b) => { const x = num(a); const y = num(b); for (let i = 0; i < 3; i += 1) if (x[i] !== y[i]) return x[i] > y[i]; return false; };
if (!plusGrande(cible, actuelle)) arreter(`La version ${cible} doit être supérieure à la version courante (${actuelle}).`);

const journal = fs.readFileSync(path.join(SIG, 'CHANGELOG.md'), 'utf8');
const premiere = journal.match(/^## (\S+)/m);
if (!premiere || premiere[1] !== cible) {
  arreter(`CHANGELOG.md doit commencer par la section « ## ${cible} » (première section trouvée : ${premiere ? premiere[1] : 'aucune'}).\n`
    + 'Rédigez-la d’abord : lot, puis ce qui change pour les utilisateurs (fonctionnalités, corrections, démonstration, tests).');
}
const section = journal.slice(premiere.index, journal.indexOf('\n## ', premiere.index + 3) === -1 ? undefined : journal.indexOf('\n## ', premiere.index + 3));
if (!/^- /m.test(section)) arreter(`La section « ## ${cible} » de CHANGELOG.md ne contient aucune ligne « - … ».`);

for (const d of ['backend', 'frontend']) {
  const r = spawnSync('npm', ['version', cible, '--no-git-tag-version', '--allow-same-version'], { cwd: path.join(SIG, d), encoding: 'utf8', shell: process.platform === 'win32' });
  if (r.status !== 0) arreter(`npm version a échoué dans ${d} :\n${r.stderr}`);
  const verif = [lire(`${d}/package.json`).version, lire(`${d}/package-lock.json`).version, lire(`${d}/package-lock.json`).packages[''].version];
  if (verif.some((v) => v !== cible)) arreter(`Version incomplète dans ${d} : ${verif.join(', ')}`);
}

console.log(`Version ${actuelle} → ${cible} : backend et frontend (package.json, package-lock.json) mis à jour ; CHANGELOG.md vérifié.`);
console.log('Reste à faire :');
console.log('  1. README.md à jour si une fonctionnalité visible a changé ;');
console.log('  2. sig-dep/outils/verifier.sh (puis --complet pour une version touchant l’interface) ;');
console.log(`  3. git add … && git commit -m "SIG-DEP ${cible} — <lot> : <résumé>" (contrôle avant commit automatique) ;`);
console.log('  4. git push -u origin <branche> (nouvelles tentatives en cas d’erreur réseau).');

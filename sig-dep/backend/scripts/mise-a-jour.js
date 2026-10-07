'use strict';
/**
 * Met à jour une copie de travail de SIG-DEP (Windows, Linux, macOS) avec le travail publié sur GitHub :
 *   1. vérifie qu’aucune modification locale n’est en cours (sinon s’arrête, rien n’est perdu) ;
 *   2. récupère la branche et l’avance (fast-forward uniquement, jamais de réécriture d’historique) ;
 *   3. installe les dépendances (backend et frontend) ;
 *   4. signale les nouvelles variables de backend/.env.example absentes de backend/.env ;
 *   5. applique les migrations de la base ;
 *   6. avec --demo : réinitialise la démonstration (DEMO_MODE=true requis).
 * Usage (depuis sig-dep/backend) : npm run mise-a-jour [-- --branche=nom] [-- --demo] [-- --tests]
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const backend = path.resolve(__dirname, '..');
const frontend = path.resolve(backend, '../frontend');
const args = process.argv.slice(2);
const opt = (n) => args.find((a) => a.startsWith(`--${n}=`))?.split('=')[1];
const flag = (n) => args.includes(`--${n}`);

function run(cmd, cmdArgs, cwd, { capture = false, tolerer = false } = {}) {
  const r = spawnSync(cmd, cmdArgs, { cwd, shell: process.platform === 'win32', encoding: 'utf8', stdio: capture ? 'pipe' : 'inherit' });
  if (r.status !== 0 && !tolerer) {
    if (capture) process.stderr.write(r.stderr || '');
    console.error(`\nÉchec : ${cmd} ${cmdArgs.join(' ')} (dans ${cwd})`);
    process.exit(1);
  }
  return capture ? (r.stdout || '').trim() : r.status;
}
const etape = (n, t) => console.log(`\n── ${n}. ${t}`);

etape(1, 'Vérification de la copie locale');
const racine = run('git', ['rev-parse', '--show-toplevel'], backend, { capture: true });
const modifs = run('git', ['status', '--porcelain'], racine, { capture: true });
if (modifs) {
  console.error('Des modifications locales ne sont pas enregistrées :\n' + modifs + '\nEnregistrez-les (git commit) ou mettez-les de côté (git stash), puis relancez. Rien n’a été modifié.');
  process.exit(1);
}
const branche = opt('branche') || run('git', ['rev-parse', '--abbrev-ref', 'HEAD'], racine, { capture: true });
console.log(`Dépôt : ${racine}\nBranche : ${branche}`);

etape(2, 'Récupération du travail publié');
run('git', ['fetch', 'origin', branche], racine);
if (run('git', ['rev-parse', '--abbrev-ref', 'HEAD'], racine, { capture: true }) !== branche) run('git', ['checkout', branche], racine);
if (run('git', ['merge', '--ff-only', `origin/${branche}`], racine, { tolerer: true }) !== 0) {
  console.error(`La branche locale a divergé de origin/${branche} (commits locaux non publiés). Publiez-les (git push) ou fusionnez (git merge origin/${branche}), puis relancez.`);
  process.exit(1);
}
console.log(run('git', ['log', '-1', '--format=%h %s'], racine, { capture: true }));

etape(3, 'Dépendances');
run('npm', ['ci', '--no-audit', '--no-fund'], backend);
run('npm', ['ci', '--no-audit', '--no-fund'], frontend);

etape(4, 'Configuration (backend/.env)');
const cles = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split(/\r?\n/).map((l) => l.match(/^\s*#?\s*([A-Z][A-Z0-9_]+)=/)?.[1]).filter(Boolean) : []);
if (!fs.existsSync(path.join(backend, '.env'))) {
  console.error('backend/.env est absent : copiez backend/.env.example en backend/.env puis adaptez-le (base de données, secrets).');
  process.exit(1);
}
const presentes = new Set(cles(path.join(backend, '.env')));
const nouvelles = [...new Set(cles(path.join(backend, '.env.example')))].filter((k) => !presentes.has(k));
console.log(nouvelles.length ? `Variables documentées dans .env.example et absentes de votre .env (facultatives sauf mention) : ${nouvelles.join(', ')}` : 'Aucune nouvelle variable.');

etape(5, 'Migrations de la base');
run('npm', ['run', 'migrate'], backend);

if (flag('demo')) {
  etape(6, 'Réinitialisation de la démonstration');
  run('npm', ['run', 'demo:reset'], backend);
}
if (flag('tests')) {
  etape(flag('demo') ? 7 : 6, 'Tests automatisés');
  run('npm', ['test'], backend);
}
const version = JSON.parse(fs.readFileSync(path.join(backend, 'package.json'), 'utf8')).version;
console.log(`\nSIG-DEP ${version} à jour. Démarrage : « npm run dev » dans backend puis dans frontend (deux terminaux).`);

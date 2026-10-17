#!/usr/bin/env node
'use strict';
/**
 * Installation et mise à jour de SIG-DEP sur un serveur (Linux ou Windows), à lancer depuis le paquet
 * décompressé (sig-dep-x.y.z) :
 *
 *   node backend/scripts/installer-serveur.js [--racine=DOSSIER]   installation ou mise à jour
 *   node backend/scripts/installer-serveur.js --service             + déclaration du service (root / administrateur)
 *   node backend/scripts/installer-serveur.js --revenir             retour à la version précédente
 *
 * Dossier d’installation (--racine ; par défaut /opt/sig-dep ou C:\SIG-DEP) :
 *   config/.env            configuration du serveur, commune à toutes les versions (secrets générés ici)
 *   donnees/pieces         pièces jointes ; donnees/sauvegardes : sauvegardes
 *   versions/x.y.z/        une version installée (jamais modifiée ensuite)
 *   courante               lien vers la version en service (le service démarre depuis courante/backend)
 *   journaux/              journal du service ; service/ : service Windows (WinSW)
 *
 * Mise à jour : la nouvelle version est copiée à côté de l’ancienne ; sauvegarde de la base ; migrations
 * (annulées si l’une échoue : la base et la version en service restent inchangées) ; bascule du lien ;
 * redémarrage du service ; contrôle de préparation.
 */
const { spawnSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const WINDOWS = process.platform === 'win32';
const args = process.argv.slice(2);
const opt = (n) => args.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');
const flag = (n) => args.includes(`--${n}`);

const paquet = path.resolve(__dirname, '../..');
const racine = path.resolve(opt('racine') || (WINDOWS ? 'C:\\SIG-DEP' : '/opt/sig-dep'));
const D = {
  config: path.join(racine, 'config'), env: path.join(racine, 'config', '.env'), journal: path.join(racine, 'config', 'installations.json'),
  pieces: path.join(racine, 'donnees', 'pieces'), sauvegardes: path.join(racine, 'donnees', 'sauvegardes'),
  versions: path.join(racine, 'versions'), courante: path.join(racine, 'courante'), journaux: path.join(racine, 'journaux'), service: path.join(racine, 'service'),
};
const slash = (p) => p.replace(/\\/g, '/');

const etape = (t) => console.log(`\n── ${t}`);
const stop = (m, code = 1) => { console.error(`\n${m}`); process.exit(code); };
const lireJournal = () => (fs.existsSync(D.journal) ? JSON.parse(fs.readFileSync(D.journal, 'utf8')) : []);
const ecrireJournal = (j) => fs.writeFileSync(D.journal, `${JSON.stringify(j, null, 2)}\n`);
const versionCourante = () => { try { return path.basename(fs.realpathSync(D.courante)); } catch { return null; } };

/** Opération sur la base exécutée avec le code d’une version donnée (voir operations-serveur.js). */
function operation(dossierVersion, ...cmd) {
  const r = spawnSync(process.execPath, [path.join(dossierVersion, 'backend', 'scripts', 'operations-serveur.js'), ...cmd], {
    cwd: path.join(dossierVersion, 'backend'), env: { ...process.env, SIGDEP_ENV_FILE: D.env }, encoding: 'utf8',
  });
  const ligne = (r.stdout || '').trim().split('\n').pop();
  try { return JSON.parse(ligne); } catch { return { ok: false, erreur: (r.stderr || r.stdout || 'réponse illisible').trim().slice(0, 600) }; }
}

/** Fait pointer « courante » vers une version (lien symbolique sous Linux, jonction sous Windows). */
function basculer(dossierVersion) {
  if (WINDOWS) {
    // Suppression du lien seul (jamais du contenu de la version vers laquelle il pointe)
    if (fs.lstatSync(D.courante, { throwIfNoEntry: false })) { try { fs.unlinkSync(D.courante); } catch { fs.rmdirSync(D.courante); } }
    fs.symlinkSync(dossierVersion, D.courante, 'junction');
  } else {
    const tmp = `${D.courante}.${process.pid}`;
    fs.symlinkSync(dossierVersion, tmp);
    fs.renameSync(tmp, D.courante); // remplacement atomique du lien
  }
}

function redemarrer() {
  if (WINDOWS) {
    const exe = path.join(D.service, 'SIG-DEP.exe');
    const r = fs.existsSync(exe) ? spawnSync(exe, ['restart'], { stdio: 'inherit' }) : spawnSync('sc.exe', ['query', 'SIG-DEP'], { encoding: 'utf8' });
    if (fs.existsSync(exe) && r.status === 0) return console.log('Service SIG-DEP redémarré.');
  } else if (spawnSync('systemctl', ['is-enabled', 'sig-dep'], { encoding: 'utf8' }).status === 0) {
    if (spawnSync('systemctl', ['restart', 'sig-dep'], { stdio: 'inherit' }).status === 0) return console.log('Service sig-dep redémarré.');
  }
  console.log('Redémarrez le service SIG-DEP (ou lancez-le s’il n’est pas encore déclaré : voir --service).');
}

function verifier(dossierVersion) {
  etape('Contrôle de préparation');
  spawnSync(process.execPath, [path.join(dossierVersion, 'backend', 'scripts', 'verifier-production.js')], {
    cwd: path.join(dossierVersion, 'backend'), env: { ...process.env, SIGDEP_ENV_FILE: D.env }, stdio: 'inherit',
  });
}

function premiereConfiguration() {
  etape('Première installation : configuration du serveur');
  const modele = fs.readFileSync(path.join(paquet, 'deploy', 'env.production'), 'utf8');
  const cleSauvegardes = crypto.randomBytes(32).toString('base64url');
  const contenu = modele.replace(/\{\{RACINE\}\}/g, slash(racine))
    .replace('{{JWT_ACCESS_SECRET}}', crypto.randomBytes(48).toString('hex'))
    .replace('{{BACKUP_ENC_KEY}}', cleSauvegardes);
  fs.writeFileSync(D.env, contenu, { mode: 0o600 });
  console.log(`Configuration créée : ${D.env}`);
  console.log('\n  CLÉ DE CHIFFREMENT DES SAUVEGARDES — à recopier sur papier et à conserver sous scellé :');
  console.log(`  ${cleSauvegardes}\n  Sans elle, aucune sauvegarde ne peut être restaurée.`);
  console.log(`\nComplétez maintenant dans ce fichier : DATABASE_URL (mot de passe de la base), APP_URL et CORS_ORIGINS
(adresse du serveur sur le réseau), puis relancez la même commande pour terminer l’installation.`);
}

function declarerService() {
  etape('Déclaration du service');
  if (WINDOWS) {
    fs.mkdirSync(D.service, { recursive: true });
    let xml = fs.readFileSync(path.join(paquet, 'deploy', 'windows', 'SIG-DEP.xml'), 'utf8').replace(/\{\{RACINE\}\}/g, racine).replace(/\{\{NODE\}\}/g, process.execPath);
    // Dépendance au service PostgreSQL réellement installé (nom variable selon la version)
    const pg = (spawnSync('sc.exe', ['query', 'state=', 'all'], { encoding: 'utf8' }).stdout || '').match(/SERVICE_NAME:\s*(postgresql[^\r\n]*)/i)?.[1]?.trim();
    xml = pg ? xml.replace(/<depend>[^<]*<\/depend>/, `<depend>${pg}</depend>`) : xml.replace(/\s*<depend>[^<]*<\/depend>/, '');
    fs.writeFileSync(path.join(D.service, 'SIG-DEP.xml'), xml);
    const exe = path.join(D.service, 'SIG-DEP.exe');
    if (!fs.existsSync(exe)) {
      console.log(`Fichier de service écrit : ${path.join(D.service, 'SIG-DEP.xml')}
Téléchargez WinSW-x64.exe (https://github.com/winsw/winsw/releases, version 2.12.0), enregistrez-le sous
${exe}, puis relancez avec --service dans une invite de commandes en administrateur.`);
      return;
    }
    spawnSync(exe, ['install'], { stdio: 'inherit' });
    spawnSync(exe, ['start'], { stdio: 'inherit' });
    return;
  }
  if (process.getuid && process.getuid() !== 0) { console.log('Déclaration du service ignorée : relancez avec sudo pour installer le service systemd.'); return; }
  if (spawnSync('id', ['sigdep']).status !== 0) {
    spawnSync('useradd', ['--system', '--home-dir', racine, '--no-create-home', '--shell', '/usr/sbin/nologin', 'sigdep'], { stdio: 'inherit' });
  }
  for (const d of [path.join(racine, 'donnees'), D.journaux]) spawnSync('chown', ['-R', 'sigdep:sigdep', d]);
  spawnSync('chown', ['root:sigdep', D.env]); fs.chmodSync(D.env, 0o640);
  const unite = fs.readFileSync(path.join(paquet, 'deploy', 'linux', 'sig-dep.service'), 'utf8').replace(/\{\{RACINE\}\}/g, racine).replace(/\{\{NODE\}\}/g, process.execPath);
  fs.writeFileSync('/etc/systemd/system/sig-dep.service', unite);
  spawnSync('systemctl', ['daemon-reload'], { stdio: 'inherit' });
  spawnSync('systemctl', ['enable', '--now', 'sig-dep'], { stdio: 'inherit' });
  console.log('Service sig-dep déclaré et démarré (journal : journaux/sig-dep.log).');
}

function revenir() {
  const journal = lireJournal();
  const derniere = journal.filter((e) => e.type === 'installation').pop();
  const actuelle = versionCourante();
  if (!derniere || derniere.version !== actuelle || !derniere.precedente) stop('Aucune version précédente enregistrée pour la version en service : retour impossible.');
  const precedente = path.join(D.versions, derniere.precedente);
  if (!fs.existsSync(precedente)) stop(`Le dossier de la version ${derniere.precedente} n’existe plus.`);
  etape(`Retour de la version ${actuelle} à la version ${derniere.precedente}`);
  if (derniere.lot) {
    // Les migrations ajoutées par la version annulée sont défaites avec son propre code.
    const r = operation(path.join(D.versions, actuelle), 'annuler-lot', String(derniere.lot));
    if (!r.ok) stop(`Annulation des migrations impossible : ${r.erreur}\nRestaurez la sauvegarde prise avant la mise à jour (${derniere.sauvegarde || 'voir donnees/sauvegardes'}) : docs/MISE-EN-SERVICE.md, « Incidents ».`);
    console.log(`Migrations annulées : ${r.annulees.length}.`);
  }
  basculer(precedente);
  journal.push({ type: 'retour', date: new Date().toISOString(), de: actuelle, vers: derniere.precedente });
  ecrireJournal(journal);
  redemarrer();
  verifier(precedente);
}

function installer() {
  const infos = JSON.parse(fs.readFileSync(path.join(paquet, 'paquet.json'), 'utf8'));
  console.log(`SIG-DEP ${infos.version} (révision ${infos.commit || '—'}) → ${racine} (${os.type()})`);
  const [majeur] = process.versions.node.split('.').map(Number);
  if (majeur < 22) stop(`Node.js 22 ou plus récent est requis (version actuelle : ${process.versions.node}).`);
  for (const d of [D.config, D.pieces, D.sauvegardes, D.versions, D.journaux]) fs.mkdirSync(d, { recursive: true });

  if (!fs.existsSync(D.env)) { premiereConfiguration(); return; }
  const env = fs.readFileSync(D.env, 'utf8');
  if (/MOT-DE-PASSE-A-RENSEIGNER|ADRESSE-DU-SERVEUR/.test(env)) stop(`Configuration incomplète : remplacez MOT-DE-PASSE-A-RENSEIGNER et ADRESSE-DU-SERVEUR dans ${D.env}, puis relancez.`);

  const precedente = versionCourante();
  const dest = path.join(D.versions, infos.version);
  if (precedente === infos.version && !flag('forcer')) {
    console.log(`La version ${infos.version} est déjà en service.`);
    if (flag('service')) declarerService();
    return;
  }

  etape(`Copie de la version ${infos.version}`);
  if (fs.existsSync(dest)) {
    if (!flag('forcer')) stop(`${dest} existe déjà (version annulée par --revenir, ou installation interrompue). Relancez avec --forcer pour la réinstaller.`);
    fs.rmSync(dest, { recursive: true, force: true });
  }
  fs.mkdirSync(dest, { recursive: true });
  for (const e of ['backend', 'frontend', 'deploy', 'docs', 'CHANGELOG.md', 'paquet.json']) {
    if (fs.existsSync(path.join(paquet, e))) fs.cpSync(path.join(paquet, e), path.join(dest, e), { recursive: true });
  }
  fs.copyFileSync(path.join(paquet, 'paquet.json'), path.join(dest, 'backend', 'paquet.json'));
  if (!fs.existsSync(path.join(dest, 'backend', 'node_modules'))) {
    etape('Dépendances (accès Internet requis)');
    const r = spawnSync('npm', ['ci', '--omit=dev', '--no-audit', '--no-fund'], { cwd: path.join(dest, 'backend'), stdio: 'inherit', shell: WINDOWS });
    if (r.status !== 0) { fs.rmSync(dest, { recursive: true, force: true }); stop('Installation des dépendances impossible. Utilisez un paquet construit avec ses dépendances (npm run paquet).'); }
  }

  // Après la copie, tout échec retire la version copiée : la commande peut être relancée telle quelle.
  const echec = (m) => { fs.rmSync(dest, { recursive: true, force: true }); stop(m); };

  etape('Base de données');
  const etat = operation(dest, 'etat');
  if (!etat.ok) echec(`Base injoignable : ${etat.erreur}\nVérifiez DATABASE_URL dans ${D.env} et que PostgreSQL est démarré. La version en service n’a pas changé.`);
  console.log(etat.neuve ? 'Base neuve.' : `${etat.appliquees} migration(s) appliquée(s), ${etat.enAttente} à appliquer.`);
  let sauvegarde = null;
  if (!etat.neuve && etat.enAttente > 0) {
    const s = operation(dest, 'sauvegarder', '-avant-mise-a-jour');
    if (!s.ok && !flag('sans-sauvegarde')) echec(`Sauvegarde préalable impossible : ${s.erreur}\nCorrigez (outils PostgreSQL, PG_DUMP_PATH) ou relancez avec --sans-sauvegarde si une sauvegarde récente existe. Rien n’a été modifié.`);
    if (s.ok) { sauvegarde = s.fichier; console.log(`Sauvegarde préalable : ${s.fichier}${s.chiffre ? ' (chiffrée)' : ''}.`); }
  }
  const m = operation(dest, 'migrer');
  if (!m.ok) echec(`Échec des migrations : ${m.erreur}\nAnnulation : ${m.annulation}. La version en service (${precedente || 'aucune'}) n’a pas changé.${sauvegarde ? `\nSauvegarde prise avant la tentative : ${sauvegarde}.` : ''}`);
  console.log(m.appliquees.length ? `${m.appliquees.length} migration(s) appliquée(s).` : 'Structure déjà à jour.');
  if (etat.neuve) {
    const a = operation(dest, 'amorcer');
    if (!a.ok) echec(`Initialisation de la base impossible : ${a.erreur}`);
    console.log('Données de référence chargées (organigramme, rôles, compte Admin « admin » / « dep@2026 » à changer à la première connexion).');
  }

  etape('Mise en service de la version');
  basculer(dest);
  const journal = lireJournal();
  journal.push({ type: 'installation', date: new Date().toISOString(), version: infos.version, commit: infos.commit, precedente, lot: m.lot, sauvegarde });
  ecrireJournal(journal);
  console.log(`courante → versions/${infos.version}${precedente ? ` (précédente : ${precedente}, retour possible avec --revenir)` : ''}`);

  // On garde les trois dernières versions (dont la courante et la précédente).
  const gardees = new Set([infos.version, precedente, ...journal.filter((e) => e.type === 'installation').slice(-3).map((e) => e.version)]);
  for (const v of fs.readdirSync(D.versions)) if (!gardees.has(v)) fs.rmSync(path.join(D.versions, v), { recursive: true, force: true });

  if (flag('service')) declarerService(); else redemarrer();
  verifier(dest);
}

if (flag('revenir')) revenir(); else installer();

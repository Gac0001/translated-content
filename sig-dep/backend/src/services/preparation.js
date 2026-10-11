'use strict';
/**
 * Contrôle de préparation à la mise en production : configuration, base, fichiers, sauvegardes.
 * Utilisé par « npm run verifier-production » (sur le serveur, avant l’ouverture et après chaque mise à
 * jour) et, en lecture seule, par la page Santé de l’Admin. Aucun secret n’est renvoyé, seulement des constats.
 *
 * Statuts : OK, ATTENTION (à corriger dès que possible, n’empêche pas l’ouverture), BLOQUANT (à corriger
 * avant l’ouverture), INFO (constat).
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const config = require('../config/env');
const db = require('../db/knex');
const { donneesDemo } = require('./reinitialisation');
const { politique } = require('./politique');
const { etatSauvegardes, executer } = require('./sauvegarde');
const { espaceDisque } = require('./sante');

const MOT_DE_PASSE_ADMIN_INITIAL = 'dep@2026';
const GROUPES = { configuration: 'Configuration', securite: 'Sécurité des accès', base: 'Base de données', fichiers: 'Fichiers et interface', sauvegardes: 'Sauvegardes', messagerie: 'Messagerie' };

// Fichier de configuration réellement lu (serveur installé : config/.env ; poste de développement : backend/.env)
const fichierConfig = () => process.env.SIGDEP_ENV_FILE || 'backend/.env';
const estLocal = (url) => /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(url);
const origine = (url) => { try { return new URL(url).origin; } catch { return null; } };

function ecritureLibre(dossier) {
  fs.mkdirSync(dossier, { recursive: true });
  const f = path.join(dossier, `.preparation-${crypto.randomUUID()}`);
  fs.writeFileSync(f, 'ok'); fs.unlinkSync(f);
}

async function controles() {
  const r = [];
  const ajouter = (groupe, cle, libelle, statut, detail, conseil) => r.push({ groupe, cle, libelle, statut, detail, ...(conseil && statut !== 'OK' ? { conseil } : {}) });
  const appUrl = config.mail.appUrl;
  const https = appUrl.startsWith('https:');

  // ─── Configuration ─────────────────────────────────────────────────────────
  ajouter('configuration', 'environnement', 'Environnement de production', config.isProd ? 'OK' : 'BLOQUANT',
    `NODE_ENV=${config.env}.`, `Mettre NODE_ENV=production dans ${fichierConfig()}.`);
  ajouter('configuration', 'demonstration', 'Mode démonstration désactivé', config.demo ? 'BLOQUANT' : 'OK',
    config.demo ? 'DEMO_MODE=true : comptes et code de double authentification affichés à la connexion.' : 'DEMO_MODE absent ou false.',
    `Retirer DEMO_MODE de ${fichierConfig()}.`);
  ajouter('configuration', 'adresse', 'Adresse de l’application', estLocal(appUrl) ? 'BLOQUANT' : 'OK',
    `APP_URL=${appUrl}.`, 'Indiquer l’adresse par laquelle les agents ouvrent l’application (nom ou adresse IP du serveur sur le réseau), par exemple http://192.168.1.10:4000 ou https://sig-dep.dep.local.');
  ajouter('configuration', 'adresse_cartes', 'Adresse des QR codes des cartes de service', estLocal(config.publicUrl) ? 'BLOQUANT' : process.env.PUBLIC_URL ? 'OK' : 'ATTENTION',
    `PUBLIC_URL=${config.publicUrl}${process.env.PUBLIC_URL ? '' : ' (reprise de APP_URL)'} ; elle est imprimée dans le QR code et ne change plus après l’impression des premières cartes.`,
    'Fixer PUBLIC_URL sur l’adresse définitive de la page de vérification avant d’imprimer les cartes.');
  const memeOrigine = config.frontendDir || config.corsOrigins.includes(origine(appUrl));
  ajouter('configuration', 'cors', 'Origine de l’interface autorisée', memeOrigine ? 'OK' : 'BLOQUANT',
    config.frontendDir ? 'Interface servie par l’API (même adresse).' : `CORS_ORIGINS=${config.corsOrigins.join(', ')}.`,
    `Ajouter ${origine(appUrl)} à CORS_ORIGINS, ou servir l’interface par l’API (FRONTEND_DIR).`);

  // ─── Sécurité des accès ───────────────────────────────────────────────────
  const secret = config.jwt.accessSecret || '';
  ajouter('securite', 'secret_jwt', 'Secret des jetons de session', /remplacer-par|secret-de-test/.test(secret) || secret.length < 32 ? 'BLOQUANT' : 'OK',
    `${secret.length} caractères.`, 'Générer un secret : node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))", puis le placer dans JWT_ACCESS_SECRET.');
  ajouter('securite', 'https', 'Connexion chiffrée (HTTPS)', https || config.tls ? 'OK' : 'ATTENTION',
    https || config.tls ? (config.tls ? 'Certificat servi par l’API.' : 'Assuré par le proxy inverse.') : 'Réseau local sans HTTPS : mots de passe et données circulent en clair sur le réseau.',
    'Installer un certificat (TLS_CERT_FILE et TLS_KEY_FILE, ou proxy inverse) dès que possible ; voir docs/MISE-EN-SERVICE.md.');
  const cookieOk = https ? config.cookieSecure : !config.cookieSecure;
  ajouter('securite', 'cookie', 'Cookie de session', cookieOk ? 'OK' : 'BLOQUANT',
    `COOKIE_SECURE=${config.cookieSecure} pour une adresse en ${https ? 'HTTPS' : 'HTTP'}.`,
    https ? 'Mettre COOKIE_SECURE=true.' : 'Mettre COOKIE_SECURE=false tant que l’adresse est en HTTP (sinon la session ne se renouvelle pas).');
  const direct = !!config.frontendDir || !!config.tls;
  ajouter('securite', 'proxy', 'Adresses IP enregistrées dans l’audit', direct && config.trustProxy > 0 ? 'ATTENTION' : 'OK',
    `TRUST_PROXY=${config.trustProxy}${direct ? ' ; l’API semble exposée directement' : ''}.`,
    'Mettre TRUST_PROXY=0 quand aucun proxy inverse n’est placé devant l’API : sinon un poste peut falsifier son adresse.');

  // ─── Base de données ───────────────────────────────────────────────────────
  let baseOk = true;
  try {
    await db.raw('select 1');
    ajouter('base', 'connexion', 'Connexion à PostgreSQL', 'OK', 'Base joignable.');
  } catch (e) {
    baseOk = false;
    ajouter('base', 'connexion', 'Connexion à PostgreSQL', 'BLOQUANT', `Base injoignable : ${e.message}`, 'Vérifier DATABASE_URL et que le service PostgreSQL est démarré.');
  }
  if (baseOk) {
    const [, attente] = await db.migrate.list();
    ajouter('base', 'migrations', 'Structure de la base à jour', attente.length ? 'BLOQUANT' : 'OK',
      attente.length ? `${attente.length} migration(s) à appliquer.` : 'Toutes les migrations sont appliquées.', 'Exécuter npm run migrate (backend).');
    const demo = await donneesDemo();
    ajouter('base', 'donnees_fictives', 'Données fictives retirées', demo ? 'BLOQUANT' : 'OK',
      demo ? 'La base contient les données de démonstration.' : 'Aucune donnée de démonstration.',
      'Admin → Système → Réinitialisation de la base, mode « base vierge » (voir docs/MISE-EN-SERVICE.md).');
    const admins = await db('users as u').join('user_roles as ur', 'ur.user_id', 'u.id').join('roles as r', 'r.id', 'ur.role_id')
      .where('r.code', 'ADMIN_SYSTEME').where('u.statut', 'ACTIF').whereNot('u.compte_urgence', true).select('u.username', 'u.password_hash', 'u.must_change_password');
    let initial = false;
    for (const a of admins) if (a.password_hash && await bcrypt.compare(MOT_DE_PASSE_ADMIN_INITIAL, a.password_hash)) initial = true;
    ajouter('securite', 'admin', 'Mot de passe initial de l’Admin changé', initial ? 'BLOQUANT' : admins.some((a) => a.must_change_password) ? 'ATTENTION' : 'OK',
      initial ? 'Un compte Admin a encore le mot de passe initial publié dans la documentation.' : admins.length ? `${admins.length} compte(s) Admin actif(s).` : 'Aucun compte Admin actif.',
      initial ? 'Se connecter en Admin : le changement est demandé à la première connexion.' : 'Terminer la première connexion de l’Admin (mot de passe, double authentification).');
  }

  // ─── Fichiers et interface ─────────────────────────────────────────────────
  for (const [cle, libelle, dossier] of [['pieces', 'Dossier des pièces jointes', config.uploadDir], ['sauvegardes_dossier', 'Dossier des sauvegardes', config.backupDir]]) {
    try {
      ecritureLibre(dossier);
      ajouter('fichiers', cle, libelle, 'OK', `${dossier} accessible en écriture.`);
    } catch (e) {
      ajouter('fichiers', cle, libelle, 'BLOQUANT', `${dossier} : ${e.message}`, 'Créer le dossier et donner les droits d’écriture au compte du service.');
    }
  }
  try {
    const d = await espaceDisque();
    ajouter('fichiers', 'disque', 'Espace disque', d.pourcentLibre < 10 ? 'BLOQUANT' : d.pourcentLibre < 20 ? 'ATTENTION' : 'OK',
      `${Math.round(d.libre / 1073741824)} Go libres (${d.pourcentLibre} %).`, 'Libérer de l’espace ou agrandir le disque.');
  } catch { /* statfs indisponible : pas de constat */ }
  if (config.frontendDir) {
    const ok = fs.existsSync(path.join(config.frontendDir, 'index.html'));
    ajouter('fichiers', 'interface', 'Interface construite', ok ? 'OK' : 'BLOQUANT', `FRONTEND_DIR=${config.frontendDir}.`, 'Utiliser le paquet d’installation, qui contient l’interface construite.');
  } else {
    ajouter('fichiers', 'interface', 'Interface construite', 'INFO', 'Interface servie séparément (proxy inverse ou serveur web).');
  }
  if (config.tls) {
    const ok = fs.existsSync(config.tls.cert) && fs.existsSync(config.tls.key);
    ajouter('fichiers', 'certificat', 'Certificat HTTPS', ok ? 'OK' : 'BLOQUANT', ok ? 'Certificat et clé présents.' : 'Fichier de certificat ou de clé introuvable.', 'Vérifier TLS_CERT_FILE et TLS_KEY_FILE.');
  }

  // ─── Sauvegardes ───────────────────────────────────────────────────────────
  try {
    await executer(config.pgDumpPath, ['--version'], process.env, 'pg_dump');
    ajouter('sauvegardes', 'pg_dump', 'Outil de sauvegarde PostgreSQL', 'OK', 'pg_dump disponible.');
  } catch (e) {
    ajouter('sauvegardes', 'pg_dump', 'Outil de sauvegarde PostgreSQL', 'BLOQUANT', e.message, 'Installer les outils clients PostgreSQL ou renseigner PG_DUMP_PATH.');
  }
  ajouter('sauvegardes', 'chiffrement', 'Sauvegardes chiffrées', config.backupEncKey ? 'OK' : 'ATTENTION',
    config.backupEncKey ? 'BACKUP_ENC_KEY renseignée (à conserver hors ligne).' : 'Sauvegardes non chiffrées.', 'Renseigner BACKUP_ENC_KEY et en conserver une copie papier sous scellé.');
  if (config.backupCopyDir) {
    try { ecritureLibre(config.backupCopyDir); ajouter('sauvegardes', 'copie', 'Copie hors du serveur', 'OK', `${config.backupCopyDir} accessible.`); } catch (e) {
      ajouter('sauvegardes', 'copie', 'Copie hors du serveur', 'ATTENTION', `${config.backupCopyDir} : ${e.message}`, 'Brancher le disque externe ou monter le partage réseau.');
    }
  } else {
    ajouter('sauvegardes', 'copie', 'Copie hors du serveur', 'ATTENTION', 'Les sauvegardes restent sur le même disque que la base.', 'Renseigner BACKUP_COPY_DIR (disque externe ou partage réseau).');
  }
  if (baseOk) {
    const p = await politique();
    ajouter('sauvegardes', 'planification', 'Sauvegarde automatique', p.sauvegarde_auto ? 'OK' : 'ATTENTION',
      p.sauvegarde_auto ? `Chaque jour à ${p.sauvegarde_heure}, test de restauration ${p.test_restauration_auto ? 'hebdomadaire' : 'désactivé'}.` : 'Désactivée.',
      'Admin → Sauvegardes → planification.');
    const s = await etatSauvegardes();
    ajouter('sauvegardes', 'premiere', 'Sauvegarde réussie', s.derniereReussie ? 'OK' : 'ATTENTION',
      s.derniereReussie ? `Dernière le ${new Date(s.derniereReussie.date).toLocaleString('fr-FR', { timeZone: 'Africa/Kinshasa' })}.` : 'Aucune sauvegarde réussie.',
      'Admin → Sauvegardes → « Sauvegarder maintenant ».');
    ajouter('sauvegardes', 'restauration', 'Test de restauration réussi', s.dernierTest?.statut === 'OK' ? 'OK' : 'ATTENTION',
      s.dernierTest ? `Dernier test : ${s.dernierTest.statut === 'OK' ? 'réussi' : 'échoué'}.` : 'Aucun test de restauration.',
      'Admin → Sauvegardes → « Tester la restauration » sur la dernière sauvegarde.');
  }

  // ─── Messagerie ────────────────────────────────────────────────────────────
  ajouter('messagerie', 'courriels', 'Envoi des e-mails', config.mail.enabled ? 'OK' : 'ATTENTION',
    config.mail.enabled ? `Serveur ${config.mail.host}:${config.mail.port} (contrôlé sur la page Santé).` : 'Messagerie désactivée : notifications dans l’application seulement, réinitialisation des mots de passe par l’Admin.',
    'Renseigner le serveur SMTP du Ministère (SMTP_*) puis MAIL_ENABLED=true quand il sera disponible.');
  return r;
}

/** Rapport complet : contrôles, totaux par statut, verdict. */
async function verifier() {
  const liste = await controles();
  const totaux = { OK: 0, ATTENTION: 0, BLOQUANT: 0, INFO: 0 };
  for (const c of liste) totaux[c.statut] += 1;
  return { date: new Date().toISOString(), version: require('../../package.json').version, pret: totaux.BLOQUANT === 0, totaux, groupes: GROUPES, controles: liste };
}

module.exports = { verifier, MOT_DE_PASSE_ADMIN_INITIAL };

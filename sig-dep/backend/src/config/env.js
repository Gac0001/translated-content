'use strict';
const path = require('path');
// Serveur installé par le paquet : configuration commune à toutes les versions (SIGDEP_ENV_FILE,
// ex. /opt/sig-dep/config/.env) ; poste de développement : backend/.env.
require('dotenv').config({ path: process.env.SIGDEP_ENV_FILE || path.resolve(__dirname, '../../.env'), quiet: true });

const env = process.env.NODE_ENV || 'development';
const root = path.resolve(__dirname, '../..');

function required(name, fallback) {
  const v = process.env[name] ?? fallback;
  if (v === undefined || v === '') throw new Error(`Variable d’environnement manquante : ${name}`);
  return v;
}

const config = {
  env,
  isProd: env === 'production',
  isTest: env === 'test',
  port: Number(process.env.PORT || 4000),
  databaseUrl: env === 'test'
    ? required('DATABASE_URL_TEST', 'postgres://sigdep:sigdep@localhost:5432/sig_dep_test')
    : required('DATABASE_URL'),
  jwt: {
    accessSecret: required('JWT_ACCESS_SECRET', env === 'test' ? 'secret-de-test-uniquement' : undefined),
    accessTtl: process.env.ACCESS_TOKEN_TTL || '15m',
    refreshTtlDays: Number(process.env.REFRESH_TOKEN_TTL_DAYS || 7),
  },
  // Proxy inverse devant l’API (Nginx, IIS) : nombre de proxys de confiance pour l’adresse IP réelle (audit,
  // limitation des tentatives). 0 quand l’API est exposée directement (service unique) : sinon un client
  // pourrait falsifier son adresse par l’en-tête X-Forwarded-For.
  trustProxy: process.env.TRUST_PROXY !== undefined && process.env.TRUST_PROXY !== '' ? Number(process.env.TRUST_PROXY) : (env === 'production' ? 1 : 0),
  // Service unique : l’API sert aussi l’interface construite (dossier dist), sur le même port.
  frontendDir: process.env.FRONTEND_DIR ? path.resolve(root, process.env.FRONTEND_DIR) : null,
  // HTTPS assuré par l’API elle-même (certificat interne), sans proxy inverse.
  tls: process.env.TLS_CERT_FILE && process.env.TLS_KEY_FILE ? {
    cert: path.resolve(root, process.env.TLS_CERT_FILE),
    key: path.resolve(root, process.env.TLS_KEY_FILE),
    // Port HTTP redirigé vers HTTPS (facultatif, ex. 80)
    redirectPort: process.env.HTTP_REDIRECT_PORT ? Number(process.env.HTTP_REDIRECT_PORT) : null,
  } : null,
  corsOrigins: (process.env.CORS_ORIGINS || 'http://localhost:5173').split(',').map((s) => s.trim()).filter(Boolean),
  cookieSecure: process.env.COOKIE_SECURE === 'true',
  security: {
    maxFailedLogins: Number(process.env.MAX_FAILED_LOGINS || 5),
    lockMinutes: Number(process.env.LOCK_DURATION_MINUTES || 15),
    loginWindowMinutes: Number(process.env.LOGIN_RATE_LIMIT_WINDOW_MINUTES || 15),
    loginMax: Number(process.env.LOGIN_RATE_LIMIT_MAX || 20),
  },
  uploadDir: path.resolve(root, process.env.UPLOAD_DIR || './storage/uploads'),
  backupDir: path.resolve(root, process.env.BACKUP_DIR || './storage/backups'),
  maxUploadBytes: Number(process.env.MAX_UPLOAD_MB || 15) * 1024 * 1024,
  presenceAutolockHours: Number(process.env.PRESENCE_AUTOLOCK_HOURS || 24),
  seedDemo: process.env.SEED_DEMO !== 'false',
  // Mode démonstration (présentation, formation) : bandeau, comptes affichés à la connexion,
  // double authentification par code connu. Interdit en production.
  demo: process.env.DEMO_MODE === 'true',
  pgDumpPath: process.env.PG_DUMP_PATH || 'pg_dump',
  pgRestorePath: process.env.PG_RESTORE_PATH || 'pg_restore',
  // Copie de chaque sauvegarde hors du serveur (disque externe, partage réseau) — vide : aucune copie
  backupCopyDir: process.env.BACKUP_COPY_DIR ? path.resolve(process.env.BACKUP_COPY_DIR) : null,
  // Clé de chiffrement des sauvegardes (AES-256-GCM). À conserver hors ligne : sans elle, les sauvegardes sont illisibles.
  backupEncKey: process.env.BACKUP_ENC_KEY || null,
  // Adresse publique de la page de vérification des cartes de service (contenu du QR code).
  publicUrl: (process.env.PUBLIC_URL || process.env.APP_URL || 'http://localhost:5173').replace(/\/+$/, ''),
  mail: {
    enabled: process.env.MAIL_ENABLED === 'true',
    // smtp (production) | json (tests : aucun envoi réseau) | log (affichage console)
    transport: process.env.MAIL_TRANSPORT || 'smtp',
    host: process.env.SMTP_HOST || 'localhost',
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true',
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    rejectUnauthorized: process.env.SMTP_TLS_REJECT_UNAUTHORIZED !== 'false',
    from: process.env.MAIL_FROM || 'SIG-DEP — Direction d’Études et Planification <no-reply@localhost>',
    appUrl: (process.env.APP_URL || 'http://localhost:5173').replace(/\/+$/, ''),
    maxAttempts: Number(process.env.MAIL_MAX_ATTEMPTS || 5),
  },
};

if (config.isProd && /remplacer-par/.test(config.jwt.accessSecret)) {
  throw new Error('JWT_ACCESS_SECRET doit être défini avec une valeur secrète en production.');
}

if (config.isProd && config.demo) {
  throw new Error('DEMO_MODE est interdit en production : il affiche les comptes et le code de double authentification de démonstration.');
}

module.exports = config;

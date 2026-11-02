'use strict';
/**
 * Authentification : connexion (mot de passe puis, si activée, double authentification),
 * rotation du refresh token, première connexion sécurisée (mot de passe, 2FA, e-mail de
 * récupération, règles de sécurité) et récupération du mot de passe.
 */
const crypto = require('crypto');
const express = require('express');
const bcrypt = require('bcrypt');
const rateLimit = require('express-rate-limit');
const { z } = require('zod');
const db = require('../../db/knex');
const config = require('../../config/env');
const validate = require('../../middleware/validate');
const { authenticate } = require('../../middleware/auth');
const { loadContext, publicContext } = require('../../services/context');
const { audit } = require('../../services/audit');
const { alerter } = require('../../services/alertes');
const { politique } = require('../../services/politique');
const deuxFacteurs = require('../../services/deuxFacteurs');
const { envoyerDirect } = require('../../services/mailer');
const tokens = require('../../services/tokens');
const maintenance = require('../../services/maintenance');
const { passwordSchema, verifierPolitique, historiser, reglesLisibles } = require('../../utils/password');
const { unauthorized, badRequest, AppError } = require('../../utils/errors');
const { REGLES_SECURITE } = require('../../constants');
const { notify } = require('../../services/notifications');
const { ROLES_RENFORCES } = require('../../services/context');

const router = express.Router();

// Limitation anti-brute-force : connexion, second facteur et récupération
const loginLimiter = rateLimit({
  windowMs: config.security.loginWindowMinutes * 60000,
  limit: config.security.loginMax,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: () => config.isTest,
  handler: (req, res) => res.status(429).json({ error: { code: 'TROP_DE_TENTATIVES', message: 'Trop de tentatives de connexion. Veuillez patienter quelques minutes avant de réessayer.' } }),
});

const GENERIQUE = 'Nom d’utilisateur ou mot de passe incorrect.';
const estAdmin = async (userId) => !!(await db('user_roles as ur').join('roles as r', 'r.id', 'ur.role_id').where({ 'ur.user_id': userId, 'r.code': 'ADMIN_SYSTEME' }).first());

async function logLogin(req, user, username, succes, motif) {
  await db('login_history').insert({
    user_id: user ? user.id : null, username, ip: req.ip,
    user_agent: String(req.headers['user-agent'] || '').slice(0, 300), succes, motif,
  });
  await audit(req, {
    action: succes ? 'CONNEXION' : 'ECHEC_CONNEXION', module: 'auth', entite: 'user', entiteId: user ? user.id : null,
    resultat: succes ? 'SUCCES' : 'ECHEC', message: motif, user: { id: user ? user.id : null, username },
  });
}

/** Surveillance des échecs : vague d’échecs (toutes origines) et tentatives sur un compte Admin Système. */
async function surveillerEchecs(req, user, username) {
  const p = await politique();
  const n = Number((await db('login_history').where('succes', false).where('created_at', '>', db.raw(`now() - interval '15 minutes'`)).count('* as n').first()).n);
  if (n >= p.alerte_echecs_seuil) {
    await alerter({ type: 'ECHECS_CONNEXION', gravite: 'CRITIQUE', titre: `${n} échecs de connexion en 15 minutes`, message: `Dernière tentative : « ${username} » depuis ${req.ip}.`, ip: req.ip, unique: 15 });
  }
  if (user && await estAdmin(user.id)) {
    await alerter({ type: 'ECHEC_ADMIN', gravite: 'ATTENTION', titre: 'Échec de connexion sur un compte Admin Système', message: `Compte « ${user.username} » depuis ${req.ip}.`, user, ip: req.ip, unique: 15 });
  }
}

/** Enregistre un échec d’authentification sur un compte existant (verrouillage selon la politique). */
async function echec(req, user, username, motif) {
  const p = await politique();
  const attempts = user.failed_attempts + 1;
  const lock = attempts >= p.verrouillage_tentatives;
  await db('users').where({ id: user.id }).update({
    failed_attempts: attempts,
    ...(lock ? { statut: 'VERROUILLE', locked_until: new Date(Date.now() + p.verrouillage_minutes * 60000), motif_blocage: `Verrouillage automatique après ${attempts} échecs` } : {}),
  });
  await logLogin(req, user, username, false, lock ? `${motif} — compte verrouillé` : motif);
  await surveillerEchecs(req, user, username);
  if (lock) {
    await audit(req, { action: 'VERROUILLAGE', module: 'comptes', entite: 'user', entiteId: user.id, message: `Verrouillage après ${attempts} échecs`, user });
    await alerter({ type: 'VERROUILLAGE', gravite: 'ATTENTION', titre: `Compte « ${user.username} » verrouillé`, message: `${attempts} échecs consécutifs ; dernier depuis ${req.ip}.`, user, ip: req.ip, unique: 15 });
    throw new AppError(423, 'COMPTE_VERROUILLE', `Compte verrouillé pour ${p.verrouillage_minutes} minutes après ${attempts} tentatives infructueuses.`);
  }
  return p.verrouillage_tentatives - attempts;
}

/** Contrôle du statut du compte avant toute vérification d’identifiants (déverrouillage automatique). */
async function controlerStatut(req, user, username) {
  if (user.statut === 'DESACTIVE') {
    await logLogin(req, user, username, false, 'Compte désactivé');
    throw unauthorized('Ce compte est désactivé. Contactez l’administrateur.', 'COMPTE_DESACTIVE');
  }
  if (user.statut === 'VERROUILLE') {
    if (user.locked_until && new Date(user.locked_until) <= new Date()) {
      await db('users').where({ id: user.id }).update({ statut: 'ACTIF', failed_attempts: 0, locked_until: null, motif_blocage: null });
      user.statut = 'ACTIF';
      user.failed_attempts = 0;
      await audit(req, { action: 'DEVERROUILLAGE_AUTO', module: 'comptes', entite: 'user', entiteId: user.id, user });
    } else {
      await logLogin(req, user, username, false, 'Compte verrouillé');
      const mins = user.locked_until ? Math.max(1, Math.ceil((new Date(user.locked_until) - Date.now()) / 60000)) : null;
      throw new AppError(423, 'COMPTE_VERROUILLE', mins
        ? `Compte temporairement verrouillé. Réessayez dans ${mins} minute(s) ou contactez l’administrateur.`
        : 'Compte verrouillé. Contactez l’administrateur.');
    }
  }
}

/** En maintenance, seuls les Admins Système peuvent ouvrir une session. */
async function controlerMaintenance(user) {
  const m = await maintenance.etat();
  if (m.active && !(await estAdmin(user.id))) throw new AppError(503, 'MAINTENANCE', m.message || 'Le SIG-DEP est en maintenance.', { fin: m.fin });
}

/** Navigateur et système lisibles à partir de l’en-tête User-Agent. */
function appareil(ua = '') {
  const nav = /Edg\//.test(ua) ? 'Edge' : /OPR\/|Opera/.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Navigateur inconnu';
  const os = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Mac OS X/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : 'système inconnu';
  return `${nav} sur ${os}`;
}

/** Première connexion réussie depuis cet appareil (navigateur) au cours des 180 derniers jours, hors toute première connexion. */
async function nouvelAppareil(req, user) {
  const ua = String(req.headers['user-agent'] || '').slice(0, 300);
  const prec = await db('login_history').where({ user_id: user.id, succes: true }).where('created_at', '>', db.raw(`now() - interval '180 days'`))
    .select(db.raw('count(*)::int as total'), db.raw('count(*) FILTER (WHERE user_agent = ?)::int as meme', [ua])).first();
  return prec.total > 0 && prec.meme === 0;
}

async function ouvrirSession(req, res, user, motif = 'Connexion réussie') {
  if (user.compte_urgence) {
    // Compte d’urgence : uniquement pendant la période d’activation ; chaque connexion est signalée.
    if (!user.urgence_jusqua || new Date(user.urgence_jusqua) <= new Date()) {
      await require('../../services/gouvernance').fermerUrgence({ par: 'SIG-DEP', motif: 'Échéance de l’activation' });
      await logLogin(req, user, user.username, false, 'Compte d’urgence hors période d’activation');
      throw unauthorized('Le compte d’urgence n’est pas activé.', 'COMPTE_DESACTIVE');
    }
    await require('../../services/gouvernance').signalerConnexionUrgence(user, req.ip);
  }
  await controlerMaintenance(user);
  await db('users').where({ id: user.id }).update({ failed_attempts: 0, locked_until: null, last_login_at: db.fn.now() });
  const nouveau = await nouvelAppareil(req, user);
  const { raw, row } = await tokens.issueRefresh(user.id, req);
  tokens.setRefreshCookie(res, raw, row.expires_at);
  await logLogin(req, user, user.username, true, motif);
  const fresh = await db('users').where({ id: user.id }).first();
  const ctx = await loadContext(user.id);
  // Comptes sensibles (Admin, Directeur, SG) : avis de connexion depuis un nouvel appareil.
  if (nouveau && ctx.roles.concat(ctx.rolesPermanents || []).some((r) => ROLES_RENFORCES.includes(r))) {
    await notify(user.id, {
      type: 'CONNEXION', titre: 'Connexion depuis un nouvel appareil',
      message: `Le ${new Date().toLocaleString('fr-FR', { timeZone: 'Africa/Kinshasa' })}, ${appareil(req.headers['user-agent'])}, adresse ${req.ip}. Si ce n’est pas vous, fermez cette session depuis Mon profil → Sessions et changez votre mot de passe.`,
      lien: '/profil',
    });
  }
  return res.json({ accessToken: tokens.signAccess(fresh), user: publicContext(ctx) });
}

// ─── Défis à usage unique (second facteur, vérification d’e-mail, récupération) ─
const hashDefi = (id, code) => crypto.createHash('sha256').update(`${id}:${code}`).digest('hex');
const code6 = () => String(crypto.randomInt(0, 1000000)).padStart(6, '0');

async function creerDefi(userId, type, minutes, req, avecCode = false) {
  const id = crypto.randomUUID();
  const code = avecCode ? code6() : null;
  await db('defis_auth').where({ user_id: userId, type }).whereNull('utilise_at').update({ utilise_at: db.fn.now() });
  await db('defis_auth').insert({ id, user_id: userId, type, code_hash: code ? hashDefi(id, code) : null, expires_at: new Date(Date.now() + minutes * 60000), ip: req.ip });
  return { id, code };
}

async function defiValide(where) {
  return db('defis_auth').where(where).whereNull('utilise_at').where('expires_at', '>', db.fn.now()).where('tentatives', '<', 5).orderBy('created_at', 'desc').first();
}

// ─── Connexion ───────────────────────────────────────────────────────────────
router.post('/login', loginLimiter, validate({ body: z.object({ username: z.string().trim().min(1).max(60), password: z.string().min(1).max(200) }) }), async (req, res) => {
  const { username, password } = req.valid.body;
  const user = await db('users').whereRaw('lower(username) = lower(?)', [username]).first();
  if (!user) {
    await logLogin(req, null, username, false, 'Utilisateur inconnu');
    await surveillerEchecs(req, null, username);
    throw unauthorized(GENERIQUE, 'IDENTIFIANTS_INVALIDES');
  }
  await controlerStatut(req, user, username);
  if (!(await bcrypt.compare(password, user.password_hash))) {
    const restant = await echec(req, user, username, 'Mot de passe incorrect');
    throw unauthorized(`${GENERIQUE} Tentatives restantes avant verrouillage : ${restant}.`, 'IDENTIFIANTS_INVALIDES');
  }
  if (user.totp_actif) {
    // Mot de passe correct : un second facteur est exigé dans les 5 minutes.
    const d = await creerDefi(user.id, 'CONNEXION_2FA', 5, req);
    return res.json({ deuxFacteurs: true, defi: d.id, message: 'Saisissez le code à 6 chiffres de votre application d’authentification.' });
  }
  return ouvrirSession(req, res, user);
});

router.post('/login/deux-facteurs', loginLimiter, validate({ body: z.object({ defi: z.uuid(), code: z.string().trim().min(6).max(20) }) }), async (req, res) => {
  const d = await defiValide({ id: req.valid.body.defi, type: 'CONNEXION_2FA' });
  if (!d) throw unauthorized('Délai dépassé ou trop de tentatives : reconnectez-vous.', 'DEFI_EXPIRE');
  const user = await db('users').where({ id: d.user_id }).first();
  await controlerStatut(req, user, user.username);
  const r = await deuxFacteurs.verifierSecondFacteur(user, req.valid.body.code);
  if (!r.ok) {
    await db('defis_auth').where({ id: d.id }).increment('tentatives', 1);
    const restant = await echec(req, user, user.username, 'Code de double authentification incorrect');
    throw unauthorized(`Code incorrect. Tentatives restantes avant verrouillage : ${restant}.`, 'CODE_2FA_INVALIDE');
  }
  await db('defis_auth').where({ id: d.id }).update({ utilise_at: db.fn.now() });
  if (r.methode === 'CODE_SECOURS') {
    await alerter({ type: 'CODE_SECOURS', gravite: r.restants <= 2 ? 'ATTENTION' : 'INFO', titre: `Code de secours utilisé par « ${user.username} »`, message: `Codes restants : ${r.restants}.`, user, ip: req.ip });
  }
  return ouvrirSession(req, res, user, r.methode === 'CODE_SECOURS' ? `Connexion réussie (code de secours, ${r.restants} restant(s))` : 'Connexion réussie (double authentification)');
});

router.post('/refresh', async (req, res) => {
  const raw = req.cookies && req.cookies[tokens.COOKIE_NAME];
  if (!raw) throw unauthorized('Aucune session active.', 'SESSION_ABSENTE');
  const row = await db('refresh_tokens').where({ token_hash: tokens.sha256(raw) }).first();
  if (!row) { tokens.clearRefreshCookie(res); throw unauthorized('Session invalide.', 'SESSION_INVALIDE'); }
  if (row.revoked_at) {
    // Réutilisation d’un jeton déjà renouvelé : révocation de toute la famille (vol présumé)
    if (row.revoked_reason === 'ROTATION') {
      await db('refresh_tokens').where({ family_id: row.family_id }).whereNull('revoked_at').update({ revoked_at: db.fn.now(), revoked_reason: 'REUTILISATION' });
      await audit(req, { action: 'REVOCATION_SESSION', module: 'auth', entite: 'user', entiteId: row.user_id, resultat: 'ECHEC', message: 'Réutilisation d’un refresh token détectée : sessions de la famille révoquées', user: { id: row.user_id } });
      await alerter({ type: 'REUTILISATION_JETON', gravite: 'CRITIQUE', titre: 'Réutilisation d’un jeton de session détectée', message: `Compte n° ${row.user_id} depuis ${req.ip} : session révoquée (vol de jeton présumé).`, user: { id: row.user_id }, ip: req.ip, unique: 5 });
    }
    tokens.clearRefreshCookie(res);
    throw unauthorized('Session expirée ou révoquée.', 'SESSION_REVOQUEE');
  }
  if (new Date(row.expires_at) <= new Date()) { tokens.clearRefreshCookie(res); throw unauthorized('Session expirée.', 'SESSION_EXPIREE'); }
  const user = await db('users').where({ id: row.user_id }).first();
  if (!user || user.statut !== 'ACTIF') { tokens.clearRefreshCookie(res); throw unauthorized('Compte indisponible.', 'COMPTE_INDISPONIBLE'); }
  await controlerMaintenance(user);

  const result = await db.transaction(async (trx) => {
    const n = await tokens.issueRefresh(user.id, req, row.family_id, trx, row.expires_at);
    await trx('refresh_tokens').where({ id: row.id }).update({ revoked_at: trx.fn.now(), revoked_reason: 'ROTATION', replaced_by: n.row.id, last_used_at: trx.fn.now() });
    return n;
  });
  tokens.setRefreshCookie(res, result.raw, result.row.expires_at);
  const ctx = await loadContext(user.id);
  res.json({ accessToken: tokens.signAccess(user), user: publicContext(ctx) });
});

router.post('/logout', async (req, res) => {
  const raw = req.cookies && req.cookies[tokens.COOKIE_NAME];
  if (raw) {
    const row = await db('refresh_tokens').where({ token_hash: tokens.sha256(raw) }).first();
    if (row && !row.revoked_at) {
      await db('refresh_tokens').where({ id: row.id }).update({ revoked_at: db.fn.now(), revoked_reason: 'DECONNEXION' });
      await audit(req, { action: 'DECONNEXION', module: 'auth', entite: 'user', entiteId: row.user_id, user: { id: row.user_id } });
    }
  }
  tokens.clearRefreshCookie(res);
  res.json({ message: 'Déconnexion effectuée.' });
});

router.get('/me', authenticate, async (req, res) => {
  res.json({ user: publicContext(req.ctx) });
});

// ─── Sessions personnelles (appareils connectés) ─────────────────────────────
router.get('/sessions', authenticate, async (req, res) => {
  const raw = req.cookies && req.cookies[tokens.COOKIE_NAME];
  const courant = raw ? await db('refresh_tokens').where({ token_hash: tokens.sha256(raw) }).first('family_id') : null;
  const actifs = await db('refresh_tokens').where({ user_id: req.ctx.userId }).whereNull('revoked_at').where('expires_at', '>', db.fn.now())
    .select('family_id', 'ip', 'user_agent', 'created_at', 'expires_at').orderBy('created_at', 'desc');
  // Une famille (un appareil) peut compter plusieurs jetons non révoqués (renouvellements simultanés) :
  // une seule ligne par famille, la plus récente.
  const rows = [...new Map(actifs.reverse().map((r) => [r.family_id, r])).values()].reverse();
  const ouvertures = await db('refresh_tokens').where({ user_id: req.ctx.userId }).whereIn('family_id', rows.map((r) => r.family_id))
    .groupBy('family_id').select('family_id', db.raw('min(created_at) as ouverte_at'));
  res.json({
    data: rows.map((r) => ({
      id: r.family_id, appareil: appareil(r.user_agent), ip: r.ip, derniereActivite: r.created_at, expire: r.expires_at,
      ouverte: (ouvertures.find((o) => o.family_id === r.family_id) || {}).ouverte_at, courante: !!courant && courant.family_id === r.family_id,
    })),
  });
});

/** Ferme une session (appareil) : son jeton de renouvellement est révoqué et les jetons d’accès en cours sont invalidés. */
router.post('/sessions/:id/fermer', authenticate, validate({ params: z.object({ id: z.uuid() }) }), async (req, res) => {
  const n = await db('refresh_tokens').where({ user_id: req.ctx.userId, family_id: req.valid.params.id }).whereNull('revoked_at')
    .update({ revoked_at: db.fn.now(), revoked_reason: 'FERMETURE_UTILISATEUR' });
  if (!n) throw badRequest('Session introuvable ou déjà fermée.');
  await db('users').where({ id: req.ctx.userId }).increment('token_version', 1);
  await audit(req, { action: 'REVOCATION_SESSION', module: 'auth', entite: 'user', entiteId: req.ctx.userId, message: 'Session fermée par son titulaire depuis un autre appareil' });
  const fresh = await db('users').where({ id: req.ctx.userId }).first();
  res.json({ message: 'Session fermée.', accessToken: tokens.signAccess(fresh) });
});

/** Change le mot de passe (politique, historique), révoque les autres sessions et en ouvre une nouvelle. */
async function appliquerNouveauMotDePasse(req, res, user, nouveau, motif) {
  await verifierPolitique(nouveau, user);
  const hash = await bcrypt.hash(nouveau, 12);
  await db.transaction(async (trx) => {
    await trx('users').where({ id: user.id }).update({ password_hash: hash, must_change_password: false, password_changed_at: trx.fn.now(), failed_attempts: 0 });
    await historiser(user.id, hash, trx);
    await tokens.revokeAllForUser(user.id, 'CHANGEMENT_MDP', trx);
  });
  await audit(req, { action: 'CHANGEMENT_MDP', module: 'auth', entite: 'user', entiteId: user.id, message: motif, user: { id: user.id, username: user.username } });
}

router.post('/change-password', authenticate, validate({
  body: z.object({ currentPassword: z.string().min(1), newPassword: passwordSchema }),
}), async (req, res) => {
  const { currentPassword, newPassword } = req.valid.body;
  const user = await db('users').where({ id: req.ctx.userId }).first();
  if (!(await bcrypt.compare(currentPassword, user.password_hash))) {
    await audit(req, { action: 'CHANGEMENT_MDP', module: 'auth', entite: 'user', entiteId: user.id, resultat: 'ECHEC', message: 'Mot de passe actuel incorrect' });
    throw badRequest('Le mot de passe actuel est incorrect.');
  }
  if (await bcrypt.compare(newPassword, user.password_hash)) throw badRequest('Le nouveau mot de passe doit être différent de l’ancien.');
  await appliquerNouveauMotDePasse(req, res, user, newPassword, 'Mot de passe modifié');
  const fresh = await db('users').where({ id: user.id }).first();
  const { raw, row } = await tokens.issueRefresh(user.id, req);
  tokens.setRefreshCookie(res, raw, row.expires_at);
  const ctx = await loadContext(user.id);
  res.json({ message: 'Mot de passe modifié avec succès.', accessToken: tokens.signAccess(fresh), user: publicContext(ctx) });
});

router.get('/politique-mot-de-passe', async (req, res) => {
  res.json({ regles: await reglesLisibles() });
});

// ─── Règles de sécurité ──────────────────────────────────────────────────────
router.get('/regles', authenticate, async (req, res) => {
  const p = await politique();
  res.json({ version: p.regles_securite_version, regles: REGLES_SECURITE, accepteeVersion: (await db('users').where({ id: req.ctx.userId }).first()).regles_acceptees_version });
});

router.post('/regles/accepter', authenticate, validate({ body: z.object({ version: z.number().int().positive() }) }), async (req, res) => {
  const p = await politique();
  if (req.valid.body.version !== p.regles_securite_version) throw badRequest('Les règles ont changé : relisez la version en vigueur.');
  await db('users').where({ id: req.ctx.userId }).update({ regles_acceptees_version: p.regles_securite_version, regles_acceptees_at: db.fn.now() });
  await audit(req, { action: 'ACCEPTATION_REGLES', module: 'auth', entite: 'user', entiteId: req.ctx.userId, message: `Règles de sécurité acceptées (version ${p.regles_securite_version})` });
  res.json({ message: 'Règles de sécurité acceptées.', user: publicContext(await loadContext(req.ctx.userId)) });
});

// ─── Double authentification ─────────────────────────────────────────────────
async function exigerIdentite(user, motDePasse, code) {
  if (!motDePasse || !(await bcrypt.compare(motDePasse, user.password_hash))) throw badRequest('Mot de passe incorrect.');
  if (user.totp_actif && !(await deuxFacteurs.verifierSecondFacteur(user, code)).ok) throw badRequest('Code de double authentification incorrect.');
}

router.post('/2fa/preparer', authenticate, async (req, res) => {
  const user = await db('users').where({ id: req.ctx.userId }).first();
  if (user.totp_actif) throw badRequest('La double authentification est déjà active. Pour changer d’appareil, utilisez « Changer d’appareil » dans votre profil.');
  const r = await deuxFacteurs.preparer(user);
  res.json({ qr: r.qr, secret: r.secret.replace(/(.{4})/g, '$1 ').trim(), otpauth: r.otpauth });
});

router.post('/2fa/activer', authenticate, validate({ body: z.object({ code: z.string().trim().min(6).max(8) }) }), async (req, res) => {
  const user = await db('users').where({ id: req.ctx.userId }).first();
  if (user.totp_actif) throw badRequest('La double authentification est déjà active.');
  if (!user.totp_secret) throw badRequest('Commencez par afficher le QR code.');
  if (!deuxFacteurs.verifierTotp(user, req.valid.body.code)) throw badRequest('Code incorrect : vérifiez l’heure de votre téléphone et saisissez le code affiché.');
  const codes = await db.transaction(async (trx) => {
    await trx('users').where({ id: user.id }).update({ totp_actif: true, totp_active_at: trx.fn.now() });
    return deuxFacteurs.genererCodesSecours(user.id, trx);
  });
  await audit(req, { action: 'ACTIVATION_2FA', module: 'auth', entite: 'user', entiteId: user.id, message: 'Double authentification activée' });
  res.json({ message: 'Double authentification activée.', codesSecours: codes, user: publicContext(await loadContext(user.id)) });
});

router.post('/2fa/codes-secours', authenticate, validate({ body: z.object({ motDePasse: z.string().min(1), code: z.string().trim().min(6).max(20) }) }), async (req, res) => {
  const user = await db('users').where({ id: req.ctx.userId }).first();
  if (!user.totp_actif) throw badRequest('La double authentification n’est pas active.');
  await exigerIdentite(user, req.valid.body.motDePasse, req.valid.body.code);
  const codes = await deuxFacteurs.genererCodesSecours(user.id);
  await audit(req, { action: 'CODES_SECOURS', module: 'auth', entite: 'user', entiteId: user.id, message: 'Nouveaux codes de secours générés (anciens invalidés)' });
  res.json({ codesSecours: codes });
});

router.post('/2fa/changer-appareil', authenticate, validate({ body: z.object({ motDePasse: z.string().min(1), code: z.string().trim().min(6).max(20) }) }), async (req, res) => {
  const user = await db('users').where({ id: req.ctx.userId }).first();
  if (!user.totp_actif) throw badRequest('La double authentification n’est pas active.');
  await exigerIdentite(user, req.valid.body.motDePasse, req.valid.body.code);
  await db('users').where({ id: user.id }).update({ totp_actif: false, totp_secret: null });
  await audit(req, { action: 'CHANGEMENT_APPAREIL_2FA', module: 'auth', entite: 'user', entiteId: user.id, message: 'Double authentification réinitialisée (changement d’appareil)' });
  await alerter({ type: 'CHANGEMENT_2FA', gravite: 'ATTENTION', titre: `Changement d’appareil d’authentification pour « ${user.username} »`, user, ip: req.ip });
  res.json({ message: 'Configurez maintenant votre nouvel appareil.', user: publicContext(await loadContext(user.id)) });
});

// ─── E-mail de récupération ─────────────────────────────────────────────────
router.post('/email-recuperation', authenticate, validate({ body: z.object({ email: z.email('adresse électronique invalide').max(150), motDePasse: z.string().optional() }) }), async (req, res) => {
  const user = await db('users').where({ id: req.ctx.userId }).first();
  // Modification après la configuration initiale : le mot de passe est redemandé.
  if (user.email_recuperation && !(req.valid.body.motDePasse && await bcrypt.compare(req.valid.body.motDePasse, user.password_hash))) throw badRequest('Mot de passe incorrect.');
  const email = req.valid.body.email.toLowerCase();
  await db('users').where({ id: user.id }).update({ email_recuperation: email, email_recuperation_verifie_at: null });
  let verificationEnvoyee = false;
  if (config.mail.enabled) {
    const d = await creerDefi(user.id, 'VERIF_EMAIL', 30, req, true);
    verificationEnvoyee = await envoyerDirect({ to: email, userId: user.id, titre: 'Vérification de votre adresse de récupération', message: `Code de vérification : ${d.code}\nValable 30 minutes. Si vous n’êtes pas à l’origine de cette demande, prévenez immédiatement le responsable de la sécurité.`, lien: '/profil' });
  }
  await audit(req, { action: 'EMAIL_RECUPERATION', module: 'auth', entite: 'user', entiteId: user.id, message: `Adresse de récupération enregistrée${verificationEnvoyee ? ' (code de vérification envoyé)' : ' (messagerie inactive : non vérifiée)'}` });
  res.json({ verificationEnvoyee, message: verificationEnvoyee ? 'Un code de vérification a été envoyé à cette adresse.' : 'Adresse enregistrée. La messagerie n’étant pas configurée, elle n’a pas pu être vérifiée.', user: publicContext(await loadContext(user.id)) });
});

router.post('/email-recuperation/verifier', authenticate, validate({ body: z.object({ code: z.string().trim().regex(/^\d{6}$/, 'code à 6 chiffres') }) }), async (req, res) => {
  const d = await defiValide({ user_id: req.ctx.userId, type: 'VERIF_EMAIL' });
  if (!d || d.code_hash !== hashDefi(d.id, req.valid.body.code)) {
    if (d) await db('defis_auth').where({ id: d.id }).increment('tentatives', 1);
    throw badRequest('Code incorrect ou expiré.');
  }
  await db('defis_auth').where({ id: d.id }).update({ utilise_at: db.fn.now() });
  await db('users').where({ id: req.ctx.userId }).update({ email_recuperation_verifie_at: db.fn.now() });
  await audit(req, { action: 'EMAIL_RECUPERATION', module: 'auth', entite: 'user', entiteId: req.ctx.userId, message: 'Adresse de récupération vérifiée' });
  res.json({ message: 'Adresse de récupération vérifiée.', user: publicContext(await loadContext(req.ctx.userId)) });
});

// ─── Mot de passe oublié (comptes disposant d’une adresse de récupération vérifiée) ─
const REPONSE_RECUP = 'Si ce compte dispose d’une adresse de récupération vérifiée, un code y a été envoyé. Sinon, contactez l’Admin Système.';

router.post('/recuperation/demander', loginLimiter, validate({ body: z.object({ username: z.string().trim().min(1).max(60) }) }), async (req, res) => {
  const user = await db('users').whereRaw('lower(username) = lower(?)', [req.valid.body.username]).first();
  if (user && user.statut !== 'DESACTIVE' && user.email_recuperation && user.email_recuperation_verifie_at && config.mail.enabled) {
    const d = await creerDefi(user.id, 'RECUPERATION', 15, req, true);
    await envoyerDirect({ to: user.email_recuperation, userId: user.id, titre: 'Récupération de votre mot de passe SIG-DEP', message: `Code de récupération : ${d.code}\nValable 15 minutes. Votre code de double authentification sera aussi demandé.\nSi vous n’êtes pas à l’origine de cette demande, ignorez ce message et prévenez le responsable de la sécurité.`, lien: '/connexion' });
    await audit(req, { action: 'RECUPERATION_DEMANDE', module: 'auth', entite: 'user', entiteId: user.id, message: `Code de récupération envoyé (${req.ip})`, user });
  } else {
    await audit(req, { action: 'RECUPERATION_DEMANDE', module: 'auth', resultat: 'ECHEC', message: `Demande sans suite pour « ${req.valid.body.username} » (${req.ip})`, user: { username: req.valid.body.username } });
  }
  res.json({ message: REPONSE_RECUP });
});

router.post('/recuperation/confirmer', loginLimiter, validate({ body: z.object({
  username: z.string().trim().min(1).max(60), code: z.string().trim().regex(/^\d{6}$/, 'code à 6 chiffres'),
  codeDeuxFacteurs: z.string().trim().max(20).optional(), nouveauMotDePasse: passwordSchema,
}) }), async (req, res) => {
  const { username, code, codeDeuxFacteurs, nouveauMotDePasse } = req.valid.body;
  const invalide = () => badRequest('Code de récupération incorrect ou expiré.');
  const user = await db('users').whereRaw('lower(username) = lower(?)', [username]).first();
  if (!user || user.statut === 'DESACTIVE') throw invalide();
  const d = await defiValide({ user_id: user.id, type: 'RECUPERATION' });
  if (!d || d.code_hash !== hashDefi(d.id, code)) {
    if (d) await db('defis_auth').where({ id: d.id }).increment('tentatives', 1);
    await logLogin(req, user, user.username, false, 'Récupération : code incorrect');
    throw invalide();
  }
  if (user.totp_actif && !(await deuxFacteurs.verifierSecondFacteur(user, codeDeuxFacteurs)).ok) {
    await db('defis_auth').where({ id: d.id }).increment('tentatives', 1);
    await logLogin(req, user, user.username, false, 'Récupération : code de double authentification incorrect');
    throw badRequest('Code de double authentification (ou code de secours) incorrect.');
  }
  await appliquerNouveauMotDePasse(req, res, user, nouveauMotDePasse, 'Mot de passe réinitialisé par récupération');
  await db('defis_auth').where({ id: d.id }).update({ utilise_at: db.fn.now() });
  await db('users').where({ id: user.id }).update({ statut: user.statut === 'VERROUILLE' ? 'ACTIF' : user.statut, locked_until: null, motif_blocage: null });
  await alerter({ type: 'RECUPERATION', gravite: 'ATTENTION', titre: `Mot de passe de « ${user.username} » réinitialisé par récupération`, message: `Depuis ${req.ip}.`, user, ip: req.ip });
  res.json({ message: 'Mot de passe réinitialisé. Vous pouvez vous connecter.' });
});

module.exports = router;

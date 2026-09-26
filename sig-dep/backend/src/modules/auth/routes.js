'use strict';
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
const tokens = require('../../services/tokens');
const { passwordSchema } = require('../../utils/password');
const { unauthorized, badRequest, AppError } = require('../../utils/errors');

const router = express.Router();

// Limitation anti-brute-force appliquée UNIQUEMENT à la connexion
const loginLimiter = rateLimit({
  windowMs: config.security.loginWindowMinutes * 60000,
  limit: config.security.loginMax,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: () => config.isTest,
  handler: (req, res) => res.status(429).json({ error: { code: 'TROP_DE_TENTATIVES', message: 'Trop de tentatives de connexion. Veuillez patienter quelques minutes avant de réessayer.' } }),
});

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

router.post('/login', loginLimiter, validate({ body: z.object({ username: z.string().trim().min(1).max(60), password: z.string().min(1).max(200) }) }), async (req, res) => {
  const { username, password } = req.valid.body;
  const generic = 'Nom d’utilisateur ou mot de passe incorrect.';
  const user = await db('users').whereRaw('lower(username) = lower(?)', [username]).first();
  if (!user) {
    await logLogin(req, null, username, false, 'Utilisateur inconnu');
    throw unauthorized(generic, 'IDENTIFIANTS_INVALIDES');
  }
  if (user.statut === 'DESACTIVE') {
    await logLogin(req, user, username, false, 'Compte désactivé');
    throw unauthorized('Ce compte est désactivé. Contactez l’administrateur.', 'COMPTE_DESACTIVE');
  }
  // Déverrouillage automatique à l’expiration du délai
  if (user.statut === 'VERROUILLE') {
    if (user.locked_until && new Date(user.locked_until) <= new Date()) {
      await db('users').where({ id: user.id }).update({ statut: 'ACTIF', failed_attempts: 0, locked_until: null });
      user.statut = 'ACTIF';
      user.failed_attempts = 0;
      await audit(req, { action: 'DEVERROUILLAGE_AUTO', module: 'comptes', entite: 'user', entiteId: user.id, user });
    } else {
      await logLogin(req, user, username, false, 'Compte verrouillé');
      const mins = user.locked_until ? Math.max(1, Math.ceil((new Date(user.locked_until) - Date.now()) / 60000)) : null;
      throw new AppError(423, 'COMPTE_VERROUILLE', mins
        ? `Compte temporairement verrouillé après plusieurs échecs. Réessayez dans ${mins} minute(s) ou contactez l’administrateur.`
        : 'Compte verrouillé. Contactez l’administrateur.');
    }
  }
  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) {
    const attempts = user.failed_attempts + 1;
    const lock = attempts >= config.security.maxFailedLogins;
    await db('users').where({ id: user.id }).update({
      failed_attempts: attempts,
      ...(lock ? { statut: 'VERROUILLE', locked_until: new Date(Date.now() + config.security.lockMinutes * 60000) } : {}),
    });
    await logLogin(req, user, username, false, lock ? 'Mot de passe incorrect — compte verrouillé' : 'Mot de passe incorrect');
    if (lock) {
      await audit(req, { action: 'VERROUILLAGE', module: 'comptes', entite: 'user', entiteId: user.id, message: `Verrouillage après ${attempts} échecs`, user });
      throw new AppError(423, 'COMPTE_VERROUILLE', `Compte verrouillé pour ${config.security.lockMinutes} minutes après ${attempts} tentatives infructueuses.`);
    }
    const restant = config.security.maxFailedLogins - attempts;
    throw unauthorized(`${generic} Tentatives restantes avant verrouillage : ${restant}.`, 'IDENTIFIANTS_INVALIDES');
  }
  await db('users').where({ id: user.id }).update({ failed_attempts: 0, locked_until: null, last_login_at: db.fn.now() });
  const { raw } = await tokens.issueRefresh(user.id, req);
  tokens.setRefreshCookie(res, raw);
  await logLogin(req, user, username, true, 'Connexion réussie');
  const ctx = await loadContext(user.id);
  res.json({ accessToken: tokens.signAccess(user), user: publicContext(ctx) });
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
    }
    tokens.clearRefreshCookie(res);
    throw unauthorized('Session expirée ou révoquée.', 'SESSION_REVOQUEE');
  }
  if (new Date(row.expires_at) <= new Date()) { tokens.clearRefreshCookie(res); throw unauthorized('Session expirée.', 'SESSION_EXPIREE'); }
  const user = await db('users').where({ id: row.user_id }).first();
  if (!user || user.statut !== 'ACTIF') { tokens.clearRefreshCookie(res); throw unauthorized('Compte indisponible.', 'COMPTE_INDISPONIBLE'); }

  const result = await db.transaction(async (trx) => {
    const n = await tokens.issueRefresh(user.id, req, row.family_id, trx);
    await trx('refresh_tokens').where({ id: row.id }).update({ revoked_at: trx.fn.now(), revoked_reason: 'ROTATION', replaced_by: n.row.id, last_used_at: trx.fn.now() });
    return n;
  });
  tokens.setRefreshCookie(res, result.raw);
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
  const hash = await bcrypt.hash(newPassword, 12);
  await db.transaction(async (trx) => {
    await trx('users').where({ id: user.id }).update({ password_hash: hash, must_change_password: false, password_changed_at: trx.fn.now() });
    await tokens.revokeAllForUser(user.id, 'CHANGEMENT_MDP', trx);
  });
  const fresh = await db('users').where({ id: user.id }).first();
  const { raw } = await tokens.issueRefresh(user.id, req);
  tokens.setRefreshCookie(res, raw);
  await audit(req, { action: 'CHANGEMENT_MDP', module: 'auth', entite: 'user', entiteId: user.id, message: 'Mot de passe modifié' });
  const ctx = await loadContext(user.id);
  res.json({ message: 'Mot de passe modifié avec succès.', accessToken: tokens.signAccess(fresh), user: publicContext(ctx) });
});

module.exports = router;

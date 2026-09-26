'use strict';
const jwt = require('jsonwebtoken');
const config = require('../config/env');
const { loadContext } = require('../services/context');
const { unauthorized, forbidden } = require('../utils/errors');

const PASSWORD_FREE_PATHS = ['/api/auth/me', '/api/auth/change-password', '/api/auth/logout'];

/** Vérifie le jeton d’accès et charge le contexte à jour depuis la base (statut, rôles, affectation). */
async function authenticate(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return next(unauthorized());
  let payload;
  try {
    payload = jwt.verify(token, config.jwt.accessSecret, { issuer: 'sig-dep' });
  } catch (e) {
    return next(unauthorized(e.name === 'TokenExpiredError' ? 'Session expirée.' : 'Jeton invalide.', e.name === 'TokenExpiredError' ? 'TOKEN_EXPIRE' : 'TOKEN_INVALIDE'));
  }
  const ctx = await loadContext(Number(payload.sub));
  if (!ctx) return next(unauthorized('Compte introuvable.'));
  if (ctx.statut === 'DESACTIVE') return next(unauthorized('Ce compte est désactivé.', 'COMPTE_DESACTIVE'));
  if (ctx.tokenVersion !== payload.tv) return next(unauthorized('Session révoquée. Veuillez vous reconnecter.', 'SESSION_REVOQUEE'));
  if (ctx.mustChangePassword && !PASSWORD_FREE_PATHS.includes(req.originalUrl.split('?')[0])) {
    return next(forbidden('Vous devez changer votre mot de passe temporaire avant de continuer.', 'CHANGEMENT_MDP_REQUIS'));
  }
  req.ctx = ctx;
  return next();
}

/** Exige au moins une des permissions indiquées. */
function requirePerm(...perms) {
  return (req, res, next) => {
    if (!req.ctx) return next(unauthorized());
    if (!perms.some((p) => req.ctx.permissions.has(p))) {
      return next(forbidden('Permission insuffisante pour cette opération.', 'PERMISSION_REQUISE'));
    }
    return next();
  };
}

module.exports = { authenticate, requirePerm };

'use strict';
const jwt = require('jsonwebtoken');
const config = require('../config/env');
const { loadContext } = require('../services/context');
const { unauthorized, forbidden, AppError } = require('../utils/errors');
const maintenance = require('../services/maintenance');

/** Routes accessibles tant que les étapes de sécurité de la première connexion ne sont pas terminées. */
const PASSWORD_FREE_PATHS = ['/api/auth/me', '/api/auth/change-password', '/api/auth/logout', '/api/auth/regles'];
const SETUP_PATHS = [...PASSWORD_FREE_PATHS, '/api/auth/2fa/preparer', '/api/auth/2fa/activer', '/api/auth/email-recuperation',
  '/api/auth/email-recuperation/verifier', '/api/auth/regles/accepter'];

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
  const chemin = req.originalUrl.split('?')[0];
  const m = await maintenance.etat();
  if (m.active && !ctx.roles.includes('ADMIN_SYSTEME') && chemin !== '/api/auth/logout') {
    return next(new AppError(503, 'MAINTENANCE', m.message || 'Le SIG-DEP est en maintenance.', { fin: m.fin }));
  }
  if (ctx.exigences.includes('MOT_DE_PASSE') && !PASSWORD_FREE_PATHS.includes(chemin)) {
    return next(forbidden(ctx.mdpExpire ? 'Votre mot de passe a expiré : changez-le avant de continuer.' : 'Vous devez changer votre mot de passe temporaire avant de continuer.', 'CHANGEMENT_MDP_REQUIS'));
  }
  if (ctx.exigences.length && !SETUP_PATHS.includes(chemin)) {
    return next(forbidden('Terminez la configuration de sécurité de votre compte avant de continuer.', 'CONFIGURATION_SECURITE_REQUISE'));
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

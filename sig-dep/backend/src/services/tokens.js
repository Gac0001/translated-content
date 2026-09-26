'use strict';
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const db = require('../db/knex');
const config = require('../config/env');

const COOKIE_NAME = 'sigdep_rt';

function sha256(v) { return crypto.createHash('sha256').update(v).digest('hex'); }

function signAccess(user) {
  return jwt.sign({ sub: String(user.id), tv: user.token_version, u: user.username }, config.jwt.accessSecret, {
    expiresIn: config.jwt.accessTtl, issuer: 'sig-dep',
  });
}

async function issueRefresh(userId, req, familyId = crypto.randomUUID(), trx = db) {
  const raw = crypto.randomBytes(48).toString('base64url');
  const expires = new Date(Date.now() + config.jwt.refreshTtlDays * 86400000);
  const [row] = await trx('refresh_tokens').insert({
    user_id: userId, token_hash: sha256(raw), family_id: familyId, expires_at: expires,
    ip: req.ip, user_agent: String(req.headers['user-agent'] || '').slice(0, 300),
  }).returning('*');
  return { raw, row };
}

function cookieOptions() {
  return {
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: 'strict',
    path: '/api/auth',
    maxAge: config.jwt.refreshTtlDays * 86400000,
  };
}

function setRefreshCookie(res, raw) { res.cookie(COOKIE_NAME, raw, cookieOptions()); }
function clearRefreshCookie(res) { const o = cookieOptions(); delete o.maxAge; res.clearCookie(COOKIE_NAME, o); }

async function revokeAllForUser(userId, reason, trx = db) {
  await trx('refresh_tokens').where({ user_id: userId }).whereNull('revoked_at').update({ revoked_at: trx.fn.now(), revoked_reason: reason });
  await trx('users').where({ id: userId }).increment('token_version', 1);
}

module.exports = { COOKIE_NAME, sha256, signAccess, issueRefresh, setRefreshCookie, clearRefreshCookie, revokeAllForUser };

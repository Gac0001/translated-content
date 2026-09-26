'use strict';
/** Journal d’audit en ajout seul (la base interdit toute modification ou suppression). */
const db = require('../db/knex');
const { ROLE_LIBELLES } = require('../constants');

function clientIp(req) {
  return (req && (req.ip || req.socket?.remoteAddress)) || null;
}

function sanitize(v) {
  if (v === undefined || v === null) return null;
  const clone = JSON.parse(JSON.stringify(v));
  const strip = (o) => {
    if (o && typeof o === 'object') {
      for (const k of Object.keys(o)) {
        if (/password|token|hash|secret/i.test(k)) o[k] = '***';
        else strip(o[k]);
      }
    }
  };
  strip(clone);
  return clone;
}

async function audit(req, { action, module, entite = null, entiteId = null, avant = null, apres = null, resultat = 'SUCCES', message = null, user = null }, trx = db) {
  const ctx = (req && req.ctx) || null;
  const u = user || ctx;
  try {
    await trx('audit_logs').insert({
      user_id: u ? (u.userId || u.id || null) : null,
      username: u ? u.username : null,
      role: ctx ? (ROLE_LIBELLES[ctx.primaryRole] || ctx.primaryRole) : (u && u.role) || null,
      ip: clientIp(req),
      action, module, entite,
      entite_id: entiteId !== null && entiteId !== undefined ? String(entiteId) : null,
      ancienne_valeur: avant ? JSON.stringify(sanitize(avant)) : null,
      nouvelle_valeur: apres ? JSON.stringify(sanitize(apres)) : null,
      resultat, message,
    });
  } catch (e) {
    console.error('[AUDIT] échec d’écriture', e.message);
  }
}

module.exports = { audit, clientIp };

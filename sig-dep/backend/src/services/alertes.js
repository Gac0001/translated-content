'use strict';
/**
 * Alertes de sécurité : enregistrées, notifiées aux Admins Système (notification interne
 * et e-mail de récupération si la messagerie est active).
 */
const db = require('../db/knex');
const { notify } = require('./notifications');

const GRAVITES = ['INFO', 'ATTENTION', 'CRITIQUE'];

async function adminsActifs() {
  return db('users as u').join('user_roles as ur', 'ur.user_id', 'u.id').join('roles as r', 'r.id', 'ur.role_id')
    .where({ 'r.code': 'ADMIN_SYSTEME', 'u.statut': 'ACTIF' }).pluck('u.id');
}

/**
 * Enregistre une alerte. `unique` (minutes) évite les doublons du même type pour le même compte/IP.
 */
async function alerter({ type, gravite = 'ATTENTION', titre, message = null, details = null, user = null, ip = null, unique = 0 }) {
  try {
    if (unique) {
      const q = db('alertes_securite').where({ type }).where('created_at', '>', db.raw(`now() - make_interval(mins => ?)`, [unique]));
      if (user && user.id) q.where('user_id', user.id); else if (ip) q.where('ip', ip);
      if (await q.first()) return null;
    }
    const [a] = await db('alertes_securite').insert({
      type, gravite: GRAVITES.includes(gravite) ? gravite : 'ATTENTION', titre, message,
      details: details ? JSON.stringify(details) : null, user_id: user ? user.id : null, username: user ? user.username : null, ip,
    }).returning('*');
    if (gravite !== 'INFO') {
      await notify(await adminsActifs(), { type: 'SECURITE', titre: `${gravite === 'CRITIQUE' ? 'Alerte critique' : 'Alerte'} : ${titre}`, message, lien: '/securite' });
    }
    return a;
  } catch (e) {
    console.error('[ALERTE] enregistrement impossible :', e.message);
    return null;
  }
}

module.exports = { alerter, adminsActifs, GRAVITES };

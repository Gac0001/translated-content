'use strict';
/**
 * Journal technique : erreurs serveur (500) regroupées par empreinte (méthode, route
 * normalisée, message). Ce ne sont pas des traces de décisions : purge après la durée fixée.
 */
const crypto = require('crypto');
const db = require('../db/knex');

/** Route sans identifiants variables (/api/users/12/roles → /api/users/:id/roles). */
function normaliser(url) {
  return String(url || '').split('?')[0]
    .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '/:uuid')
    .replace(/\/\d+(?=\/|$)/g, '/:id').slice(0, 300);
}

async function enregistrer(err, req = null) {
  try {
    const methode = req ? req.method : 'JOB';
    const route = req ? normaliser(req.originalUrl) : (err.contexte || 'tâche périodique');
    const message = String((err && err.message) || err).slice(0, 2000);
    const empreinte = crypto.createHash('sha256').update(`${methode}|${route}|${message.replace(/\d+/g, '#')}`).digest('hex');
    const ctx = req && req.ctx;
    await db.raw(`
      INSERT INTO erreurs_techniques (empreinte, methode, route, statut, code, message, pile, derniere_user_id, derniere_username, derniere_ip)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (empreinte) WHERE resolue_at IS NULL
      DO UPDATE SET occurrences = erreurs_techniques.occurrences + 1, derniere_at = now(), pile = EXCLUDED.pile,
        derniere_user_id = EXCLUDED.derniere_user_id, derniere_username = EXCLUDED.derniere_username, derniere_ip = EXCLUDED.derniere_ip`,
    [empreinte, methode, route, 500, err && typeof err.code === 'string' ? err.code.slice(0, 60) : null, message,
      String((err && err.stack) || '').slice(0, 8000), ctx ? ctx.userId : null, ctx ? ctx.username : null, req ? req.ip : null]);
  } catch (e) {
    console.error('[ERREUR] journal technique indisponible :', e.message);
  }
}

module.exports = { enregistrer, normaliser };

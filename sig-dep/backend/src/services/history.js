'use strict';
/** Historique horodaté des workflows (ajout seul). */
const db = require('../db/knex');

async function addHistory(entityType, entityId, userId, { action, ancien = null, nouveau = null, avancement = null, commentaire = null, details = null }, trx = db) {
  await trx('historiques').insert({
    entity_type: entityType, entity_id: entityId, user_id: userId, action,
    ancien_statut: ancien, nouveau_statut: nouveau, avancement, commentaire,
    details: details ? JSON.stringify(details) : null,
  });
}

async function getHistory(entityType, entityId, trx = db) {
  return trx('historiques as h')
    .leftJoin('users as u', 'u.id', 'h.user_id')
    .leftJoin('agents as a', 'a.id', 'u.agent_id')
    .where({ 'h.entity_type': entityType, 'h.entity_id': entityId })
    .orderBy('h.created_at', 'asc').orderBy('h.id', 'asc')
    .select('h.*', 'u.username', db.raw(`concat_ws(' ', a.prenom, a.nom) as auteur`));
}

module.exports = { addHistory, getHistory };

'use strict';
/** Notifications internes. */
const db = require('../db/knex');

const TYPES = {
  INSTRUCTION: 'Nouvelle instruction',
  TACHE: 'Nouvelle tâche',
  COURRIER: 'Transmission de courrier',
  DOCUMENT_RETOURNE: 'Document retourné',
  DOCUMENT_VALIDE: 'Document validé',
  DOCUMENT_A_EXAMINER: 'Document à examiner',
  ECHEANCE: 'Échéance proche',
  RETARD: 'Tâche en retard',
  COMPTE_CREE: 'Compte créé',
  MDP_REINITIALISE: 'Mot de passe réinitialisé',
  AFFECTATION: 'Changement d’affectation',
  PRESENCE: 'Liste de présence',
  PIP: 'Fiche PIP',
  INSTRUCTION_REPONSE: 'Compte rendu d’instruction',
};

async function notify(userIds, { type, titre, message = null, lien = null, expediteur = null }, trx = db) {
  const ids = [...new Set([].concat(userIds).filter(Boolean))].filter((id) => id !== expediteur);
  if (!ids.length) return;
  await trx('notifications').insert(ids.map((user_id) => ({
    user_id, type, titre: titre || TYPES[type] || type, message, lien, expediteur_user_id: expediteur,
  })));
}

module.exports = { notify, TYPES };

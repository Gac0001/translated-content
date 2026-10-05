'use strict';
/** Notifications internes. */
const db = require('../db/knex');
const { enqueueForNotifications } = require('./mailer');

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
  SECURITE: 'Alerte de sécurité',
  SYSTEME: 'Annonce système',
  ACTE: 'Acte administratif',
  CONNEXION: 'Nouvelle connexion',
};

/**
 * Crée les notifications internes et place en file les e-mails correspondants
 * (selon la configuration et les préférences de chaque destinataire).
 * confidentiel : l’e-mail ne reprend ni l’objet ni le contenu de l’élément.
 */
async function notify(userIds, { type, titre, message = null, lien = null, expediteur = null, confidentiel = false }, trx = db) {
  const ids = [...new Set([].concat(userIds).filter(Boolean))].filter((id) => id !== expediteur);
  if (!ids.length) return;
  const rows = await trx('notifications').insert(ids.map((user_id) => ({
    user_id, type, titre: titre || TYPES[type] || type, message, lien, expediteur_user_id: expediteur,
  }))).returning(['id', 'user_id', 'type', 'titre', 'message', 'lien']);
  try {
    await enqueueForNotifications(rows, { confidentiel }, trx);
  } catch (e) {
    // Un incident de messagerie ne doit jamais bloquer l’opération métier.
    console.error('[MAIL] mise en file impossible :', e.message);
  }
}

module.exports = { notify, TYPES };

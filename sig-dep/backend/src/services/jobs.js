'use strict';
/**
 * Tâches périodiques :
 *  - passage « En retard » des instructions et tâches échues + notification ;
 *  - rappels d’échéance proche ;
 *  - verrouillage automatique des listes de présence soumises ;
 *  - purge des refresh tokens expirés et des défis d’authentification ;
 *  - comptes inactifs (désactivation automatique si la politique le prévoit).
 */
const db = require('../db/knex');
const config = require('../config/env');
const { notify } = require('./notifications');
const { addHistory } = require('./history');
const mailer = require('./mailer');
const { audit } = require('./audit');
const { alerter } = require('./alertes');
const { politique } = require('./politique');
const { revokeAllForUser } = require('./tokens');

const ACTIVE = ['TRANSMISE', 'RECUE', 'EN_COURS', 'A_CORRIGER'];

async function markOverdue() {
  for (const [table, entity, userCol, supCol, lien, label] of [
    ['instructions', 'INSTRUCTION', 'destinataire_user_id', 'emetteur_user_id', '/instructions/', 'Instruction'],
    ['tasks', 'TASK', 'agent_user_id', 'assigne_par_user_id', '/taches/', 'Tâche'],
  ]) {
    const rows = await db(table).whereIn('statut', ACTIVE).whereNotNull('echeance').where('echeance', '<', db.raw('CURRENT_DATE'));
    for (const r of rows) {
      await db(table).where({ id: r.id }).update({ statut: 'EN_RETARD', updated_at: db.fn.now() });
      await addHistory(entity, r.id, null, { action: 'RETARD', ancien: r.statut, nouveau: 'EN_RETARD', commentaire: 'Échéance dépassée (contrôle automatique)' });
      await notify([r[userCol], r[supCol]], { type: 'RETARD', titre: `${label} en retard : ${r.reference}`, message: r.objet || r.titre, lien: `${lien}${r.id}` });
    }
  }
}

async function remindDeadlines() {
  const p = await db('parametres').where({ cle: 'delai_rappel_echeance_heures' }).first();
  const hours = Number(p ? p.valeur : 48) || 48;
  for (const [table, userCol, lien, label] of [
    ['instructions', 'destinataire_user_id', '/instructions/', 'Instruction'],
    ['tasks', 'agent_user_id', '/taches/', 'Tâche'],
  ]) {
    const rows = await db(table).whereIn('statut', ACTIVE).where('rappel_envoye', false).whereNotNull('echeance')
      .where('echeance', '>=', db.raw('CURRENT_DATE'))
      .where('echeance', '<=', db.raw(`CURRENT_DATE + make_interval(hours => ?)`, [hours]));
    for (const r of rows) {
      await db(table).where({ id: r.id }).update({ rappel_envoye: true });
      await notify([r[userCol]], { type: 'ECHEANCE', titre: `Échéance proche — ${label} ${r.reference}`, message: `Échéance : ${new Date(r.echeance).toLocaleDateString('fr-FR')}`, lien: `${lien}${r.id}` });
    }
  }
}

async function autolockPresences() {
  const rows = await db('presence_sheets').where({ statut: 'SOUMISE' })
    .where('submitted_at', '<', db.raw(`now() - make_interval(hours => ?)`, [config.presenceAutolockHours]));
  for (const s of rows) {
    await db('presence_sheets').where({ id: s.id }).update({ statut: 'VERROUILLEE', locked_at: db.fn.now() });
    await addHistory('PRESENCE', s.id, null, { action: 'VERROUILLAGE_AUTO', ancien: 'SOUMISE', nouveau: 'VERROUILLEE', commentaire: 'Verrouillage automatique après soumission' });
  }
}

async function purgeTokens() {
  await db('refresh_tokens').where('expires_at', '<', db.raw(`now() - interval '30 days'`)).del();
  // Les e-mails envoyés contiennent des données personnelles : conservation limitée à 90 jours.
  await db('email_outbox').where('statut', 'ENVOYE').where('sent_at', '<', db.raw(`now() - interval '90 days'`)).del();
}

/**
 * Comptes inactifs : désactivation automatique si la politique le prévoit. Les comptes
 * institutionnels (Admin Système, Directeur, Secrétaire Général) ne sont jamais désactivés
 * automatiquement : une alerte est émise à la place.
 */
async function desactiverInactifs() {
  const p = await politique();
  const inactifs = await db('users as u').whereNot('u.statut', 'DESACTIVE')
    .whereRaw('coalesce(u.last_login_at, u.created_at) < now() - make_interval(days => ?)', [p.inactivite_compte_jours])
    .select('u.id', 'u.username', db.raw(`exists (select 1 from user_roles ur join roles r on r.id = ur.role_id where ur.user_id = u.id and r.code in ('ADMIN_SYSTEME','DIRECTEUR','SECRETAIRE_GENERAL')) as institutionnel`));
  if (!inactifs.length) return;
  if (!p.inactivite_desactivation_auto) return;
  for (const u of inactifs) {
    if (u.institutionnel) {
      await alerter({ type: 'INACTIVITE', gravite: 'ATTENTION', titre: `Compte institutionnel « ${u.username} » inactif`, message: `Aucune connexion depuis plus de ${p.inactivite_compte_jours} jours (non désactivé automatiquement).`, user: u, unique: 60 * 24 * 7 });
      continue;
    }
    await db.transaction(async (trx) => {
      await trx('users').where({ id: u.id }).update({ statut: 'DESACTIVE', updated_at: trx.fn.now() });
      await revokeAllForUser(u.id, 'INACTIVITE', trx);
    });
    await audit(null, { action: 'DESACTIVATION', module: 'comptes', entite: 'user', entiteId: u.id, message: `Désactivation automatique : aucune connexion depuis plus de ${p.inactivite_compte_jours} jours`, user: { id: null, username: 'système' } });
  }
}

async function purgeDefis() {
  await db('defis_auth').where('expires_at', '<', db.raw(`now() - interval '1 day'`)).del();
}

async function runAll() {
  for (const fn of [markOverdue, remindDeadlines, autolockPresences, purgeTokens, purgeDefis, desactiverInactifs]) {
    try { await fn(); } catch (e) { console.error(`[JOBS] ${fn.name} :`, e.message); }
  }
}

async function sendMails() {
  try { await mailer.processOutbox(); } catch (e) { console.error('[JOBS] envoi des e-mails :', e.message); }
}

let timer = null;
let mailTimer = null;
function start(intervalMs = 10 * 60000) {
  if (timer) return;
  setTimeout(runAll, 5000);
  timer = setInterval(runAll, intervalMs);
  // La file des e-mails est traitée chaque minute
  mailTimer = setInterval(sendMails, 60000);
  setTimeout(sendMails, 8000);
}

module.exports = { start, runAll, sendMails, markOverdue, remindDeadlines, autolockPresences, desactiverInactifs };

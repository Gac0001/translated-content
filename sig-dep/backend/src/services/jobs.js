'use strict';
/**
 * Tâches périodiques :
 *  - passage « En retard » des instructions et tâches échues + notification ;
 *  - rappels d’échéance proche ;
 *  - verrouillage automatique des listes de présence soumises ;
 *  - purge des refresh tokens expirés.
 */
const db = require('../db/knex');
const config = require('../config/env');
const { notify } = require('./notifications');
const { addHistory } = require('./history');

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
}

async function runAll() {
  for (const fn of [markOverdue, remindDeadlines, autolockPresences, purgeTokens]) {
    try { await fn(); } catch (e) { console.error(`[JOBS] ${fn.name} :`, e.message); }
  }
}

let timer = null;
function start(intervalMs = 10 * 60000) {
  if (timer) return;
  setTimeout(runAll, 5000);
  timer = setInterval(runAll, intervalMs);
}

module.exports = { start, runAll, markOverdue, remindDeadlines, autolockPresences };

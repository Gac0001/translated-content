'use strict';
/**
 * Rappels de l’agenda du Directeur (la veille et une heure avant) et rappel de réunion aux
 * participants convoqués (la veille). Exécutés par les tâches périodiques.
 */
const db = require('../db/knex');
const { notify } = require('./notifications');
const { directeursActifs } = require('./alertes');

const quand = (d) => new Date(d).toLocaleString('fr-FR', { timeZone: 'Africa/Kinshasa', dateStyle: 'full', timeStyle: 'short' });

async function rappels() {
  let n = 0;
  const dirs = await directeursActifs();
  const actifs = () => db('agenda_evenements').whereIn('statut', ['PREVU', 'CONFIRME']).where('debut', '>', db.fn.now());
  // Une heure avant
  for (const ev of await actifs().where('rappel_heure_envoye', false).where('debut', '<=', db.raw(`now() + interval '1 hour'`))) {
    await notify([...new Set([...dirs, ev.created_by])], { type: 'AGENDA', titre: `Dans moins d’une heure : ${ev.titre}`, message: `${quand(ev.debut)}${ev.lieu ? ` — ${ev.lieu}` : ''}`, lien: '/agenda' });
    await db('agenda_evenements').where({ id: ev.id }).update({ rappel_heure_envoye: true, rappel_veille_envoye: true });
    n += 1;
  }
  // La veille (dans les 24 heures)
  for (const ev of await actifs().where('rappel_veille_envoye', false).where('debut', '<=', db.raw(`now() + interval '24 hours'`))) {
    await notify([...new Set([...dirs, ev.created_by])], { type: 'AGENDA', titre: `Rappel : ${ev.titre}`, message: `${quand(ev.debut)}${ev.lieu ? ` — ${ev.lieu}` : ''}`, lien: '/agenda' });
    await db('agenda_evenements').where({ id: ev.id }).update({ rappel_veille_envoye: true });
    n += 1;
  }
  // Réunions convoquées : rappel aux participants la veille
  for (const r of await db('reunions').where({ statut: 'CONVOQUEE', rappel_envoye: false }).where('debut', '>', db.fn.now()).where('debut', '<=', db.raw(`now() + interval '24 hours'`))) {
    const ids = await db('reunion_participants').where({ reunion_id: r.id }).whereNotNull('user_id').pluck('user_id');
    await notify([...new Set([...ids, r.president_user_id, r.redacteur_user_id])].filter(Boolean), { type: 'REUNION', titre: `Rappel de réunion : ${r.objet}`, message: `${quand(r.debut)}${r.lieu ? ` — ${r.lieu}` : ''}`, lien: `/reunions/${r.id}` });
    await db('reunions').where({ id: r.id }).update({ rappel_envoye: true });
    n += 1;
  }
  return n;
}

module.exports = { rappels };

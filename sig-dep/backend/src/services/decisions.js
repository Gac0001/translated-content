'use strict';
/**
 * Registre des décisions (cahier des charges, § 14, étape 8, et § 25) : périmètre de consultation
 * et suivi automatique de l’exécution à partir de l’instruction ou de la tâche qui met en œuvre
 * la décision.
 */
const db = require('../db/knex');
const { notify } = require('./notifications');
const { addHistory } = require('./history');

const STATUTS = { PROJET: 'Projet', A_EXECUTER: 'À exécuter', EN_COURS: 'En cours', EXECUTEE: 'Exécutée', ABANDONNEE: 'Abandonnée' };
const OUVERTES = ['A_EXECUTER', 'EN_COURS'];

/**
 * Décisions visibles : toutes pour le Directeur ; celles de sa structure pour un chef ; celles dont
 * on est responsable, décideur ou rédacteur ; celles des réunions préparées par le Secrétariat.
 * Les projets (compte rendu non validé) restent visibles du seul rédacteur et du décideur.
 */
function scopeDecisions(qb, ctx) {
  return qb.where((w) => {
    w.where((p) => p.where('d.statut', 'PROJET').where((x) => x.where('d.created_by', ctx.userId).orWhere('d.decideur_user_id', ctx.userId)));
    w.orWhere((o) => {
      o.whereNot('d.statut', 'PROJET').where((x) => {
        x.where('d.responsable_user_id', ctx.userId).orWhere('d.decideur_user_id', ctx.userId).orWhere('d.created_by', ctx.userId);
        if (ctx.perimetre === 'DIRECTION') x.orWhereRaw('true');
        if (ctx.perimetre === 'DIVISION') x.orWhere('d.division_id', ctx.divisionId);
        if (ctx.perimetre === 'BUREAU') x.orWhere('d.bureau_id', ctx.bureauId);
        if (ctx.can('reunions.preparer_direction')) x.orWhereExists(db('reunions as r').whereRaw('r.id = d.reunion_id').where('r.niveau', 'DIRECTION'));
      });
    });
  });
}

/**
 * Suivi automatique : une décision mise en œuvre par une instruction ou une tâche est exécutée
 * lorsque celle-ci est validée ou clôturée ; elle redevient « à exécuter » si celle-ci est annulée.
 */
async function synchroniser() {
  const rows = await db('decisions as d')
    .leftJoin('instructions as i', 'i.id', 'd.instruction_id').leftJoin('tasks as t', 't.id', 'd.task_id')
    .where('d.statut', 'EN_COURS').where((w) => w.whereNotNull('d.instruction_id').orWhereNotNull('d.task_id'))
    .select('d.*', 'i.statut as i_statut', 'i.reponse as i_reponse', 'i.reference as i_reference', 't.statut as t_statut', 't.rapport_execution as t_rapport', 't.reference as t_reference');
  let n = 0;
  for (const d of rows) {
    const statut = d.instruction_id ? d.i_statut : d.t_statut;
    const ref = d.instruction_id ? d.i_reference : d.t_reference;
    if (['VALIDEE', 'CLOTUREE'].includes(statut)) {
      await db('decisions').where({ id: d.id }).update({ statut: 'EXECUTEE', executee_at: db.fn.now(), resultat: d.resultat || (d.instruction_id ? d.i_reponse : d.t_rapport) || `Exécutée (${ref})`, updated_at: db.fn.now() });
      await addHistory('DECISION', d.id, null, { action: 'EXECUTION', ancien: 'EN_COURS', nouveau: 'EXECUTEE', commentaire: `${ref} validée : décision exécutée (suivi automatique)` });
      await notify(d.decideur_user_id, { type: 'DECISION', titre: `Décision exécutée : ${d.libelle}`, message: `${d.reference} — ${ref}`, lien: `/decisions/${d.id}` });
      n += 1;
    } else if (statut === 'ANNULEE') {
      await db('decisions').where({ id: d.id }).update({ statut: 'A_EXECUTER', instruction_id: null, task_id: null, updated_at: db.fn.now() });
      await addHistory('DECISION', d.id, null, { action: 'MISE_EN_OEUVRE_ANNULEE', ancien: 'EN_COURS', nouveau: 'A_EXECUTER', commentaire: `${ref} annulée : la décision reste à exécuter` });
      await notify(d.decideur_user_id, { type: 'DECISION', titre: `Mise en œuvre annulée : ${d.libelle}`, message: `${d.reference} — ${ref}`, lien: `/decisions/${d.id}` });
      n += 1;
    }
  }
  return n;
}

module.exports = { STATUTS, OUVERTES, scopeDecisions, synchroniser };

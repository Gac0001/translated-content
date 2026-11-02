'use strict';
/**
 * Statistiques consolidées. Les Divisions et les Bureaux directement rattachés à la Direction
 * sont toujours présentés dans des catégories distinctes : le Bureau Secrétariat de Direction
 * n’est jamais comptabilisé comme une Division.
 */
const db = require('../db/knex');

const DONE = ['EXECUTEE', 'VALIDEE', 'CLOTUREE'];

function countBy(rows, key) {
  return rows.reduce((acc, r) => { acc[r[key]] = (acc[r[key]] || 0) + Number(r.n); return acc; }, {});
}

/** Indicateurs de performance par structure, pour une période optionnelle [du, au]. */
async function performanceParStructure({ du, au, divisionId, bureauId } = {}) {
  const period = (q, col) => { if (du) q.where(col, '>=', du); if (au) q.where(col, '<', db.raw('?::date + 1', [au])); return q; };
  const divisions = await db('divisions').where({ actif: true }).orderBy('ordre');
  const bureaux = await db('bureaux').where({ actif: true }).orderBy('ordre');
  const agents = await db('affectations').where({ est_active: true }).select('division_id', 'bureau_id', 'niveau');
  const tasks = await period(db('tasks'), 'created_at').select('division_id', 'bureau_id', 'statut', 'echeance');
  const instr = await period(db('instructions'), 'created_at').whereNot('statut', 'BROUILLON').select('division_id', 'bureau_id', 'statut');
  const docs = await period(db('documents'), 'created_at').select('division_id', 'bureau_id', 'statut');

  const agg = (filter) => {
    const t = tasks.filter(filter);
    const i = instr.filter(filter);
    const d = docs.filter(filter);
    const total = t.length + i.length;
    const faits = t.filter((x) => DONE.includes(x.statut)).length + i.filter((x) => DONE.includes(x.statut)).length;
    return {
      agents: agents.filter(filter).length,
      taches: t.length, tachesTerminees: t.filter((x) => DONE.includes(x.statut)).length, tachesEnRetard: t.filter((x) => x.statut === 'EN_RETARD').length,
      instructions: i.length, instructionsExecutees: i.filter((x) => DONE.includes(x.statut)).length, instructionsEnRetard: i.filter((x) => x.statut === 'EN_RETARD').length,
      documents: d.length, documentsValides: d.filter((x) => ['VALIDE', 'PUBLIE', 'ARCHIVE'].includes(x.statut)).length,
      tauxExecution: total ? Math.round((faits / total) * 100) : null,
    };
  };

  const bureauStats = (b) => ({ id: b.id, code: b.code, nom: b.nom, rangOrganique: 'BUREAU', rattachement: b.parent_type, divisionId: b.division_id, ...agg((x) => x.bureau_id === b.id) });
  let divisionsOut = divisions.map((d) => ({
    id: d.id, code: d.code, nom: d.nom, rangOrganique: 'DIVISION', ...agg((x) => x.division_id === d.id),
    bureaux: bureaux.filter((b) => b.division_id === d.id).map(bureauStats),
  }));
  let bureauxDirection = bureaux.filter((b) => b.parent_type === 'DIRECTION').map(bureauStats);
  if (divisionId) { divisionsOut = divisionsOut.filter((d) => d.id === divisionId); bureauxDirection = []; }
  if (bureauId) {
    divisionsOut = divisionsOut.map((d) => ({ ...d, bureaux: d.bureaux.filter((b) => b.id === bureauId) })).filter((d) => d.bureaux.length);
    bureauxDirection = bureauxDirection.filter((b) => b.id === bureauId);
  }
  return { divisions: divisionsOut, bureauxRattachesDirection: bureauxDirection };
}

async function statutsCount(table, where = (q) => q) {
  return countBy(await where(db(table)).select('statut').count('* as n').groupBy('statut'), 'statut');
}

module.exports = { performanceParStructure, statutsCount, countBy, DONE };

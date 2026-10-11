'use strict';
/**
 * Filtrage des données par périmètre administratif.
 * Une permission ne donne JAMAIS accès à toutes les données : chaque requête de liste
 * ou de lecture est restreinte au périmètre de l’utilisateur.
 */
const { forbidden } = require('../utils/errors');

/**
 * @param qb           query builder Knex
 * @param ctx          contexte utilisateur
 * @param opts.division colonne division_id
 * @param opts.bureau   colonne bureau_id
 * @param opts.personal colonnes contenant un user_id (émetteur, destinataire, auteur…)
 */
function applyScope(qb, ctx, { division, bureau, personal = [], extra } = {}) {
  const personalWhere = (w) => {
    for (const c of personal) w.orWhere(c, ctx.userId);
    if (extra) extra(w);
  };
  switch (ctx.perimetre) {
    case 'SUPERVISION_GLOBALE':
    case 'DIRECTION':
      return qb;
    case 'DIVISION':
      return qb.where((w) => { if (division) w.where(division, ctx.divisionId); personalWhere(w); });
    case 'BUREAU':
      return qb.where((w) => { if (bureau) w.where(bureau, ctx.bureauId); personalWhere(w); });
    case 'PERSONNEL':
      return qb.where((w) => { w.whereRaw('false'); personalWhere(w); });
    default:
      return qb.whereRaw('false');
  }
}

/** Vérifie qu’une ligne unique appartient au périmètre. */
function inScope(ctx, row, { personal = [], extraCheck } = {}) {
  if (!row) return false;
  if (personal.some((c) => row[c] === ctx.userId)) return true;
  if (extraCheck && extraCheck(row)) return true;
  switch (ctx.perimetre) {
    case 'SUPERVISION_GLOBALE':
    case 'DIRECTION':
      return true;
    case 'DIVISION':
      return row.division_id != null && row.division_id === ctx.divisionId;
    case 'BUREAU':
      return row.bureau_id != null && row.bureau_id === ctx.bureauId;
    default:
      return false;
  }
}

function assertInScope(ctx, row, opts) {
  if (!inScope(ctx, row, opts)) throw forbidden('Cet élément est hors de votre périmètre administratif.', 'HORS_PERIMETRE');
}

/** Le Secrétaire Général ne modifie jamais les données opérationnelles de la DEP. */
function assertNotReadOnly(ctx) {
  if (ctx.perimetre === 'SUPERVISION_GLOBALE') {
    throw forbidden('Le Secrétaire Général dispose d’un accès de supervision en lecture : il ne modifie pas les données opérationnelles de la DEP.', 'LECTURE_SEULE');
  }
}

module.exports = { applyScope, inScope, assertInScope, assertNotReadOnly };

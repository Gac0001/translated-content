'use strict';
/**
 * Chaîne hiérarchique de la DEP.
 *
 *   Secrétaire Général → Directeur → Chef de Division → Chef de Bureau → Agent
 *   Directeur → Chef du Bureau Secrétariat de Direction → Agents du Bureau Secrétariat
 *
 * Chaque utilisateur fonctionnel occupe un « nœud ». Le parent d’un nœud Bureau dépend
 * uniquement de son RATTACHEMENT (Division ou Direction) ; son RANG reste Bureau.
 */
const db = require('../db/knex');
const { FUNCTIONAL_ORDER, ROLE_LIBELLES } = require('../constants');

function nodeFrom({ userId, primaryRole, directionId, divisionId, bureauId, rattacheDirection, perimetre }) {
  switch (primaryRole) {
    case 'SECRETAIRE_GENERAL': return { key: 'SG', parent: null, role: primaryRole };
    case 'DIRECTEUR': return { key: `DIR:${directionId}`, parent: 'SG', role: primaryRole };
    case 'CHEF_DIVISION':
      if (perimetre !== 'DIVISION') return null;
      return { key: `DIV:${divisionId}`, parent: `DIR:${directionId}`, role: primaryRole };
    case 'CHEF_BUREAU':
      if (!bureauId) return null;
      return {
        key: `BUR:${bureauId}`,
        // Le parent dépend uniquement du RATTACHEMENT (Direction ou Division), jamais du rang.
        parent: rattacheDirection ? `DIR:${directionId}` : `DIV:${divisionId}`,
        role: primaryRole,
      };
    case 'AGENT':
      if (!bureauId) return null;
      return { key: `AGT:${userId}`, parent: `BUR:${bureauId}`, role: primaryRole };
    default: return null; // Admin : aucune place dans la chaîne administrative
  }
}

/** Charge en une requête tous les comptes actifs avec leur nœud hiérarchique. */
async function loadAllNodes(trx = db) {
  const rows = await trx('users as u')
    .leftJoin('agents as ag', 'ag.id', 'u.agent_id')
    .leftJoin('affectations as a', function j() { this.on('a.agent_id', 'u.agent_id').andOn('a.est_active', db.raw('true')); })
    .leftJoin('bureaux as b', 'b.id', 'a.bureau_id')
    .leftJoin('divisions as d', 'd.id', 'a.division_id')
    .where('u.statut', '<>', 'DESACTIVE')
    .select('u.id as user_id', 'u.username', 'ag.nom', 'ag.postnom', 'ag.prenom', 'a.niveau', 'a.direction_id', 'a.division_id',
      'a.bureau_id', 'b.nom as bureau_nom', 'b.est_secretariat_direction', 'b.parent_type', 'd.nom as division_nom',
      db.raw(`ARRAY(SELECT r.code FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = u.id) as roles`));
  const dep = await trx('directions').where({ code: 'DEP' }).first();
  return rows.map((r) => {
    const primaryRole = FUNCTIONAL_ORDER.find((x) => r.roles.includes(x)) || null;
    const perimetre = primaryRole === 'CHEF_DIVISION' ? (r.niveau === 'DIVISION' ? 'DIVISION' : 'PERSONNEL') : null;
    const node = nodeFrom({
      userId: r.user_id, primaryRole, directionId: r.direction_id || (dep && dep.id), divisionId: r.division_id,
      bureauId: r.bureau_id, rattacheDirection: r.parent_type === 'DIRECTION', perimetre,
    });
    return {
      userId: r.user_id, username: r.username, primaryRole, node,
      nomComplet: [r.prenom, r.nom, r.postnom].filter(Boolean).join(' ') || r.username,
      roleLibelle: ROLE_LIBELLES[primaryRole] || '',
      structure: r.bureau_nom || r.division_nom || (primaryRole === 'DIRECTEUR' ? 'Direction d’Études et Planification' : primaryRole === 'SECRETAIRE_GENERAL' ? 'Secrétariat Général' : ''),
      divisionId: r.division_id, bureauId: r.bureau_id, inSecretariat: !!r.est_secretariat_direction,
    };
  });
}

function ctxNode(ctx) {
  return nodeFrom({ ...ctx, rattacheDirection: !!(ctx.affectation && ctx.affectation.parent_type === 'DIRECTION') });
}

/** Relation directe entre deux nœuds : DESCENDANT (from est le supérieur direct de to), ASCENDANT, ou null. */
function relation(fromNode, toNode) {
  if (!fromNode || !toNode) return null;
  if (toNode.parent === fromNode.key) return 'DESCENDANT';
  if (fromNode.parent === toNode.key) return 'ASCENDANT';
  return null;
}

async function nodeOfUser(userId, trx = db) {
  const all = await loadAllNodes(trx);
  return all.find((n) => n.userId === userId) || null;
}

/** Destinataires possibles selon le sens (DESCENDANT = subordonnés directs, ASCENDANT = supérieur direct). */
async function directContacts(ctx, sens) {
  const me = ctxNode(ctx);
  if (!me) return [];
  const all = await loadAllNodes();
  return all.filter((n) => n.userId !== ctx.userId && n.node && (
    (sens === 'DESCENDANT' && n.node.parent === me.key)
    || (sens === 'ASCENDANT' && me.parent === n.node.key)
    || (!sens && (n.node.parent === me.key || me.parent === n.node.key))
  ));
}

module.exports = { nodeFrom, ctxNode, relation, loadAllNodes, nodeOfUser, directContacts };

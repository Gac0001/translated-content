'use strict';
/**
 * Construction du contexte d’autorisation d’un utilisateur :
 * rôles, permissions effectives, affectation administrative, périmètre hiérarchique.
 *
 * Règle clé : un utilisateur affecté au Bureau Secrétariat de Direction conserve
 * le périmètre BUREAU et ne reçoit jamais les permissions réservées aux Divisions,
 * même si une incohérence existait en base (défense en profondeur).
 */
const db = require('../db/knex');
const { FUNCTIONAL_ORDER, DIVISION_ONLY_PERMISSIONS, PERIMETRES } = require('../constants');

async function loadAffectation(agentId, trx = db) {
  if (!agentId) return null;
  return trx('affectations as a')
    .leftJoin('bureaux as b', 'b.id', 'a.bureau_id')
    .leftJoin('divisions as d', 'd.id', 'a.division_id')
    .leftJoin('postes_organiques as p', 'p.id', 'a.poste_id')
    .where({ 'a.agent_id': agentId, 'a.est_active': true })
    .first(
      'a.*', 'b.nom as bureau_nom', 'b.code as bureau_code', 'b.est_secretariat_direction', 'b.parent_type',
      'd.nom as division_nom', 'd.code as division_code', 'p.libelle as poste_libelle', 'p.role_associe',
    );
}

function computePerimetre(primaryRole, aff) {
  switch (primaryRole) {
    case 'ADMIN': return PERIMETRES.SYSTEME;
    case 'SECRETAIRE_GENERAL': return PERIMETRES.SUPERVISION_GLOBALE;
    case 'DIRECTEUR': return PERIMETRES.DIRECTION;
    case 'CHEF_DIVISION':
      // Un Chef de Division doit être affecté au niveau d’une Division (jamais dans un Bureau).
      return aff && aff.niveau === 'DIVISION' && aff.division_id ? PERIMETRES.DIVISION : PERIMETRES.PERSONNEL;
    case 'CHEF_BUREAU':
      return aff && aff.bureau_id ? PERIMETRES.BUREAU : PERIMETRES.PERSONNEL;
    case 'AGENT': return PERIMETRES.PERSONNEL;
    default: return PERIMETRES.PERSONNEL;
  }
}

async function loadContext(userId, trx = db) {
  const user = await trx('users').where({ id: userId }).first();
  if (!user) return null;
  const roles = (await trx('user_roles as ur').join('roles as r', 'r.id', 'ur.role_id').where('ur.user_id', userId).select('r.code'))
    .map((r) => r.code);
  const rolePerms = await trx('user_roles as ur')
    .join('role_permissions as rp', 'rp.role_id', 'ur.role_id')
    .join('permissions as p', 'p.id', 'rp.permission_id')
    .where('ur.user_id', userId).distinct('p.code');
  const userPerms = await trx('user_permissions as up')
    .join('permissions as p', 'p.id', 'up.permission_id')
    .where('up.user_id', userId).whereNull('up.revoked_at').distinct('p.code');
  const permissions = new Set([...rolePerms, ...userPerms].map((p) => p.code));
  const delegations = userPerms.map((p) => p.code);

  const agent = user.agent_id ? await trx('agents').where({ id: user.agent_id }).first() : null;
  const aff = await loadAffectation(user.agent_id, trx);
  const primaryRole = FUNCTIONAL_ORDER.find((r) => roles.includes(r)) || (roles.includes('ADMIN') ? 'ADMIN' : null);
  let perimetre = computePerimetre(primaryRole, aff);
  const inSecretariat = !!(aff && aff.est_secretariat_direction);

  if (inSecretariat) {
    for (const p of DIVISION_ONLY_PERMISSIONS) permissions.delete(p);
    if (perimetre === PERIMETRES.DIVISION) perimetre = PERIMETRES.BUREAU;
    // Les membres du Bureau Secrétariat de Direction enrôlent les agents des autres structures
    // (accordé par la structure d’affectation, quel que soit le rôle).
    if (user.statut === 'ACTIF') permissions.add('comptes.enroler');
  }
  // Un rôle Chef de Division sans affectation de Division ne confère pas les permissions de Division.
  if (primaryRole === 'CHEF_DIVISION' && perimetre !== PERIMETRES.DIVISION) {
    for (const p of DIVISION_ONLY_PERMISSIONS) permissions.delete(p);
  }

  const ctx = {
    userId: user.id,
    username: user.username,
    statut: user.statut,
    mustChangePassword: user.must_change_password,
    tokenVersion: user.token_version,
    agentId: user.agent_id,
    agent,
    affectation: aff,
    roles,
    primaryRole,
    perimetre,
    permissions,
    delegations,
    directionId: aff ? aff.direction_id : null,
    divisionId: aff ? aff.division_id : null,
    bureauId: aff ? aff.bureau_id : null,
    inSecretariat,
    isAdminOnly: roles.length > 0 && roles.every((r) => r === 'ADMIN'),
    // Portée de l’enrôlement : l’Admin enrôle tous les agents, le Secrétariat ceux des autres structures.
    enrolement: roles.includes('ADMIN') ? 'TOUS' : inSecretariat ? 'HORS_SECRETARIAT' : null,
  };
  ctx.can = (perm) => ctx.permissions.has(perm);
  return ctx;
}

function publicContext(ctx) {
  const a = ctx.agent;
  const aff = ctx.affectation;
  return {
    id: ctx.userId,
    username: ctx.username,
    mustChangePassword: ctx.mustChangePassword,
    roles: ctx.roles,
    primaryRole: ctx.primaryRole,
    perimetre: ctx.perimetre,
    permissions: [...ctx.permissions].sort(),
    delegations: ctx.delegations,
    inSecretariat: ctx.inSecretariat,
    agent: a ? { id: a.id, matricule: a.matricule, nom: a.nom, postnom: a.postnom, prenom: a.prenom, sexe: a.sexe, email: a.email, telephone: a.telephone, hasPhoto: !!a.photo_path } : null,
    affectation: aff ? {
      niveau: aff.niveau, directionId: aff.direction_id, divisionId: aff.division_id, divisionNom: aff.division_nom,
      bureauId: aff.bureau_id, bureauNom: aff.bureau_nom, poste: aff.poste_libelle, dateDebut: aff.date_debut,
    } : null,
  };
}

module.exports = { loadContext, loadAffectation, publicContext, computePerimetre };

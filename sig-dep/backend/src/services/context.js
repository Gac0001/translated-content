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
const { politique } = require('./politique');
const { interimsEnVigueur, appliquerInterims, aujourdhui } = require('./interims');

/**
 * Rôles soumis aux exigences renforcées (double authentification, récupération, règles) :
 * Admin Système, Directeur et Secrétaire Général (cahier des charges, §§ 12 à 14).
 */
const ROLES_RENFORCES = ['ADMIN_SYSTEME', 'DIRECTEUR', 'SECRETAIRE_GENERAL'];

/**
 * Étapes de sécurité à accomplir avant d’accéder à l’application, dans l’ordre :
 * mot de passe (temporaire ou expiré), double authentification, e-mail de récupération, règles.
 */
function calculerExigences(user, roles, pol) {
  const ex = [];
  const expire = pol.mdp_expiration_jours > 0 && user.password_changed_at
    && (Date.now() - new Date(user.password_changed_at).getTime()) > pol.mdp_expiration_jours * 86400000;
  if (user.must_change_password || expire) ex.push('MOT_DE_PASSE');
  if (user.compte_urgence) {
    // Compte d’urgence : nouveau mot de passe et double authentification à chaque activation.
    if (!user.totp_actif) ex.push('DEUX_FACTEURS');
  } else if (roles.some((r) => ROLES_RENFORCES.includes(r))) {
    if (!user.totp_actif) ex.push('DEUX_FACTEURS');
    // Adresse de récupération obligatoire ; sa vérification (code par e-mail) est demandée lorsque la
    // messagerie est active, sans bloquer le compte (elle conditionne la récupération par e-mail).
    if (!user.email_recuperation) ex.push('EMAIL_RECUPERATION');
    if ((user.regles_acceptees_version || 0) < pol.regles_securite_version) ex.push('REGLES');
  }
  return { exigences: ex, mdpExpire: !!expire && !user.must_change_password };
}

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
    case 'ADMIN_SYSTEME': return PERIMETRES.SYSTEME;
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
  const rolesPermanents = (await trx('user_roles as ur').join('roles as r', 'r.id', 'ur.role_id').where('ur.user_id', userId).select('r.code'))
    .map((r) => r.code);
  const agent = user.agent_id ? await trx('agents').where({ id: user.agent_id }).first() : null;
  // Intérims en vigueur : rôle et périmètre du poste exercé, suspension du titulaire absent.
  const situation = appliquerInterims({
    agentId: user.agent_id, roles: rolesPermanents, affectation: await loadAffectation(user.agent_id, trx),
  }, await interimsEnVigueur(trx));
  const { roles } = situation;
  const aff = situation.affectation;
  const rolePerms = roles.length ? await trx('roles as r')
    .join('role_permissions as rp', 'rp.role_id', 'r.id')
    .join('permissions as p', 'p.id', 'rp.permission_id')
    .whereIn('r.code', roles).distinct('p.code') : [];
  // Désignations : uniquement pendant leur période, et tant qu’un droit accordé sans acte n’a pas dépassé son délai de régularisation.
  const jour = aujourdhui();
  const userPerms = await trx('user_permissions as up')
    .join('permissions as p', 'p.id', 'up.permission_id')
    .where('up.user_id', userId).whereNull('up.revoked_at')
    .where((w) => w.whereNull('up.date_debut').orWhere('up.date_debut', '<=', jour))
    .where((w) => w.whereNull('up.date_fin').orWhere('up.date_fin', '>=', jour))
    .where((w) => w.whereNull('up.a_regulariser_avant').orWhere('up.a_regulariser_avant', '>', trx.fn.now()))
    .distinct('p.code');
  const permissions = new Set([...rolePerms, ...userPerms].map((p) => p.code));
  const delegations = userPerms.map((p) => p.code);
  const primaryRole = FUNCTIONAL_ORDER.find((r) => roles.includes(r)) || (roles.includes('ADMIN_SYSTEME') ? 'ADMIN_SYSTEME' : null);
  let perimetre = computePerimetre(primaryRole, aff);
  const inSecretariat = !!(aff && aff.est_secretariat_direction);
  const pol = await politique();
  // Exigences renforcées dès que le rôle est détenu, à titre permanent ou par intérim.
  const { exigences, mdpExpire } = calculerExigences(user, [...new Set([...rolesPermanents, ...roles])], pol);

  if (inSecretariat) {
    for (const p of DIVISION_ONLY_PERMISSIONS) permissions.delete(p);
    if (perimetre === PERIMETRES.DIVISION) perimetre = PERIMETRES.BUREAU;
    // Les membres du Bureau Secrétariat de Direction enrôlent les agents des autres structures
    // (accordé par la structure d’affectation, quel que soit le rôle).
    if (user.statut === 'ACTIF') {
      permissions.add('compte.enroler');
      // Le Secrétariat prépare l’enregistrement des actes administratifs, validés par le Directeur.
      permissions.add('actes.preparer');
    }
  }
  // Un rôle Chef de Division sans affectation de Division ne confère pas les permissions de Division.
  if (primaryRole === 'CHEF_DIVISION' && perimetre !== PERIMETRES.DIVISION) {
    for (const p of DIVISION_ONLY_PERMISSIONS) permissions.delete(p);
  }

  const ctx = {
    userId: user.id,
    username: user.username,
    statut: user.statut,
    mustChangePassword: user.must_change_password || exigences.includes('MOT_DE_PASSE'),
    exigences,
    mdpExpire,
    deuxFacteursActif: user.totp_actif,
    emailRecuperation: user.email_recuperation,
    emailRecuperationVerifie: !!user.email_recuperation_verifie_at,
    sessionInactiviteMinutes: pol.session_inactivite_minutes,
    tokenVersion: user.token_version,
    agentId: user.agent_id,
    agent,
    affectation: aff,
    roles,
    rolesPermanents,
    primaryRole,
    interim: situation.interim ? {
      acteId: situation.interim.acte_id, numero: situation.interim.numero, reference: situation.interim.reference,
      poste: situation.interim.poste_libelle, role: situation.interim.role_associe, dateDebut: situation.interim.date_debut, dateFin: situation.interim.date_fin,
    } : null,
    suspensions: situation.suspensions.map((x) => ({ acteId: x.acte_id, poste: x.poste_libelle, interimaire: x.interimaire, dateFin: x.date_fin })),
    perimetre,
    permissions,
    delegations,
    directionId: aff ? aff.direction_id : null,
    divisionId: aff ? aff.division_id : null,
    bureauId: aff ? aff.bureau_id : null,
    inSecretariat,
    isAdminOnly: roles.length > 0 && roles.every((r) => r === 'ADMIN_SYSTEME'),
    compteUrgence: !!user.compte_urgence,
    urgenceJusqua: user.urgence_jusqua,
    // Portée de l’enrôlement : l’Admin enrôle uniquement les agents du Secrétariat autorisés
    // nominativement par le Directeur ; le Secrétariat enrôle les agents des autres structures.
    enrolement: roles.includes('ADMIN_SYSTEME') ? 'SECRETARIAT_AUTORISE' : inSecretariat ? 'HORS_SECRETARIAT' : null,
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
    exigences: ctx.exigences,
    mdpExpire: ctx.mdpExpire,
    deuxFacteursActif: ctx.deuxFacteursActif,
    emailRecuperation: ctx.emailRecuperation,
    emailRecuperationVerifie: ctx.emailRecuperationVerifie,
    sessionInactiviteMinutes: ctx.sessionInactiviteMinutes,
    roles: ctx.roles,
    primaryRole: ctx.primaryRole,
    perimetre: ctx.perimetre,
    permissions: [...ctx.permissions].sort(),
    delegations: ctx.delegations,
    designations: ctx.delegations,
    interim: ctx.interim,
    suspensions: ctx.suspensions,
    inSecretariat: ctx.inSecretariat,
    compteUrgence: ctx.compteUrgence,
    urgenceJusqua: ctx.urgenceJusqua,
    agent: a ? { id: a.id, matricule: a.matricule, nom: a.nom, postnom: a.postnom, prenom: a.prenom, sexe: a.sexe, email: a.email, telephone: a.telephone, hasPhoto: !!a.photo_path } : null,
    affectation: aff ? {
      niveau: aff.niveau, directionId: aff.direction_id, divisionId: aff.division_id, divisionNom: aff.division_nom,
      bureauId: aff.bureau_id, bureauNom: aff.bureau_nom, poste: aff.poste_libelle, dateDebut: aff.date_debut, interim: !!aff.interim,
    } : null,
  };
}

module.exports = { loadContext, loadAffectation, publicContext, computePerimetre, calculerExigences, ROLES_RENFORCES };

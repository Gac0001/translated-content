'use strict';
/**
 * Comptes utilisateurs, rôles, permissions et désignations.
 *
 * Circuit :
 *  - l’Admin crée les comptes institutionnels initiaux (Secrétaire Général, Directeur) ;
 *  - le Directeur crée/autorise les comptes de la DEP ;
 *  - le Bureau Secrétariat de Direction peut PRÉPARER des comptes sur désignation du Directeur
 *    (comptes créés désactivés, en attente d’autorisation du Directeur) ;
 *  - les désignations temporaires reposent sur un acte (module actes) et expirent d’elles-mêmes ;
 *  - les rôles d’autorité ne s’attribuent ou ne se retirent que sur un acte validé.
 */
const express = require('express');
const bcrypt = require('bcrypt');
const { z } = require('zod');
const db = require('../../db/knex');
const validate = require('../../middleware/validate');
const { requirePerm } = require('../../middleware/auth');
const { audit } = require('../../services/audit');
const { notify } = require('../../services/notifications');
const { alerter } = require('../../services/alertes');
const { politique } = require('../../services/politique');
const { revokeAllForUser } = require('../../services/tokens');
const { temporaryPassword } = require('../../utils/password');
const { notFound, badRequest, forbidden, conflict } = require('../../utils/errors');
const { ROLE_LIBELLES } = require('../../constants');
const { aujourdhui } = require('../../services/interims');

const router = express.Router();
const idParam = z.object({ id: z.coerce.number().int().positive() });
const usernameSchema = z.string().trim().toLowerCase().min(3).max(60).regex(/^[a-z0-9._-]+$/, 'lettres minuscules, chiffres, point, tiret uniquement');

const DEP_ROLES = ['CHEF_DIVISION', 'CHEF_BUREAU', 'AGENT'];
// Permissions techniques : réservées au rôle Admin Système, jamais attribuables aux rôles institutionnels.
const MODULES_TECHNIQUES = ['systeme', 'securite', 'sauvegarde', 'audit', 'role', 'session', 'carte'];
const PERMS_TECHNIQUES = ['compte.creer_initial', 'compte.deverrouiller', 'compte.reinitialiser_mot_de_passe', 'organisation.configurer', 'referentiel.gerer'];
const estTechnique = (p) => MODULES_TECHNIQUES.includes(p.module) || PERMS_TECHNIQUES.includes(p.code);
// Rôles d’autorité : leur attribution ou leur retrait exige une décision administrative enregistrée.
const ROLES_DECISION = ['ADMIN_SYSTEME', 'SECRETAIRE_GENERAL', 'DIRECTEUR', 'CHEF_DIVISION'];

async function rolesOf(userId, trx = db) {
  return (await trx('user_roles as ur').join('roles as r', 'r.id', 'ur.role_id').where('ur.user_id', userId).select('r.code')).map((r) => r.code);
}

async function userView(id) {
  const u = await db('users as u')
    .leftJoin('agents as ag', 'ag.id', 'u.agent_id')
    .leftJoin('affectations as a', function j() { this.on('a.agent_id', 'u.agent_id').andOn('a.est_active', db.raw('true')); })
    .leftJoin('bureaux as b', 'b.id', 'a.bureau_id').leftJoin('divisions as d', 'd.id', 'a.division_id')
    .leftJoin('users as au', 'au.id', 'u.autorise_par')
    .where('u.id', id)
    .first('u.id', 'u.username', 'u.statut', 'u.must_change_password', 'u.failed_attempts', 'u.locked_until', 'u.last_login_at', 'u.motif_blocage',
      'u.totp_actif', 'u.totp_active_at', 'u.email_recuperation_verifie_at', 'u.regles_acceptees_version', 'u.regles_acceptees_at', 'u.password_changed_at',
      db.raw(`case when u.email_recuperation is null then null else regexp_replace(u.email_recuperation, '^(.).*(@.*)$', '\\1•••\\2') end as email_recuperation`),
      'u.created_at', 'u.autorise_at', 'au.username as autorise_par_username', 'u.agent_id', 'ag.matricule', 'ag.nom', 'ag.postnom', 'ag.prenom',
      'ag.est_autorite', 'a.niveau', 'b.nom as bureau_nom', 'b.est_secretariat_direction', 'd.nom as division_nom');
  if (!u) return null;
  u.roles = await rolesOf(id);
  u.delegations = (await db('user_permissions as up').join('permissions as p', 'p.id', 'up.permission_id').leftJoin('users as g', 'g.id', 'up.granted_by')
    .leftJoin('actes_administratifs as x', 'x.id', 'up.acte_id')
    .where('up.user_id', id).whereNull('up.revoked_at')
    .select('up.id', 'p.code', 'p.libelle', 'up.granted_at', 'up.motif', 'g.username as granted_by', 'up.date_debut', 'up.date_fin', 'up.a_regulariser_avant', 'x.numero as acte_numero', 'up.acte_id'));
  u.designations = u.delegations;
  return u;
}

/** Le Directeur (et le Bureau Secrétariat par désignation) ne gère que les comptes de la DEP. */
async function assertManageable(ctx, targetId) {
  const target = await db('users').where({ id: targetId }).first();
  if (!target) throw notFound('Compte introuvable.');
  const roles = await rolesOf(targetId);
  if (ctx.primaryRole === 'ADMIN_SYSTEME' || ctx.roles.includes('ADMIN_SYSTEME')) return { target, roles };
  if (roles.includes('ADMIN_SYSTEME') || roles.includes('SECRETAIRE_GENERAL') || roles.includes('DIRECTEUR')) {
    throw forbidden('Ce compte institutionnel relève de l’administration technique du système.');
  }
  if (target.id === ctx.userId) throw forbidden('Vous ne pouvez pas modifier votre propre compte par cette opération.');
  return { target, roles };
}

async function checkRoleCoherence(agentId, roles, trx = db) {
  const aff = await trx('affectations as a').leftJoin('bureaux as b', 'b.id', 'a.bureau_id').leftJoin('postes_organiques as p', 'p.id', 'a.poste_id')
    .where({ 'a.agent_id': agentId, 'a.est_active': true }).first('a.*', 'b.est_secretariat_direction', 'p.role_associe');
  for (const r of roles) {
    if (r === 'CHEF_DIVISION') {
      if (!aff || aff.niveau !== 'DIVISION') throw badRequest('Le rôle Chef de Division exige une affectation au niveau d’une Division.');
      if (aff.est_secretariat_direction) throw forbidden('Le Bureau Secrétariat de Direction n’est pas une Division : son Chef ne peut recevoir le rôle Chef de Division.', 'SECRETARIAT_DIVISION_PERMISSION');
    }
    if (r === 'CHEF_BUREAU' && (!aff || aff.niveau !== 'BUREAU' || aff.role_associe !== 'CHEF_BUREAU')) {
      throw badRequest('Le rôle Chef de Bureau exige une affectation au poste de Chef de Bureau.');
    }
    if (r === 'AGENT' && (!aff || aff.niveau !== 'BUREAU')) throw badRequest('Le rôle Agent exige une affectation dans un Bureau.');
    if (r === 'DIRECTEUR' && (!aff || aff.niveau !== 'DIRECTION')) throw badRequest('Le rôle Directeur exige une affectation au niveau de la Direction.');
  }
}

async function setRoles(trx, userId, roles, grantedBy) {
  const ids = await trx('roles').whereIn('code', roles).select('id', 'code');
  if (ids.length !== roles.length) throw badRequest('Rôle inconnu.');
  await trx('user_roles').where({ user_id: userId }).del();
  if (ids.length) await trx('user_roles').insert(ids.map((r) => ({ user_id: userId, role_id: r.id, granted_by: grantedBy })));
}

// ─── Consultation ───────────────────────────────────────────────────────────
router.get('/', requirePerm('compte.consulter'), validate({ query: z.object({ q: z.string().max(80).optional(), statut: z.enum(['ACTIF', 'DESACTIVE', 'VERROUILLE']).optional(), role: z.string().max(40).optional(), inactifs: z.enum(['1', 'true']).optional() }) }), async (req, res) => {
  const { q, statut, role, inactifs } = req.valid.query;
  const seuil = (await politique()).inactivite_compte_jours;
  const query = db('users as u')
    .leftJoin('agents as ag', 'ag.id', 'u.agent_id')
    .leftJoin('affectations as a', function j() { this.on('a.agent_id', 'u.agent_id').andOn('a.est_active', db.raw('true')); })
    .leftJoin('bureaux as b', 'b.id', 'a.bureau_id').leftJoin('divisions as d', 'd.id', 'a.division_id')
    .select('u.id', 'u.username', 'u.statut', 'u.must_change_password', 'u.last_login_at', 'u.locked_until', 'u.created_at', 'u.autorise_par', 'u.totp_actif', 'u.motif_blocage',
      db.raw(`(u.statut <> 'DESACTIVE' and coalesce(u.last_login_at, u.created_at) < now() - make_interval(days => ?)) as inactif`, [seuil]),
      'ag.matricule', 'ag.nom', 'ag.postnom', 'ag.prenom', 'b.nom as bureau_nom', 'd.nom as division_nom',
      db.raw(`ARRAY(SELECT r.code FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = u.id) as roles`))
    .orderBy('u.username');
  if (!req.ctx.roles.includes('ADMIN_SYSTEME')) {
    // Directeur / Bureau Secrétariat : uniquement les comptes des Agents de la DEP
    query.whereNotExists(db('user_roles as ur').join('roles as r', 'r.id', 'ur.role_id').whereRaw('ur.user_id = u.id').whereIn('r.code', ['ADMIN_SYSTEME', 'SECRETAIRE_GENERAL']));
  }
  if (q) query.where((w) => w.whereILike('u.username', `%${q}%`).orWhereILike('ag.nom', `%${q}%`).orWhereILike('ag.prenom', `%${q}%`));
  if (statut) query.where('u.statut', statut);
  if (inactifs) query.whereNot('u.statut', 'DESACTIVE').whereRaw('coalesce(u.last_login_at, u.created_at) < now() - make_interval(days => ?)', [seuil]);
  if (role) query.whereExists(db('user_roles as ur').join('roles as r', 'r.id', 'ur.role_id').whereRaw('ur.user_id = u.id').where('r.code', role));
  res.json({ data: await query, seuilInactiviteJours: seuil });
});

router.get('/roles', requirePerm('compte.consulter', 'role.attribuer'), async (req, res) => {
  const roles = await db('roles').orderBy('id');
  const perms = await db('permissions').orderBy(['module', 'code']);
  const rp = await db('role_permissions as rp').join('roles as r', 'r.id', 'rp.role_id').join('permissions as p', 'p.id', 'rp.permission_id').select('r.code as role', 'p.code as permission');
  res.json({
    roles: roles.map((r) => ({ ...r, permissions: rp.filter((x) => x.role === r.code).map((x) => x.permission) })),
    permissions: perms,
  });
});

/** État d’une désignation à la date du jour. */
function etatDesignation(d, jour = aujourdhui()) {
  if (d.revoked_at) return 'RETIREE';
  if (!d.acte_id) return 'A_REGULARISER';
  if (d.date_debut && String(d.date_debut) > jour) return 'A_VENIR';
  if (d.date_fin && String(d.date_fin) < jour) return 'ECHUE';
  return 'EN_VIGUEUR';
}

router.get('/designations', requirePerm('designations.gerer'), async (req, res) => {
  const rows = await db('user_permissions as up').join('permissions as p', 'p.id', 'up.permission_id').join('users as u', 'u.id', 'up.user_id')
    .leftJoin('agents as ag', 'ag.id', 'u.agent_id').leftJoin('users as g', 'g.id', 'up.granted_by')
    .leftJoin('actes_administratifs as x', 'x.id', 'up.acte_id')
    .select('up.*', 'p.code', 'p.libelle', 'u.username', 'ag.nom', 'ag.prenom', 'g.username as granted_by_username', 'x.numero as acte_numero', 'x.reference as acte_reference')
    .orderBy('up.granted_at', 'desc');
  res.json({
    data: rows.map((d) => ({ ...d, etat: etatDesignation(d) })),
    designables: await db('permissions').where({ delegable: true }).select('code', 'libelle'),
  });
});

router.delete('/designations/:id', requirePerm('designations.gerer'), validate({ params: idParam, body: z.object({ motif: z.string().trim().max(300).optional() }).optional() }), async (req, res) => {
  const row = await db('user_permissions').where({ id: req.valid.params.id }).whereNull('revoked_at').first();
  if (!row) throw notFound('Désignation introuvable.');
  const motif = (req.valid.body && req.valid.body.motif) || 'Retrait par le Directeur';
  await db('user_permissions').where({ id: row.id }).update({ revoked_at: db.fn.now(), revoked_by: req.ctx.userId, motif_revocation: motif });
  await audit(req, { action: 'REVOCATION_DESIGNATION', module: 'comptes', entite: 'user', entiteId: row.user_id, avant: row, message: motif });
  res.json({ message: 'Désignation retirée (conservée dans l’historique).' });
});

router.get('/:id', requirePerm('compte.consulter'), validate({ params: idParam }), async (req, res) => {
  const u = await userView(req.valid.params.id);
  if (!u) throw notFound('Compte introuvable.');
  if (!req.ctx.roles.includes('ADMIN_SYSTEME') && u.roles.some((r) => ['ADMIN_SYSTEME', 'SECRETAIRE_GENERAL'].includes(r))) throw forbidden();
  const connexions = await db('login_history').where({ user_id: u.id }).orderBy('created_at', 'desc').limit(30);
  const sessions = await db('refresh_tokens').where({ user_id: u.id }).whereNull('revoked_at').where('expires_at', '>', db.fn.now())
    .select('id', 'family_id', 'ip', 'user_agent', 'created_at', 'expires_at').orderBy('created_at', 'desc');
  res.json({ ...u, connexions, sessions });
});

// ─── Création des comptes institutionnels initiaux (Admin) ──────────────────
const initialSchema = z.object({
  type: z.enum(['SECRETAIRE_GENERAL', 'DIRECTEUR']),
  username: usernameSchema,
  matricule: z.string().trim().min(2).max(40),
  nom: z.string().trim().min(2).max(100),
  postnom: z.string().trim().max(100).optional().nullable(),
  prenom: z.string().trim().max(100).optional().nullable(),
  sexe: z.union([z.enum(['M', 'F']), z.literal('').transform(() => null), z.null()]).optional(), // facultatif : jamais déduit du prénom
  email: z.union([z.email(), z.literal('')]).optional().nullable().transform((v) => v || null),
  telephone: z.string().trim().max(40).optional().nullable(),
  date_prise_fonction: z.union([z.string().date(), z.literal('').transform(() => undefined)]).optional(),
});

router.post('/initial', requirePerm('compte.creer_initial'), validate({ body: initialSchema }), async (req, res) => {
  const b = req.valid.body;
  const existing = await db('users as u').join('user_roles as ur', 'ur.user_id', 'u.id').join('roles as r', 'r.id', 'ur.role_id')
    .where('r.code', b.type).whereNot('u.statut', 'DESACTIVE').first('u.id');
  if (existing) throw conflict(`Un compte ${ROLE_LIBELLES[b.type]} actif existe déjà. Désactivez-le avant d’en créer un nouveau.`);
  const temp = temporaryPassword();
  const hash = await bcrypt.hash(temp, 12);
  const dep = await db('directions').where({ code: 'DEP' }).first();
  const user = await db.transaction(async (trx) => {
    let agent = await trx('agents').where({ matricule: b.matricule }).first();
    if (!agent) {
      [agent] = await trx('agents').insert({
        matricule: b.matricule, nom: b.nom, postnom: b.postnom, prenom: b.prenom, sexe: b.sexe, email: b.email, telephone: b.telephone,
        est_autorite: b.type === 'SECRETAIRE_GENERAL',
        grade_id: (await trx('grades').where({ code: b.type === 'DIRECTEUR' ? 'DIR' : 'SG' }).first() || {}).id,
        fonction_id: (await trx('fonctions').where({ code: b.type === 'DIRECTEUR' ? 'F-DIR' : 'F-SG' }).first() || {}).id,
      }).returning('*');
    }
    if (b.type === 'DIRECTEUR') {
      const poste = await trx('postes_organiques').where({ niveau: 'DIRECTION', role_associe: 'DIRECTEUR' }).first();
      const cur = await trx('affectations').where({ agent_id: agent.id, est_active: true }).first();
      if (!cur || cur.niveau !== 'DIRECTION') {
        const other = await trx('affectations').where({ niveau: 'DIRECTION', est_active: true, poste_id: poste.id }).whereNot('agent_id', agent.id).first();
        if (other) await trx('affectations').where({ id: other.id }).update({ est_active: false, date_fin: trx.raw('CURRENT_DATE'), motif_cloture: 'Nomination d’un nouveau Directeur', closed_by: req.ctx.userId });
        if (cur) await trx('affectations').where({ id: cur.id }).update({ est_active: false, date_fin: trx.raw('CURRENT_DATE'), motif_cloture: 'Nomination comme Directeur', closed_by: req.ctx.userId });
        await trx('affectations').insert({ agent_id: agent.id, direction_id: dep.id, niveau: 'DIRECTION', poste_id: poste.id, date_debut: b.date_prise_fonction || new Date().toISOString().slice(0, 10), motif: 'Compte institutionnel initial', created_by: req.ctx.userId });
      }
    }
    if (await trx('users').where({ agent_id: agent.id }).first()) throw conflict('Cette personne possède déjà un compte.');
    const [u] = await trx('users').insert({ username: b.username, password_hash: hash, agent_id: agent.id, statut: 'ACTIF', must_change_password: true, created_by: req.ctx.userId }).returning('*');
    await setRoles(trx, u.id, [b.type], req.ctx.userId);
    return u;
  });
  await audit(req, { action: 'CREATION', module: 'comptes', entite: 'user', entiteId: user.id, apres: { username: user.username, role: b.type }, message: `Création du compte institutionnel initial (${ROLE_LIBELLES[b.type]})` });
  await notify(user.id, { type: 'COMPTE_CREE', titre: 'Votre compte SIG-DEP a été créé', message: 'Changez votre mot de passe temporaire.', lien: '/profil', expediteur: req.ctx.userId });
  res.status(201).json({ id: user.id, username: user.username, motDePasseTemporaire: temp, message: 'Compte créé. Communiquez le mot de passe temporaire de façon sécurisée : il devra être changé à la première connexion.' });
});

// Les comptes des agents de la DEP sont créés par enrôlement (module enrolement),
// uniquement pour les agents inscrits sur la liste déclarative validée.

// ─── Rôles d’un compte ──────────────────────────────────────────────────────
router.put('/:id/roles', requirePerm('role.attribuer'), validate({ params: idParam, body: z.object({ roles: z.array(z.enum(['ADMIN_SYSTEME', 'SECRETAIRE_GENERAL', 'DIRECTEUR', 'CHEF_DIVISION', 'CHEF_BUREAU', 'AGENT'])).min(1).max(3), acte_id: z.coerce.number().int().positive().optional().nullable() }) }), async (req, res) => {
  const { target, roles: before } = await assertManageable(req.ctx, req.valid.params.id);
  const roles = [...new Set(req.valid.body.roles)];
  const isAdmin = req.ctx.roles.includes('ADMIN_SYSTEME');
  if (!isAdmin && roles.some((r) => !DEP_ROLES.includes(r))) throw forbidden('Vous ne pouvez attribuer que les rôles Chef de Division, Chef de Bureau ou Agent.');
  // L’Admin ne fait jamais d’une personne un Directeur, un Chef de Division, un Secrétaire Général ou un Admin
  // (ni ne retire ces rôles) sans décision administrative enregistrée.
  const sensibles = ROLES_DECISION.filter((r) => roles.includes(r) !== before.includes(r));
  let acte = null;
  if (sensibles.length) {
    // Décision administrative : un acte validé (nomination, affectation ou fin de fonction) concernant cette personne.
    acte = req.valid.body.acte_id ? await db('actes_administratifs').where({ id: req.valid.body.acte_id, statut: 'VALIDE' })
      .whereIn('type', ['NOMINATION', 'AFFECTATION', 'FIN_FONCTION']).first() : null;
    if (!acte || !target.agent_id || acte.agent_id !== target.agent_id) {
      throw forbidden(`L’attribution ou le retrait du rôle ${sensibles.map((r) => ROLE_LIBELLES[r]).join(', ')} exige un acte validé (nomination, affectation ou fin de fonction) concernant cette personne : opération refusée.`, 'DECISION_ADMINISTRATIVE_REQUISE');
    }
  }
  if (target.id === req.ctx.userId && before.includes('ADMIN_SYSTEME') && !roles.includes('ADMIN_SYSTEME')) throw badRequest('Vous ne pouvez pas retirer votre propre rôle Admin.');
  if (target.agent_id) await checkRoleCoherence(target.agent_id, roles.filter((r) => r !== 'ADMIN_SYSTEME' && r !== 'SECRETAIRE_GENERAL'));
  else if (roles.some((r) => r !== 'ADMIN_SYSTEME')) throw badRequest('Un compte non lié à un Agent ne peut recevoir qu’un rôle technique.');
  await db.transaction(async (trx) => {
    await setRoles(trx, target.id, roles, req.ctx.userId);
    await trx('users').where({ id: target.id }).increment('token_version', 1);
  });
  await audit(req, { action: 'CHANGEMENT_ROLE', module: 'comptes', entite: 'user', entiteId: target.id, avant: { roles: before }, apres: { roles, acte: acte ? acte.numero : null }, message: acte ? `Sur l’acte ${acte.numero} (${acte.reference})` : null });
  res.json({ message: 'Rôles mis à jour.', roles });
});

// ─── Statut, mot de passe, sessions ─────────────────────────────────────────
router.post('/:id/activer', requirePerm('compte.activer'), validate({ params: idParam }), async (req, res) => {
  const { target } = await assertManageable(req.ctx, req.valid.params.id);
  await db('users').where({ id: target.id }).update({ statut: 'ACTIF', failed_attempts: 0, locked_until: null, updated_at: db.fn.now() });
  await audit(req, { action: 'ACTIVATION', module: 'comptes', entite: 'user', entiteId: target.id, avant: { statut: target.statut }, apres: { statut: 'ACTIF' } });
  res.json({ message: 'Compte activé.' });
});

router.post('/:id/desactiver', requirePerm('compte.desactiver'), validate({ params: idParam, body: z.object({ motif: z.string().trim().max(300).optional() }) }), async (req, res) => {
  const { target, roles } = await assertManageable(req.ctx, req.valid.params.id);
  if (target.id === req.ctx.userId) throw badRequest('Vous ne pouvez pas désactiver votre propre compte.');
  if (roles.includes('DIRECTEUR') || roles.includes('ADMIN_SYSTEME')) {
    await alerter({ type: 'DESACTIVATION_SENSIBLE', gravite: 'CRITIQUE', titre: `Désactivation du compte « ${target.username} » (${roles.map((r) => ROLE_LIBELLES[r]).join(', ')})`, message: `Par ${req.ctx.username}. Motif : ${req.valid.body.motif || 'non précisé'}.`, user: target, ip: req.ip });
  }
  await db.transaction(async (trx) => {
    await trx('users').where({ id: target.id }).update({ statut: 'DESACTIVE', updated_at: trx.fn.now() });
    await revokeAllForUser(target.id, 'DESACTIVATION', trx);
  });
  await audit(req, { action: 'DESACTIVATION', module: 'comptes', entite: 'user', entiteId: target.id, avant: { statut: target.statut }, apres: { statut: 'DESACTIVE' }, message: req.valid.body.motif });
  res.json({ message: 'Compte désactivé et sessions révoquées.' });
});

router.post('/:id/reinitialiser-mot-de-passe', requirePerm('compte.reinitialiser_mot_de_passe'), validate({ params: idParam }), async (req, res) => {
  const { target } = await assertManageable(req.ctx, req.valid.params.id);
  const temp = temporaryPassword();
  const hash = await bcrypt.hash(temp, 12);
  await db.transaction(async (trx) => {
    await trx('users').where({ id: target.id }).update({ password_hash: hash, must_change_password: true, failed_attempts: 0, locked_until: null, statut: target.statut === 'VERROUILLE' ? 'ACTIF' : target.statut, updated_at: trx.fn.now() });
    await revokeAllForUser(target.id, 'REINITIALISATION_MDP', trx);
  });
  await audit(req, { action: 'REINITIALISATION_MDP', module: 'comptes', entite: 'user', entiteId: target.id });
  await notify(target.id, { type: 'MDP_REINITIALISE', titre: 'Votre mot de passe a été réinitialisé', message: 'Vous devrez le changer à la prochaine connexion.', lien: '/profil', expediteur: req.ctx.userId });
  res.json({ motDePasseTemporaire: temp, message: 'Mot de passe réinitialisé. Il devra être changé à la prochaine connexion.' });
});

// Blocage temporaire d’un compte compromis (déblocage automatique à l’échéance)
router.post('/:id/bloquer', requirePerm('compte.desactiver'), validate({ params: idParam, body: z.object({ minutes: z.coerce.number().int().min(5).max(10080), motif: z.string().trim().min(3, 'motif requis').max(300) }) }), async (req, res) => {
  const { target } = await assertManageable(req.ctx, req.valid.params.id);
  if (target.id === req.ctx.userId) throw badRequest('Vous ne pouvez pas bloquer votre propre compte.');
  if (target.statut === 'DESACTIVE') throw badRequest('Ce compte est désactivé.');
  const jusqua = new Date(Date.now() + req.valid.body.minutes * 60000);
  await db.transaction(async (trx) => {
    await trx('users').where({ id: target.id }).update({ statut: 'VERROUILLE', locked_until: jusqua, motif_blocage: `Blocage par l’Admin : ${req.valid.body.motif}`, updated_at: trx.fn.now() });
    await revokeAllForUser(target.id, 'BLOCAGE', trx);
  });
  await audit(req, { action: 'BLOCAGE', module: 'comptes', entite: 'user', entiteId: target.id, avant: { statut: target.statut }, apres: { statut: 'VERROUILLE', jusqua }, message: req.valid.body.motif });
  await alerter({ type: 'BLOCAGE', gravite: 'ATTENTION', titre: `Compte « ${target.username} » bloqué temporairement`, message: `${req.valid.body.minutes} min — ${req.valid.body.motif}`, user: target, ip: req.ip });
  res.json({ message: `Compte bloqué jusqu’au ${jusqua.toLocaleString('fr-FR', { timeZone: 'Africa/Kinshasa' })} ; sessions révoquées.` });
});

// Changement de mot de passe imposé à la prochaine requête (sans révéler ni générer de mot de passe)
router.post('/:id/imposer-changement', requirePerm('compte.reinitialiser_mot_de_passe'), validate({ params: idParam }), async (req, res) => {
  const { target } = await assertManageable(req.ctx, req.valid.params.id);
  if (target.id === req.ctx.userId) throw badRequest('Changez votre propre mot de passe depuis votre profil.');
  await db('users').where({ id: target.id }).update({ must_change_password: true, updated_at: db.fn.now() });
  await audit(req, { action: 'CHANGEMENT_MDP_IMPOSE', module: 'comptes', entite: 'user', entiteId: target.id, message: 'Changement de mot de passe imposé' });
  await notify(target.id, { type: 'MDP_REINITIALISE', titre: 'Changement de mot de passe exigé', message: 'L’Admin Système vous demande de changer votre mot de passe : il vous sera demandé immédiatement.', lien: '/profil', expediteur: req.ctx.userId });
  res.json({ message: 'Le titulaire devra changer son mot de passe avant toute autre opération.' });
});

router.post('/:id/deverrouiller', requirePerm('compte.deverrouiller'), validate({ params: idParam }), async (req, res) => {
  const { target } = await assertManageable(req.ctx, req.valid.params.id);
  if (target.statut !== 'VERROUILLE') throw badRequest('Ce compte n’est pas verrouillé.');
  await db('users').where({ id: target.id }).update({ statut: 'ACTIF', failed_attempts: 0, locked_until: null, motif_blocage: null, updated_at: db.fn.now() });
  await audit(req, { action: 'DEVERROUILLAGE', module: 'comptes', entite: 'user', entiteId: target.id, avant: { statut: 'VERROUILLE' }, apres: { statut: 'ACTIF' } });
  res.json({ message: 'Compte déverrouillé.' });
});

router.post('/:id/revoquer-sessions', requirePerm('session.revoquer'), validate({ params: idParam }), async (req, res) => {
  const { target } = await assertManageable(req.ctx, req.valid.params.id);
  await revokeAllForUser(target.id, 'REVOCATION_ADMIN');
  await audit(req, { action: 'REVOCATION_SESSION', module: 'comptes', entite: 'user', entiteId: target.id });
  res.json({ message: 'Toutes les sessions de ce compte ont été révoquées.' });
});

// ─── Permissions des rôles (Admin) ──────────────────────────────────────────
router.put('/roles/:code/permissions', requirePerm('role.attribuer'), validate({ params: z.object({ code: z.string().max(40) }), body: z.object({ permissions: z.array(z.string().max(60)).max(200) }) }), async (req, res) => {
  const role = await db('roles').where({ code: req.valid.params.code }).first();
  if (!role) throw notFound('Rôle introuvable.');
  const perms = await db('permissions').whereIn('code', req.valid.body.permissions);
  if (perms.length !== new Set(req.valid.body.permissions).size) throw badRequest('Permission inconnue.');
  if (role.code === 'ADMIN_SYSTEME') {
    // Rôle protégé : sa modification exige une double validation (Directeur), non disponible ici.
    throw forbidden('Le rôle Admin Système est protégé : sa modification exige la validation du Directeur.', 'ROLE_PROTEGE');
  }
  const techniques = perms.filter(estTechnique);
  if (techniques.length) throw forbidden(`Permissions techniques incompatibles avec le rôle ${role.libelle} : ${techniques.map((p) => p.code).join(', ')}.`, 'PERMISSION_INCOMPATIBLE');
  if (['CHEF_BUREAU', 'AGENT', 'SECRETAIRE_GENERAL', 'ADMIN_SYSTEME'].includes(role.code)) {
    const bad = perms.filter((p) => p.reservee_division);
    if (bad.length) throw forbidden(`Les permissions réservées aux Divisions ne peuvent être attribuées au rôle ${role.libelle}.`, 'PERMISSION_DIVISION');
  }
  const before = (await db('role_permissions as rp').join('permissions as p', 'p.id', 'rp.permission_id').where('rp.role_id', role.id).pluck('p.code'));
  await db.transaction(async (trx) => {
    await trx('role_permissions').where({ role_id: role.id }).del();
    if (perms.length) await trx('role_permissions').insert(perms.map((p) => ({ role_id: role.id, permission_id: p.id })));
  });
  await audit(req, { action: 'CHANGEMENT_ROLE', module: 'comptes', entite: 'role', entiteId: role.code, avant: { permissions: before }, apres: { permissions: req.valid.body.permissions } });
  res.json({ message: 'Permissions du rôle mises à jour.' });
});

module.exports = router;
module.exports.setRoles = setRoles;
module.exports.checkRoleCoherence = checkRoleCoherence;
module.exports.usernameSchema = usernameSchema;

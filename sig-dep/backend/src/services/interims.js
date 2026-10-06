'use strict';
/**
 * Intérims en vigueur (cahier des charges, §§ 9 et 33).
 *
 * Un intérim ne crée pas un second titulaire : pendant sa période, l’intérimaire exerce le rôle
 * du poste dans le seul périmètre de ce poste, et le titulaire absent est suspendu de ce rôle.
 * Les effets sont calculés à chaque requête à partir des actes validés : ils commencent et
 * expirent d’eux-mêmes aux dates de l’acte, ou cessent dès sa révocation.
 */
const db = require('../db/knex');
const { FUNCTIONAL_ORDER } = require('../constants');

/** Date du jour à Kinshasa (AAAA-MM-JJ). */
function aujourdhui(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Kinshasa', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

const ROLES_COMMANDEMENT = ['DIRECTEUR', 'CHEF_DIVISION', 'CHEF_BUREAU'];
const LIBELLES_INTERIM = { DIRECTEUR: 'Directeur ad intérim', CHEF_DIVISION: 'Chef de Division ad intérim', CHEF_BUREAU: 'Chef de Bureau ad intérim' };

/** Intérims validés couvrant la date donnée, avec la structure du poste et ses occupants titulaires. */
async function interimsEnVigueur(trx = db, jour = aujourdhui()) {
  const rows = await trx('actes_administratifs as x')
    .join('postes_organiques as p', 'p.id', 'x.poste_id')
    .leftJoin('bureaux as b', 'b.id', 'p.bureau_id')
    .leftJoin('divisions as d', 'd.id', db.raw('COALESCE(b.division_id, p.division_id)'))
    .leftJoin('agents as ag', 'ag.id', 'x.agent_id')
    .leftJoin('users as u', 'u.agent_id', 'x.agent_id')
    .where({ 'x.type': 'INTERIM', 'x.statut': 'VALIDE' })
    .where('x.date_debut', '<=', jour).where('x.date_fin', '>=', jour)
    .select('x.id as acte_id', 'x.numero', 'x.reference', 'x.agent_id', 'x.poste_id', 'x.date_debut', 'x.date_fin',
      'p.libelle as poste_libelle', 'p.role_associe', 'p.niveau', 'p.direction_id', 'p.bureau_id',
      db.raw('COALESCE(b.division_id, p.division_id) as division_id'), 'b.nom as bureau_nom', 'b.code as bureau_code',
      'b.parent_type', 'b.est_secretariat_direction', 'd.nom as division_nom', 'd.code as division_code',
      'u.id as interimaire_user_id', 'ag.nom', 'ag.postnom', 'ag.prenom');
  if (!rows.length) return [];
  const occupants = await trx('affectations').where({ est_active: true }).whereIn('poste_id', rows.map((r) => r.poste_id)).select('poste_id', 'agent_id');
  return rows.map((r) => ({
    ...r,
    interimaire: [r.prenom, r.nom, r.postnom].filter(Boolean).join(' '),
    titulaires: occupants.filter((o) => o.poste_id === r.poste_id && o.agent_id !== r.agent_id).map((o) => o.agent_id),
  }));
}

/** Affectation effective de l’intérimaire : la structure du poste exercé (même forme que loadAffectation). */
function affectationInterim(i, base) {
  return {
    ...(base || {}),
    niveau: i.niveau, direction_id: i.direction_id, division_id: i.division_id, bureau_id: i.bureau_id,
    bureau_nom: i.bureau_nom, bureau_code: i.bureau_code, division_nom: i.division_nom, division_code: i.division_code,
    est_secretariat_direction: !!i.est_secretariat_direction, parent_type: i.parent_type || null,
    poste_id: i.poste_id, poste_libelle: `${i.poste_libelle} (ad intérim)`, role_associe: i.role_associe, interim: true,
  };
}

/**
 * Applique les intérims à la situation permanente d’une personne :
 *  - titulaire d’un poste couvert par un intérim → suspendu du rôle de ce poste ;
 *  - intérimaire → reçoit le rôle du poste et la structure du poste pour périmètre.
 */
function appliquerInterims({ agentId, roles, affectation }, interims) {
  if (!agentId || !interims.length) return { roles, affectation, interim: null, suspensions: [] };
  let effectifs = [...roles];
  const suspensions = interims.filter((i) => i.titulaires.includes(agentId));
  for (const s of suspensions) effectifs = effectifs.filter((r) => r !== s.role_associe);
  if (suspensions.length && !effectifs.some((r) => FUNCTIONAL_ORDER.includes(r)) && roles.some((r) => FUNCTIONAL_ORDER.includes(r))) {
    effectifs.push('AGENT');
  }
  const interim = interims.find((i) => i.agent_id === agentId) || null;
  let aff = affectation;
  if (interim) {
    if (!effectifs.includes(interim.role_associe)) effectifs.push(interim.role_associe);
    // Les rôles de commandement permanents d’un autre poste ne s’exercent pas pendant l’intérim.
    effectifs = effectifs.filter((r) => r === interim.role_associe || !ROLES_COMMANDEMENT.includes(r));
    aff = affectationInterim(interim, affectation);
  }
  return { roles: effectifs, affectation: aff, interim, suspensions };
}

/**
 * Comptes exerçant effectivement un rôle aujourd’hui (titulaires non suspendus et intérimaires),
 * pour adresser les notifications et les validations à la bonne personne.
 */
async function comptesExercant(role, trx = db) {
  const interims = (await interimsEnVigueur(trx)).filter((i) => i.role_associe === role);
  const suspendus = new Set(interims.flatMap((i) => i.titulaires));
  const permanents = await trx('users as u').join('user_roles as ur', 'ur.user_id', 'u.id').join('roles as r', 'r.id', 'ur.role_id')
    .where({ 'r.code': role }).whereNot('u.statut', 'DESACTIVE').select('u.id', 'u.agent_id');
  const ids = permanents.filter((u) => !suspendus.has(u.agent_id)).map((u) => u.id);
  for (const i of interims) if (i.interimaire_user_id) ids.push(i.interimaire_user_id);
  return [...new Set(ids)];
}

module.exports = { aujourdhui, interimsEnVigueur, appliquerInterims, affectationInterim, comptesExercant, ROLES_COMMANDEMENT, LIBELLES_INTERIM };

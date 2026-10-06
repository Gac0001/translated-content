'use strict';
/**
 * Registre des actes administratifs (cahier des charges, §§ 9, 28, 33 et 36).
 *
 * Circuit : préparation (Bureau Secrétariat de Direction ou Directeur) → soumission avec l’acte
 * scanné → validation ou refus par le Directeur. Les actes relatifs au poste de Directeur sont
 * enregistrés par l’Admin Système et validés par le Secrétaire Général.
 *
 * Effets automatiques :
 *  - INTERIM : rôle et périmètre du poste pendant la période (services/interims), titulaire suspendu ;
 *  - DESIGNATION : permissions désignables accordées pendant la période (user_permissions).
 * Les autres actes (nomination, affectation, fin de fonction) sont enregistrés pour fonder les
 * opérations du module Personnel et l’attribution des rôles d’autorité.
 *
 * Un acte décidé est intangible : il se corrige par un rectificatif (qui le remplace à sa
 * validation) ou cesse par révocation motivée.
 */
const db = require('../db/knex');
const { nextReference } = require('./sequence');
const { notify } = require('./notifications');
const { directeursActifs } = require('./alertes');
const { comptesExercant, aujourdhui, ROLES_COMMANDEMENT, LIBELLES_INTERIM } = require('./interims');
const { badRequest, forbidden, notFound, conflict } = require('../utils/errors');

const TYPES = {
  NOMINATION: 'Nomination',
  AFFECTATION: 'Affectation',
  INTERIM: 'Intérim',
  DESIGNATION: 'Désignation',
  FIN_FONCTION: 'Fin de fonction',
  AUTRE: 'Autre acte',
};
const STATUTS = ['BROUILLON', 'SOUMIS', 'VALIDE', 'REFUSE', 'REVOQUE', 'EXPIRE', 'REMPLACE'];
const DECIDES = ['VALIDE', 'REVOQUE', 'EXPIRE', 'REMPLACE'];
const RAPPEL_JOURS = 3;

const nomComplet = (r, p = '') => [r[`${p}prenom`], r[`${p}nom`], r[`${p}postnom`]].filter(Boolean).join(' ');

// ─── Visibilité ─────────────────────────────────────────────────────────────
/** Actes visibles : registre complet (Directeur, SG), actes à préparer, et actes validés concernant l’agent. */
function scopeActes(qb, ctx, alias = 'x') {
  if (ctx.can('actes.consulter')) return qb;
  return qb.where((w) => {
    w.where(`${alias}.prepare_par`, ctx.userId);
    if (ctx.can('actes.preparer')) w.orWhere(`${alias}.validation_par`, 'DIRECTEUR');
    if (ctx.can('actes.enregistrer_direction')) w.orWhere(`${alias}.validation_par`, 'SECRETAIRE_GENERAL');
    if (ctx.agentId) {
      w.orWhere((c) => c.whereIn(`${alias}.statut`, DECIDES)
        .where((cc) => cc.where(`${alias}.agent_id`, ctx.agentId).orWhere(`${alias}.titulaire_agent_id`, ctx.agentId)));
    }
  });
}

function baseQuery(trx = db) {
  return trx('actes_administratifs as x')
    .leftJoin('agents as ag', 'ag.id', 'x.agent_id')
    .leftJoin('agents as ti', 'ti.id', 'x.titulaire_agent_id')
    .leftJoin('postes_organiques as p', 'p.id', 'x.poste_id')
    .leftJoin('users as up', 'up.id', 'x.prepare_par')
    .leftJoin('users as ud', 'ud.id', 'x.decide_par')
    .leftJoin('actes_administratifs as r', 'r.id', 'x.rectifie_acte_id')
    .select('x.*', 'ag.nom', 'ag.postnom', 'ag.prenom', 'ag.matricule', 'ti.nom as ti_nom', 'ti.postnom as ti_postnom', 'ti.prenom as ti_prenom',
      'p.libelle as poste_libelle', 'p.role_associe', 'up.username as prepare_par_username', 'ud.username as decide_par_username',
      'r.numero as rectifie_numero',
      db.raw(`(SELECT count(*)::int FROM attachments a WHERE a.entity_type = 'ACTE' AND a.entity_id = x.id AND a.deleted_at IS NULL) as pieces`));
}

/** État d’effet d’un acte à la date du jour. */
function effet(a, jour = aujourdhui()) {
  if (a.statut !== 'VALIDE' || !['INTERIM', 'DESIGNATION'].includes(a.type)) return null;
  const debut = String(a.date_debut).slice(0, 10);
  const fin = String(a.date_fin).slice(0, 10);
  if (jour < debut) return 'A_VENIR';
  if (jour > fin) return 'ECHU';
  return 'EN_VIGUEUR';
}

function vue(a) {
  const iso = (d) => (d ? (d instanceof Date ? new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Kinshasa' }).format(d) : String(d).slice(0, 10)) : null);
  return {
    ...a,
    date_acte: iso(a.date_acte), date_debut: iso(a.date_debut), date_fin: iso(a.date_fin),
    typeLibelle: TYPES[a.type],
    personne: a.agent_id ? nomComplet(a) : null,
    titulaire: a.titulaire_agent_id ? nomComplet(a, 'ti_') : null,
    effet: effet({ ...a, date_debut: iso(a.date_debut), date_fin: iso(a.date_fin) }),
  };
}

async function charger(ctx, id, trx = db) {
  const existe = await trx('actes_administratifs').where({ id }).first('id');
  if (!existe) throw notFound('Acte introuvable.');
  const a = await scopeActes(baseQuery(trx).where('x.id', id), ctx).first();
  if (!a) throw forbidden('Cet acte ne relève pas de votre périmètre.', 'HORS_PERIMETRE');
  return a;
}

// ─── Contrôles ──────────────────────────────────────────────────────────────
/** Autorité de validation : le Secrétaire Général pour le poste de Directeur, sinon le Directeur. */
async function autoriteValidation(data, trx = db) {
  if (data.poste_id) {
    const p = await trx('postes_organiques').where({ id: data.poste_id }).first();
    if (p && p.role_associe === 'DIRECTEUR') return 'SECRETAIRE_GENERAL';
  }
  if (data.agent_id) {
    const dir = await trx('affectations as a').join('postes_organiques as p', 'p.id', 'a.poste_id')
      .where({ 'a.agent_id': data.agent_id, 'a.est_active': true, 'p.role_associe': 'DIRECTEUR' }).first('a.id');
    if (dir) return 'SECRETAIRE_GENERAL';
  }
  return 'DIRECTEUR';
}

function peutPreparer(ctx, validationPar) {
  return validationPar === 'SECRETAIRE_GENERAL' ? ctx.can('actes.enregistrer_direction') : ctx.can('actes.preparer');
}

function peutDecider(ctx, a) {
  return a.validation_par === 'SECRETAIRE_GENERAL' ? ctx.can('actes.valider_direction') : ctx.can('actes.valider');
}

/** Personne concernée : un agent de la DEP doté d’un compte actif (intérim, désignation). */
async function compteActif(agentId, trx = db) {
  const u = await trx('users as u').join('agents as ag', 'ag.id', 'u.agent_id').where('u.agent_id', agentId)
    .first('u.id', 'u.statut', 'ag.est_autorite', 'ag.archived_at');
  if (!u || u.statut === 'DESACTIVE' || u.archived_at) throw badRequest('La personne concernée doit disposer d’un compte SIG-DEP actif.');
  if (u.est_autorite) throw badRequest('Le Secrétaire Général ne peut être ni intérimaire ni bénéficiaire d’une désignation de la DEP.');
  return u;
}

/** Contrôles de cohérence propres à chaque type (à la soumission et à la validation). */
async function controler(a, trx = db) {
  if (!a.reference || !a.autorite || !a.objet || !a.date_acte) throw badRequest('La référence, la date, l’autorité signataire et l’objet de l’acte sont obligatoires.');
  if (a.date_debut && a.date_fin && a.date_fin < a.date_debut) throw badRequest('La date de fin précède la date de début.');
  if (['INTERIM', 'DESIGNATION'].includes(a.type)) {
    if (!a.agent_id || !a.date_debut || !a.date_fin) throw badRequest(`Un acte d’${a.type === 'INTERIM' ? 'intérim' : 'désignation'} exige la personne concernée, une date de début et une date de fin.`);
    await compteActif(a.agent_id, trx);
  }
  if (a.type === 'INTERIM') {
    const p = await trx('postes_organiques').where({ id: a.poste_id, actif: true }).first();
    if (!p || !ROLES_COMMANDEMENT.includes(p.role_associe)) throw badRequest('L’intérim porte sur un poste de commandement actif (Directeur, Chef de Division ou Chef de Bureau).');
    const occupant = await trx('affectations').where({ poste_id: p.id, est_active: true }).first('agent_id');
    if (occupant && occupant.agent_id === a.agent_id) throw badRequest('Le titulaire du poste ne peut pas en être l’intérimaire.');
    // L’acte rectifié est remplacé par son rectificatif : il n’entre pas en concurrence avec lui.
    const chevauche = await trx('actes_administratifs').where({ type: 'INTERIM', statut: 'VALIDE' }).whereNotIn('id', [a.id || 0, a.rectifie_acte_id || 0])
      .where((w) => w.where('poste_id', a.poste_id).orWhere('agent_id', a.agent_id))
      .where('date_debut', '<=', a.date_fin).where('date_fin', '>=', a.date_debut).first('numero', 'poste_id');
    if (chevauche) {
      throw conflict(chevauche.poste_id === a.poste_id
        ? `Un intérim est déjà en vigueur ou prévu sur ce poste pendant cette période (acte ${chevauche.numero}).`
        : `Cette personne exerce déjà un intérim pendant cette période (acte ${chevauche.numero}).`, 'INTERIM_CONCURRENT');
    }
  }
  if (a.type === 'DESIGNATION') {
    const codes = Array.isArray(a.permissions) ? a.permissions : [];
    if (!codes.length) throw badRequest('Indiquez au moins une opération désignée.');
    const ok = await trx('permissions').whereIn('code', codes).where({ delegable: true }).pluck('code');
    const hors = codes.filter((c) => !ok.includes(c));
    if (hors.length) throw badRequest(`Opérations non désignables : ${hors.join(', ')}.`);
  }
}

// ─── Opérations ─────────────────────────────────────────────────────────────
const CHAMPS = ['type', 'reference', 'date_acte', 'autorite', 'objet', 'motif', 'agent_id', 'poste_id', 'permissions', 'date_debut', 'date_fin'];

function nettoyer(body) {
  const d = {};
  for (const k of CHAMPS) if (body[k] !== undefined) d[k] = body[k] === '' ? null : body[k];
  if (d.type === 'DESIGNATION') d.poste_id = null;
  if (d.type && d.type !== 'DESIGNATION') d.permissions = [];
  if (d.permissions) d.permissions = JSON.stringify([...new Set(d.permissions)]);
  return d;
}

async function creer(ctx, body, { rectifie = null } = {}) {
  const d = nettoyer(body);
  const validationPar = await autoriteValidation(d);
  if (!peutPreparer(ctx, validationPar)) {
    throw forbidden(validationPar === 'SECRETAIRE_GENERAL'
      ? 'Les actes relatifs au poste de Directeur sont enregistrés par l’Admin Système et validés par le Secrétaire Général.'
      : 'L’enregistrement des actes est préparé par le Bureau Secrétariat de Direction ou par le Directeur.', 'PREPARATION_NON_AUTORISEE');
  }
  return db.transaction(async (trx) => {
    const [a] = await trx('actes_administratifs').insert({
      ...d, numero: await nextReference('ACTE', 'DEP/ACT', trx), validation_par: validationPar,
      prepare_par: ctx.userId, rectifie_acte_id: rectifie,
    }).returning('*');
    return a;
  });
}

async function modifier(ctx, id, body) {
  const a = await charger(ctx, id);
  if (a.statut !== 'BROUILLON') throw badRequest('Seul un acte en préparation peut être modifié.');
  if (a.prepare_par !== ctx.userId) throw forbidden('Seule la personne qui prépare l’acte peut le modifier.');
  const d = nettoyer({ type: a.type, ...body });
  const validationPar = await autoriteValidation({ ...a, ...d });
  if (!peutPreparer(ctx, validationPar)) throw forbidden('Cet acte relève d’une autre autorité de validation.');
  const [row] = await db('actes_administratifs').where({ id }).update({ ...d, validation_par: validationPar, updated_at: db.fn.now() }).returning('*');
  return row;
}

async function supprimer(ctx, id) {
  const a = await charger(ctx, id);
  if (a.statut !== 'BROUILLON' || a.prepare_par !== ctx.userId) throw forbidden('Seul un brouillon peut être supprimé, par la personne qui le prépare.');
  await db('attachments').where({ entity_type: 'ACTE', entity_id: id }).update({ deleted_at: db.fn.now(), deleted_by: ctx.userId });
  await db('actes_administratifs').where({ id }).del();
  return a;
}

async function soumettre(ctx, id) {
  const a = await charger(ctx, id);
  if (a.statut !== 'BROUILLON') throw badRequest('Cet acte a déjà été soumis.');
  if (a.prepare_par !== ctx.userId) throw forbidden('Seule la personne qui prépare l’acte peut le soumettre.');
  if (!a.pieces) throw badRequest('Joignez la copie scannée de l’acte signé avant de le soumettre.');
  await controler(vue(a));
  await db('actes_administratifs').where({ id }).update({ statut: 'SOUMIS', soumis_at: db.fn.now(), updated_at: db.fn.now() });
  const dest = a.validation_par === 'SECRETAIRE_GENERAL' ? await comptesExercant('SECRETAIRE_GENERAL') : await directeursActifs();
  await notify(dest, { type: 'ACTE', titre: `Acte à valider : ${TYPES[a.type]} — ${a.objet}`, message: `${a.numero} · ${a.reference}`, lien: `/actes/${id}`, expediteur: ctx.userId });
  return charger(ctx, id);
}

/** Effets d’une désignation validée : un droit par opération, borné à la période de l’acte. */
async function appliquerDesignation(trx, a, decideur) {
  const codes = typeof a.permissions === 'string' ? JSON.parse(a.permissions) : a.permissions;
  const user = await trx('users').where({ agent_id: a.agent_id }).first('id');
  const perms = await trx('permissions').whereIn('code', codes).select('id', 'code');
  for (const p of perms) {
    // Régularisation : un droit accordé sans acte pour la même opération est remplacé par la désignation.
    await trx('user_permissions').where({ user_id: user.id, permission_id: p.id }).whereNull('acte_id').whereNull('revoked_at')
      .update({ revoked_at: trx.fn.now(), revoked_by: decideur, motif_revocation: `Régularisée par l’acte ${a.numero}` });
    await trx('user_permissions').insert({
      user_id: user.id, permission_id: p.id, granted_by: decideur, motif: `${a.numero} — ${a.reference}`,
      acte_id: a.id, date_debut: a.date_debut, date_fin: a.date_fin,
    });
  }
}

async function cesserEffets(trx, a, par, motif) {
  await trx('user_permissions').where({ acte_id: a.id }).whereNull('revoked_at')
    .update({ revoked_at: trx.fn.now(), revoked_by: par, motif_revocation: motif });
}

/** Personnes à informer d’un acte : la personne concernée, le titulaire, la personne qui l’a préparé. */
async function concernes(a, trx = db) {
  const ids = [a.prepare_par];
  const agents = [a.agent_id, a.titulaire_agent_id].filter(Boolean);
  if (agents.length) ids.push(...await trx('users').whereIn('agent_id', agents).pluck('id'));
  return ids;
}

async function decider(ctx, id, { decision, commentaire }) {
  const a = await charger(ctx, id);
  if (a.statut !== 'SOUMIS') throw badRequest('Seul un acte soumis peut être validé ou refusé.');
  if (!peutDecider(ctx, a)) {
    throw forbidden(a.validation_par === 'SECRETAIRE_GENERAL' ? 'Cet acte relève de la validation du Secrétaire Général.' : 'Cet acte relève de la validation du Directeur.', 'VALIDATION_NON_AUTORISEE');
  }
  if (ctx.agentId && (a.agent_id === ctx.agentId || a.titulaire_agent_id === ctx.agentId)) {
    throw forbidden('Vous ne pouvez pas valider un acte qui vous concerne.', 'CONFLIT_INTERET');
  }
  if (decision === 'REFUSE') {
    if (!commentaire || commentaire.trim().length < 5) throw badRequest('Motivez le refus.');
    await db('actes_administratifs').where({ id }).update({ statut: 'REFUSE', decide_par: ctx.userId, decide_at: db.fn.now(), commentaire_decision: commentaire, updated_at: db.fn.now() });
    await notify(a.prepare_par, { type: 'ACTE', titre: `Acte refusé : ${a.objet}`, message: commentaire, lien: `/actes/${id}`, expediteur: ctx.userId });
    return charger(ctx, id);
  }
  await db.transaction(async (trx) => {
    // Le rectificatif remplace l’acte d’origine (et en fait cesser les effets) avant d’être validé.
    if (a.rectifie_acte_id) {
      const orig = await trx('actes_administratifs').where({ id: a.rectifie_acte_id }).forUpdate().first();
      if (orig && orig.statut === 'VALIDE') {
        await trx('actes_administratifs').where({ id: orig.id }).update({ statut: 'REMPLACE', updated_at: trx.fn.now() });
        await cesserEffets(trx, orig, ctx.userId, `Remplacé par le rectificatif ${a.numero}`);
      }
    }
    const v = vue(await baseQuery(trx).where('x.id', id).first());
    await controler(v, trx);
    let titulaire = null;
    if (a.type === 'INTERIM') {
      const occ = await trx('affectations').where({ poste_id: a.poste_id, est_active: true }).first('agent_id');
      titulaire = occ ? occ.agent_id : null;
    }
    await trx('actes_administratifs').where({ id }).update({
      statut: 'VALIDE', decide_par: ctx.userId, decide_at: trx.fn.now(), commentaire_decision: commentaire || null,
      titulaire_agent_id: titulaire, updated_at: trx.fn.now(),
    });
    if (a.type === 'DESIGNATION') await appliquerDesignation(trx, v, ctx.userId);
  }).catch((e) => {
    if (/INTERIM_CONCURRENT/.test(e.message)) throw conflict('Un autre intérim couvre déjà ce poste ou cet intérimaire sur la période.', 'INTERIM_CONCURRENT');
    throw e;
  });
  const valide = vue(await charger(ctx, id));
  const libelle = a.type === 'INTERIM' ? `${LIBELLES_INTERIM[a.role_associe] || 'Intérim'} — ${a.poste_libelle}` : `${TYPES[a.type]} — ${a.objet}`;
  await notify(await concernes(valide), {
    type: 'ACTE', titre: `Acte validé : ${libelle}`,
    message: valide.date_debut ? `Du ${valide.date_debut} au ${valide.date_fin} · ${valide.reference}` : valide.reference,
    lien: `/actes/${id}`, expediteur: ctx.userId,
  });
  return valide;
}

async function revoquer(ctx, id, motif) {
  const a = await charger(ctx, id);
  if (a.statut !== 'VALIDE') throw badRequest('Seul un acte validé peut être révoqué.');
  if (!peutDecider(ctx, a)) throw forbidden('La révocation relève de l’autorité qui a validé l’acte.', 'VALIDATION_NON_AUTORISEE');
  await db.transaction(async (trx) => {
    await trx('actes_administratifs').where({ id }).update({ statut: 'REVOQUE', revoque_par: ctx.userId, revoque_at: trx.fn.now(), motif_revocation: motif, updated_at: trx.fn.now() });
    await cesserEffets(trx, a, ctx.userId, `Acte ${a.numero} révoqué : ${motif}`);
  });
  await notify(await concernes(a), { type: 'ACTE', titre: `Acte révoqué : ${a.objet}`, message: motif, lien: `/actes/${id}`, expediteur: ctx.userId });
  return charger(ctx, id);
}

/** Rectificatif d’un acte validé (le remplacera à sa validation) ou reprise d’un acte refusé. */
async function rectifier(ctx, id) {
  const a = await charger(ctx, id);
  if (!['VALIDE', 'REFUSE'].includes(a.statut)) throw badRequest('Seul un acte validé (rectificatif) ou refusé (reprise) peut être repris.');
  const enCours = await db('actes_administratifs').where({ rectifie_acte_id: id }).whereIn('statut', ['BROUILLON', 'SOUMIS']).first('numero');
  if (enCours) throw conflict(`Un rectificatif est déjà en préparation (${enCours.numero}).`);
  const v = vue(a);
  const copie = Object.fromEntries(CHAMPS.map((k) => [k, v[k]]));
  copie.permissions = typeof a.permissions === 'string' ? JSON.parse(a.permissions) : a.permissions;
  return creer(ctx, copie, { rectifie: a.statut === 'VALIDE' ? id : null });
}

// ─── Tâche quotidienne ──────────────────────────────────────────────────────
/** Échéances : début d’effet, rappel avant la fin, expiration ; régularisation des droits sans acte. */
async function tacheQuotidienne() {
  const jour = aujourdhui();
  const rappel = aujourdhui(new Date(Date.now() + RAPPEL_JOURS * 86400000));
  const temporaires = () => baseQuery().whereIn('x.type', ['INTERIM', 'DESIGNATION']).where('x.statut', 'VALIDE');
  const titre = (a) => (a.type === 'INTERIM' ? `${LIBELLES_INTERIM[a.role_associe] || 'Intérim'} — ${a.poste_libelle}` : `Désignation — ${a.objet}`);

  for (const a of await temporaires().where('x.date_debut', '<=', jour).where('x.date_fin', '>=', jour).whereNull('x.debut_notifie_at')) {
    await notify([...await concernes(a), ...await directeursActifs()], { type: 'ACTE', titre: `Entrée en vigueur : ${titre(a)}`, message: `Jusqu’au ${vue(a).date_fin} · ${a.numero}`, lien: `/actes/${a.id}` });
    await db('actes_administratifs').where({ id: a.id }).update({ debut_notifie_at: db.fn.now() });
  }
  for (const a of await temporaires().where('x.date_fin', '>=', jour).where('x.date_fin', '<=', rappel).whereNull('x.rappel_notifie_at')) {
    await notify([...await concernes(a), ...await directeursActifs()], { type: 'ACTE', titre: `Fin prochaine : ${titre(a)}`, message: `Les droits temporaires prendront fin le ${vue(a).date_fin}.`, lien: `/actes/${a.id}` });
    await db('actes_administratifs').where({ id: a.id }).update({ rappel_notifie_at: db.fn.now() });
  }
  for (const a of await temporaires().where('x.date_fin', '<', jour)) {
    await db.transaction(async (trx) => {
      await trx('actes_administratifs').where({ id: a.id }).update({ statut: 'EXPIRE', fin_notifiee_at: trx.fn.now(), updated_at: trx.fn.now() });
      await cesserEffets(trx, a, null, `Échéance de l’acte ${a.numero}`);
    });
    await notify(await concernes(a), { type: 'ACTE', titre: `Échéance : ${titre(a)}`, message: 'Les droits temporaires ont pris fin.', lien: `/actes/${a.id}` });
  }
  // Droits accordés sans acte, non régularisés dans le délai : retirés.
  const echus = await db('user_permissions').whereNull('revoked_at').whereNull('acte_id').where('a_regulariser_avant', '<=', db.fn.now());
  if (echus.length) {
    await db('user_permissions').whereIn('id', echus.map((e) => e.id))
      .update({ revoked_at: db.fn.now(), motif_revocation: 'Non régularisée par un acte dans le délai de 30 jours' });
    await notify([...new Set(echus.map((e) => e.user_id)), ...await directeursActifs()], { type: 'ACTE', titre: 'Désignations sans acte retirées', message: `${echus.length} droit(s) accordé(s) sans acte n’ont pas été régularisés dans le délai.`, lien: '/designations' });
  }
}

module.exports = {
  TYPES, STATUTS, scopeActes, baseQuery, vue, charger, creer, modifier, supprimer, soumettre, decider, revoquer, rectifier,
  tacheQuotidienne, autoriteValidation, effet,
};

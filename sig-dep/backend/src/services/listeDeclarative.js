'use strict';
/**
 * Liste déclarative des agents de la Direction.
 *
 * La liste est constituée des agents inscrits (agents.liste_declarative) ; le Directeur (ou l’Admin)
 * la valide, ce qui enregistre un instantané daté. Un agent n’est enrôlable (création de son compte)
 * que s’il figure dans le dernier instantané validé ET que sa matricule, son grade et sa structure
 * n’ont pas changé depuis. Toute modification rend la liste « à revalider ». Une fois le compte créé,
 * les mutations ultérieures de l’agent (affectation choisie à l’enrôlement, réaffectation…) suivent
 * le circuit ordinaire des affectations et n’exigent plus de revalidation.
 */
const db = require('../db/knex');

const CHAMPS_CONTROLES = ['matricule', 'grade_id', 'division_id', 'bureau_id'];

/** Agents actuellement inscrits sur la liste, avec leur affectation et leur compte éventuel. */
async function agentsInscrits(trx = db) {
  return trx('agents as ag')
    .leftJoin('affectations as a', function j() { this.on('a.agent_id', 'ag.id').andOn('a.est_active', db.raw('true')); })
    .leftJoin('bureaux as b', 'b.id', 'a.bureau_id').leftJoin('divisions as d', 'd.id', 'a.division_id')
    .leftJoin('grades as g', 'g.id', 'ag.grade_id').leftJoin('postes_organiques as p', 'p.id', 'a.poste_id')
    .leftJoin('users as u', 'u.agent_id', 'ag.id')
    .where('ag.liste_declarative', true).whereNull('ag.archived_at').where('ag.est_autorite', false)
    .select('ag.id as agent_id', 'ag.matricule', 'ag.nom', 'ag.postnom', 'ag.prenom', 'ag.grade_id', 'g.code as grade_code', 'g.libelle as grade',
      'a.niveau', 'a.division_id', 'a.bureau_id', 'b.nom as bureau_nom', 'b.est_secretariat_direction', 'b.parent_type', 'd.nom as division_nom',
      'p.libelle as poste', 'p.role_associe', 'u.id as user_id', 'u.username', 'ag.enrole_at', 'ag.enrolement_autorise_at')
    .orderByRaw('b.est_secretariat_direction DESC NULLS LAST, d.ordre NULLS FIRST, b.ordre, ag.nom');
}

function snapshotEntry(a) {
  return { agent_id: a.agent_id, matricule: a.matricule, nom: a.nom, postnom: a.postnom, prenom: a.prenom, grade_id: a.grade_id, division_id: a.division_id || null, bureau_id: a.bureau_id || null };
}

async function derniereValidation(trx = db) {
  return trx('listes_declaratives_validations as v').join('users as u', 'u.id', 'v.valide_par').leftJoin('agents as ag', 'ag.id', 'u.agent_id')
    .orderBy('v.id', 'desc').first('v.*', 'u.username', db.raw(`NULLIF(concat_ws(' ', ag.prenom, ag.nom), '') as valide_par_nom`));
}

/** État complet de la liste : agents, dernière validation, écarts, statut. */
async function etat(trx = db) {
  const [agents, validation] = await Promise.all([agentsInscrits(trx), derniereValidation(trx)]);
  const snap = new Map(((validation && validation.agents) || []).map((x) => [x.agent_id, x]));
  const courants = new Map(agents.map((a) => [a.agent_id, a]));
  const ajoutes = []; const modifies = []; const retires = [];
  for (const a of agents) {
    const s = snap.get(a.agent_id);
    a.valide = false;
    if (!s) { if (validation) ajoutes.push(a.agent_id); a.ecart = validation ? 'AJOUTE' : null; continue; }
    const cur = snapshotEntry(a);
    const diff = a.user_id ? [] : CHAMPS_CONTROLES.filter((k) => (cur[k] ?? null) !== (s[k] ?? null));
    if (diff.length) { modifies.push(a.agent_id); a.ecart = 'MODIFIE'; a.champsModifies = diff; } else { a.valide = true; a.ecart = null; }
  }
  for (const s of snap.values()) if (!courants.has(s.agent_id)) retires.push(s);
  const statut = !validation ? 'NON_VALIDEE' : (ajoutes.length || modifies.length || retires.length) ? 'A_REVALIDER' : 'VALIDEE';
  return { agents, validation: validation || null, ecarts: { ajoutes, modifies, retires }, statut };
}

async function valider(ctx, commentaire, trx = db) {
  const dep = await trx('directions').where({ code: 'DEP' }).first();
  const agents = await agentsInscrits(trx);
  const [v] = await trx('listes_declaratives_validations').insert({
    direction_id: dep.id, valide_par: ctx.userId, valide_par_role: ctx.primaryRole === 'ADMIN_SYSTEME' || (ctx.roles.includes('ADMIN_SYSTEME') && !ctx.roles.includes('DIRECTEUR')) ? 'ADMIN_SYSTEME' : 'DIRECTEUR',
    nb_agents: agents.length, agents: JSON.stringify(agents.map(snapshotEntry)), commentaire: commentaire || null,
  }).returning('*');
  return v;
}

/** Raison pour laquelle un agent ne peut pas être enrôlé (null s’il peut l’être). */
async function motifNonEnrolable(agentId, trx = db) {
  const e = await etat(trx);
  const a = e.agents.find((x) => x.agent_id === agentId);
  if (!e.validation) return 'La liste déclarative n’a pas encore été validée par le Directeur.';
  if (!a) return 'Cet agent ne figure pas sur la liste déclarative de la Direction.';
  if (a.user_id) return 'Cet agent possède déjà un compte.';
  if (a.ecart === 'AJOUTE') return 'Cet agent a été ajouté à la liste après sa dernière validation : la liste doit être revalidée par le Directeur.';
  if (a.ecart === 'MODIFIE') return 'La fiche de cet agent (matricule, grade ou affectation) a changé depuis la validation : la liste doit être revalidée par le Directeur.';
  return null;
}

/** Progression de la mise en service des comptes. */
async function progression(trx = db) {
  const e = await etat(trx);
  const directeur = await trx('users as u').join('user_roles as ur', 'ur.user_id', 'u.id').join('roles as r', 'r.id', 'ur.role_id')
    .where('r.code', 'DIRECTEUR').whereNot('u.statut', 'DESACTIVE').first('u.id', 'u.username');
  const sec = e.agents.filter((a) => a.est_secretariat_direction);
  const autres = e.agents.filter((a) => !a.est_secretariat_direction);
  return {
    directeur: !!directeur,
    statutListe: e.statut,
    validation: e.validation ? { valide_at: e.validation.valide_at, par: e.validation.valide_par_nom || e.validation.username, role: e.validation.valide_par_role, nb_agents: e.validation.nb_agents } : null,
    secretariat: { total: sec.length, avecCompte: sec.filter((a) => a.user_id).length, autorises: sec.filter((a) => !a.user_id && a.enrolement_autorise_at).length },
    autres: { total: autres.length, avecCompte: autres.filter((a) => a.user_id).length },
  };
}

module.exports = { etat, valider, motifNonEnrolable, progression, agentsInscrits, snapshotEntry };

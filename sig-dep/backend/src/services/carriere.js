'use strict';
/**
 * Carrière des agents (cahier des charges, §§ 12, 13, 44, 56) : effets des actes permanents.
 *  - Élévation en grade : nouveau grade à la date d’effet, ancien grade conservé à l’historique ;
 *    ni la fonction, ni l’affectation, ni le rôle ne changent.
 *  - Nomination à un poste de commandement : poste vacant, grade égal au grade requis ; l’intérim
 *    en cours sur ce poste prend fin ; affectation, fonction et rôle du poste ; droits recalculés.
 *  - Affectation : nouvelle affectation sur un poste d’exécution ; un rôle de commandement cesse.
 *  - Fin de fonction : le titulaire quitte son poste de commandement et reste dans la structure
 *    comme agent ; son grade est conservé (il peut apparaître « promu en attente de poste »).
 * Les effets s’appliquent à la validation si la date d’effet est atteinte, sinon le jour venu
 * (tâche quotidienne des actes).
 */
const db = require('../db/knex');
const { badRequest, conflict } = require('../utils/errors');

const PERMANENTS = ['NOMINATION', 'AFFECTATION', 'FIN_FONCTION', 'ELEVATION_GRADE'];
const COMMANDEMENT = ['DIRECTEUR', 'CHEF_DIVISION', 'CHEF_BUREAU'];
const ROLES_STRUCTURE = [...COMMANDEMENT, 'AGENT'];
const FONCTIONS = { DIRECTEUR: 'F-DIR', CHEF_DIVISION: 'F-CD', CHEF_BUREAU: 'F-CB' };
const iso = (d) => (d instanceof Date ? new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Kinshasa' }).format(d) : String(d).slice(0, 10));
const fr = (d) => iso(d).split('-').reverse().join('/');
const libelleGrade = (g) => (g ? `${g.code_officiel} — ${g.libelle}` : 'sans grade');

async function agentConcerne(agentId, trx) {
  const ag = await trx('agents as a').leftJoin('grades as g', 'g.id', 'a.grade_id').where('a.id', agentId)
    .first('a.*', 'g.code as grade_code', 'g.code_officiel', 'g.libelle as grade_libelle', 'g.niveau as grade_niveau');
  if (!ag || ag.archived_at) throw badRequest('Agent inconnu ou archivé.');
  if (ag.est_autorite) throw badRequest('Le Secrétaire Général ne relève pas des actes de carrière de la Direction.');
  return ag;
}
const titulaireActif = (posteId, trx) => trx('affectations').where({ poste_id: posteId, est_active: true }).first();

/** Contrôles propres aux actes permanents (soumission et validation). */
async function controler(a, trx = db) {
  if (!PERMANENTS.includes(a.type)) return;
  if (!a.agent_id || !a.date_debut) throw badRequest('Indiquez l’agent concerné et la date d’effet de l’acte.');
  const ag = await agentConcerne(a.agent_id, trx);
  if (a.type === 'ELEVATION_GRADE') {
    if (!a.grade_id) throw badRequest('Indiquez le nouveau grade.');
    const g = await trx('grades').where({ id: a.grade_id, actif: true }).first();
    if (!g) throw badRequest('Grade inconnu.');
    if (g.code === 'SG') throw badRequest('Le grade 110 (Secrétaire Général) est hors de l’effectif de la Direction.');
    if (ag.grade_niveau !== null && g.niveau <= ag.grade_niveau) {
      throw badRequest(`L’élévation porte sur un grade supérieur au grade actuel (${ag.code_officiel} — ${ag.grade_libelle}).`);
    }
    return;
  }
  const p = await trx('postes_organiques').where({ id: a.poste_id, actif: true }).first();
  if (!p) throw badRequest('Indiquez un poste du cadre organique actif.');
  const occupant = await titulaireActif(p.id, trx);
  if (a.type === 'NOMINATION') {
    if (!COMMANDEMENT.includes(p.role_associe)) throw badRequest('Une nomination porte sur un poste de commandement (Directeur, Chef de Division, Chef de Bureau). Pour un poste d’exécution, établissez un acte d’affectation.');
    if (occupant && occupant.agent_id === a.agent_id) throw badRequest('Cet agent est déjà titulaire de ce poste.');
    if (occupant) throw conflict('Ce poste a déjà un titulaire en fonction : établissez d’abord l’acte de fin de fonction.', 'POSTE_OCCUPE');
    if (p.grade_minimum_id && ag.grade_id !== p.grade_minimum_id) {
      const requis = await trx('grades').where({ id: p.grade_minimum_id }).first();
      throw badRequest(`Le titulaire de ce poste doit avoir le grade ${libelleGrade(requis)} ; l’agent a le grade ${ag.code_officiel ? `${ag.code_officiel} — ${ag.grade_libelle}` : 'non renseigné'}. Procédez d’abord à l’élévation en grade.`);
    }
  }
  if (a.type === 'AFFECTATION') {
    if (COMMANDEMENT.includes(p.role_associe)) throw badRequest('Un poste de commandement s’attribue par un acte de nomination.');
    const actuelle = await trx('affectations').where({ agent_id: a.agent_id, est_active: true }).first();
    if (actuelle && actuelle.poste_id === p.id) throw badRequest('L’agent occupe déjà ce poste.');
  }
  if (a.type === 'FIN_FONCTION') {
    if (!COMMANDEMENT.includes(p.role_associe)) throw badRequest('La fin de fonction porte sur un poste de commandement.');
    if (!occupant || occupant.agent_id !== a.agent_id) throw badRequest('L’agent n’est pas titulaire de ce poste.');
  }
}

/** Structure d’un poste (niveau, Division, Bureau). */
async function structurePoste(p, trx) {
  const dep = await trx('directions').where({ code: 'DEP' }).first();
  let divisionId = p.division_id || null;
  if (p.bureau_id) divisionId = (await trx('bureaux').where({ id: p.bureau_id }).first()).division_id;
  return { direction_id: dep.id, division_id: divisionId, bureau_id: p.bureau_id || null, niveau: p.niveau };
}

/** Clôture l’affectation en cours et ouvre la nouvelle (poste éventuel), liée à l’acte. */
async function reaffecter(trx, agentId, structure, posteId, date, acte, userId) {
  const actuelle = await trx('affectations').where({ agent_id: agentId, est_active: true }).first();
  if (actuelle) {
    await trx('affectations').where({ id: actuelle.id }).update({
      est_active: false, date_fin: date, motif_cloture: `${acte.typeLibelle || acte.type} — acte ${acte.numero}`, closed_by: userId, updated_at: trx.fn.now(),
    });
  }
  const [row] = await trx('affectations').insert({
    agent_id: agentId, ...structure, poste_id: posteId, date_debut: date, est_active: true,
    motif: `Acte ${acte.numero} — ${acte.reference}`, acte_id: acte.id, created_by: userId,
  }).returning('*');
  return { avant: actuelle || null, apres: row };
}

/** Rôle de structure du compte (Agent ou rôle de commandement) ; les autres rôles sont conservés. */
async function definirRole(trx, agentId, role, userId) {
  const user = await trx('users').where({ agent_id: agentId }).first('id');
  if (!user) return null;
  const roles = await trx('roles').whereIn('code', ROLES_STRUCTURE).select('id', 'code');
  await trx('user_roles').where({ user_id: user.id }).whereIn('role_id', roles.map((r) => r.id)).del();
  await trx('user_roles').insert({ user_id: user.id, role_id: roles.find((r) => r.code === role).id, granted_by: userId });
  return user.id;
}

/** Supérieur direct du titulaire d’un poste : Directeur, Chef de Division ou SG. */
async function superieur(p, trx) {
  if (p.role_associe === 'DIRECTEUR') return trx('users as u').join('user_roles as ur', 'ur.user_id', 'u.id').join('roles as r', 'r.id', 'ur.role_id').where('r.code', 'SECRETAIRE_GENERAL').where('u.statut', 'ACTIF').pluck('u.id');
  const s = await structurePoste(p, trx);
  if (p.role_associe === 'CHEF_BUREAU' && s.division_id) {
    const chef = await trx('affectations as a').join('postes_organiques as q', 'q.id', 'a.poste_id').join('users as u', 'u.agent_id', 'a.agent_id')
      .where({ 'a.est_active': true, 'q.role_associe': 'CHEF_DIVISION', 'a.division_id': s.division_id }).pluck('u.id');
    if (chef.length) return chef;
  }
  return trx('users as u').join('user_roles as ur', 'ur.user_id', 'u.id').join('roles as r', 'r.id', 'ur.role_id').where('r.code', 'DIRECTEUR').where('u.statut', 'ACTIF').pluck('u.id');
}

/**
 * Applique les effets d’un acte permanent validé (une seule fois). Renvoie { detail, aNotifier }.
 * `acte` : ligne d’actes_administratifs (avec numero, reference, type) ; `userId` : auteur (décideur
 * ou null pour la tâche quotidienne).
 */
async function appliquer(trx, acte, userId) {
  const a = { ...acte, date_debut: iso(acte.date_debut) };
  await controler(a, trx);
  await trx.raw(`SELECT set_config('sigdep.acte_id', ?, true), set_config('sigdep.date_effet', ?, true), set_config('sigdep.user_id', ?, true)`,
    [String(a.id), a.date_debut, userId ? String(userId) : '']);
  const aNotifier = [];
  const userAgent = await trx('users').where({ agent_id: a.agent_id }).first('id');
  if (userAgent) aNotifier.push(userAgent.id);
  let detail;
  if (a.type === 'ELEVATION_GRADE') {
    const avant = await trx('agents as a').leftJoin('grades as g', 'g.id', 'a.grade_id').where('a.id', a.agent_id).first('g.code_officiel', 'g.libelle');
    const g = await trx('grades').where({ id: a.grade_id }).first();
    await trx('agents').where({ id: a.agent_id }).update({ grade_id: g.id, updated_at: trx.fn.now() });
    detail = `Grade ${avant && avant.code_officiel ? `${avant.code_officiel} — ${avant.libelle}` : 'non renseigné'} → ${libelleGrade(g)} au ${fr(a.date_debut)} ; fonction, affectation et rôle inchangés.`;
  } else {
    const p = await trx('postes_organiques').where({ id: a.poste_id }).first();
    const structure = await structurePoste(p, trx);
    if (a.type === 'NOMINATION') {
      // L’intérim en cours sur ce poste prend fin avec la nomination du titulaire.
      const interims = await trx('actes_administratifs').where({ type: 'INTERIM', statut: 'VALIDE', poste_id: p.id }).where('date_fin', '>=', a.date_debut);
      for (const i of interims) {
        await trx('actes_administratifs').where({ id: i.id }).update({ statut: 'EXPIRE', fin_notifiee_at: trx.fn.now(), updated_at: trx.fn.now() });
        await trx('user_permissions').where({ acte_id: i.id }).whereNull('revoked_at').update({ revoked_at: trx.fn.now(), revoked_by: userId, motif_revocation: `Nomination du titulaire (acte ${a.numero})` });
        aNotifier.push(...await trx('users').where({ agent_id: i.agent_id }).pluck('id'));
      }
      await reaffecter(trx, a.agent_id, structure, p.id, a.date_debut, a, userId);
      const fonction = await trx('fonctions').where({ code: FONCTIONS[p.role_associe] }).first('id');
      if (fonction) await trx('agents').where({ id: a.agent_id }).update({ fonction_id: fonction.id, updated_at: trx.fn.now() });
      await definirRole(trx, a.agent_id, p.role_associe, userId);
      aNotifier.push(...await superieur(p, trx));
      detail = `Titulaire du poste « ${p.libelle} » au ${fr(a.date_debut)}${interims.length ? ` ; intérim ${interims.map((i) => i.numero).join(', ')} clôturé` : ''}.`;
    } else if (a.type === 'AFFECTATION') {
      const { avant } = await reaffecter(trx, a.agent_id, structure, p.id, a.date_debut, a, userId);
      await definirRole(trx, a.agent_id, 'AGENT', userId);
      detail = `Affecté au poste « ${p.libelle} » au ${fr(a.date_debut)}${avant ? ' ; affectation précédente clôturée' : ''}.`;
    } else {
      // Fin de fonction : l’agent reste dans la structure du poste, sur le poste d’exécution s’il existe.
      const execution = await trx('postes_organiques').where({ role_associe: 'AGENT', actif: true, niveau: p.niveau })
        .modify((q) => (p.bureau_id ? q.where('bureau_id', p.bureau_id) : q.where('division_id', structure.division_id))).first('id');
      await reaffecter(trx, a.agent_id, structure, execution ? execution.id : null, a.date_debut, a, userId);
      await trx('agents').where({ id: a.agent_id }).update({ fonction_id: null, updated_at: trx.fn.now() });
      await definirRole(trx, a.agent_id, 'AGENT', userId);
      aNotifier.push(...await superieur(p, trx));
      detail = `Fin de fonction de « ${p.libelle} » au ${fr(a.date_debut)} ; l’agent reste dans la structure, son grade est conservé.`;
    }
  }
  await trx('actes_administratifs').where({ id: a.id }).update({ effet_applique_at: trx.fn.now(), effet_detail: detail, updated_at: trx.fn.now() });
  return { detail, aNotifier: [...new Set(aNotifier)] };
}

/** Agents de grade de commandement sans poste de commandement (cahier, § 12 : « promu en attente de poste »). */
async function promusEnAttente(trx = db) {
  return trx('agents as ag').join('grades as g', 'g.id', 'ag.grade_id')
    .leftJoin('affectations as a', function j() { this.on('a.agent_id', 'ag.id').andOn('a.est_active', trx.raw('true')); })
    .leftJoin('postes_organiques as p', 'p.id', 'a.poste_id')
    .leftJoin('bureaux as b', 'b.id', 'a.bureau_id').leftJoin('divisions as d', 'd.id', 'a.division_id')
    .whereIn('g.code', ['DIR', 'CD', 'CB']).whereNull('ag.archived_at').where('ag.est_autorite', false)
    .where((w) => w.whereNull('p.role_associe').orWhereNotIn('p.role_associe', COMMANDEMENT))
    .orderBy(['g.niveau', 'ag.nom'])
    .select('ag.id', 'ag.matricule', 'ag.nom', 'ag.postnom', 'ag.prenom', 'g.code_officiel', 'g.libelle as grade',
      db.raw(`COALESCE(b.nom, d.nom, 'Direction') as structure`),
      db.raw('(SELECT max(h.date_effet) FROM agent_grades h WHERE h.agent_id = ag.id AND h.grade_id = ag.grade_id) as depuis'));
}

/**
 * Carrière d’un agent : affectations, grades, nominations, élévations, intérims, désignations et
 * fins de fonction, chacun lié à son acte, du plus récent au plus ancien.
 */
async function carriere(agentId, trx = db) {
  const [affectations, grades, actes] = await Promise.all([
    trx('affectations as a').leftJoin('postes_organiques as p', 'p.id', 'a.poste_id').leftJoin('bureaux as b', 'b.id', 'a.bureau_id').leftJoin('divisions as d', 'd.id', 'a.division_id')
      .leftJoin('actes_administratifs as x', 'x.id', 'a.acte_id').where('a.agent_id', agentId)
      .select('a.id', 'a.date_debut', 'a.date_fin', 'a.est_active', 'a.motif', 'a.motif_cloture', 'p.libelle as poste', 'b.nom as bureau', 'd.nom as division', 'x.id as acte_id', 'x.numero as acte_numero'),
    trx('agent_grades as h').join('grades as g', 'g.id', 'h.grade_id').leftJoin('grades as o', 'o.id', 'h.ancien_grade_id').leftJoin('actes_administratifs as x', 'x.id', 'h.acte_id')
      .where('h.agent_id', agentId).select('h.id', 'h.date_effet', 'h.motif', 'g.code_officiel', 'g.libelle', 'o.code_officiel as ancien_code', 'o.libelle as ancien_libelle', 'x.id as acte_id', 'x.numero as acte_numero'),
    trx('actes_administratifs as x').leftJoin('postes_organiques as p', 'p.id', 'x.poste_id').where('x.agent_id', agentId).whereIn('x.statut', ['VALIDE', 'EXPIRE', 'REVOQUE', 'REMPLACE'])
      .whereIn('x.type', ['INTERIM', 'DESIGNATION', 'FIN_FONCTION', 'NOMINATION'])
      .select('x.id', 'x.numero', 'x.type', 'x.statut', 'x.objet', 'x.date_debut', 'x.date_fin', 'x.reference', 'x.effet_applique_at', 'p.libelle as poste'),
  ]);
  const ev = [];
  for (const a of affectations) {
    ev.push({ date: iso(a.date_debut), type: 'AFFECTATION', titre: `Affectation : ${a.poste || 'sans poste'}`, detail: [a.bureau || a.division || 'Direction', a.date_fin ? `jusqu’au ${fr(a.date_fin)}` : 'en cours'].join(' · '), acte_id: a.acte_id, acte_numero: a.acte_numero, en_cours: a.est_active });
  }
  for (const g of grades) {
    ev.push({ date: iso(g.date_effet), type: 'GRADE', titre: `Grade ${g.code_officiel} — ${g.libelle}`, detail: g.ancien_code ? `${g.motif} (précédent : ${g.ancien_code} — ${g.ancien_libelle})` : g.motif, acte_id: g.acte_id, acte_numero: g.acte_numero });
  }
  const TITRES = { INTERIM: 'Intérim', DESIGNATION: 'Désignation', FIN_FONCTION: 'Fin de fonction', NOMINATION: 'Nomination' };
  for (const x of actes) {
    if (x.type === 'NOMINATION' && x.effet_applique_at) continue; // l’affectation liée à l’acte la retrace déjà
    ev.push({
      date: iso(x.date_debut), type: x.type, titre: `${TITRES[x.type]} : ${x.poste || x.objet}`,
      detail: [x.date_fin ? `jusqu’au ${fr(x.date_fin)}` : null, { EXPIRE: 'échu', REVOQUE: 'révoqué', REMPLACE: 'remplacé' }[x.statut], x.type !== 'INTERIM' && x.type !== 'DESIGNATION' && !x.effet_applique_at ? 'effet à venir' : null].filter(Boolean).join(' · '),
      acte_id: x.id, acte_numero: x.numero,
    });
  }
  return ev.sort((a, b) => b.date.localeCompare(a.date) || (a.type === 'GRADE' ? 1 : -1));
}

module.exports = { PERMANENTS, controler, appliquer, promusEnAttente, carriere };

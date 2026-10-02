'use strict';
/**
 * Tableaux de bord adaptés au rôle principal de l’utilisateur.
 * Le Chef du Bureau Secrétariat de Direction reçoit un tableau de bord de Chef de Bureau
 * (aucune fonctionnalité de Chef de Division).
 */
const express = require('express');
const db = require('../../db/knex');
const { performanceParStructure, statutsCount } = require('../../services/stats');
const { scopeDocuments, scopeInstructions, scopeTasks, scopeCourriers, scopePip, scopePresences } = require('../../services/access');
const { DEP_NOM } = require('../../constants');
const liste = require('../../services/listeDeclarative');
const { donneesDemo } = require('../../services/reinitialisation');

const router = express.Router();

const nomSql = (alias) => db.raw(`concat_ws(' ', ${alias}.prenom, ${alias}.nom) as nom`);

async function agentsCount(where = {}) {
  return Number((await db('affectations').where({ est_active: true, ...where }).count('* as n').first()).n);
}

async function commun(ctx) {
  const [nonLues, echeances] = await Promise.all([
    db('notifications').where({ user_id: ctx.userId, lu: false }).count('* as n').first(),
    db('tasks').where('agent_user_id', ctx.userId).whereIn('statut', ['TRANSMISE', 'RECUE', 'EN_COURS', 'A_CORRIGER', 'EN_RETARD']).whereNotNull('echeance')
      .unionAll(db('instructions').where('destinataire_user_id', ctx.userId).whereIn('statut', ['TRANSMISE', 'RECUE', 'EN_COURS', 'A_CORRIGER', 'EN_RETARD']).whereNotNull('echeance')
        .select('id', db.raw(`'INSTRUCTION' as type`), 'reference', 'objet as titre', 'echeance', 'statut'), true)
      .select('id', db.raw(`'TACHE' as type`), 'reference', 'titre', 'echeance', 'statut')
      .orderBy('echeance').limit(10),
  ]);
  return { notificationsNonLues: Number(nonLues.n), echeances };
}

async function adminDashboard() {
  const comptes = await db('users').select('statut').count('* as n').groupBy('statut');
  const by = Object.fromEntries(comptes.map((c) => [c.statut, Number(c.n)]));
  const [mustChange, sessions, connexions24, echecs24, audit, dbSize, migrations] = await Promise.all([
    db('users').where({ must_change_password: true }).count('* as n').first(),
    db('refresh_tokens').whereNull('revoked_at').where('expires_at', '>', db.fn.now()).countDistinct('user_id as n').first(),
    db('login_history').where('succes', true).where('created_at', '>', db.raw(`now() - interval '24 hours'`)).count('* as n').first(),
    db('login_history').where('succes', false).where('created_at', '>', db.raw(`now() - interval '24 hours'`)).count('* as n').first(),
    db('audit_logs').orderBy('id', 'desc').limit(12),
    db.raw('select pg_size_pretty(pg_database_size(current_database())) as taille'),
    db('knex_migrations').orderBy('id', 'desc').first(),
  ]);
  const verrouilles = await db('users').where({ statut: 'VERROUILLE' }).select('id', 'username', 'locked_until');
  return {
    comptes: { total: Object.values(by).reduce((a, b) => a + b, 0), actifs: by.ACTIF || 0, desactives: by.DESACTIVE || 0, verrouilles: by.VERROUILLE || 0, changementMdpRequis: Number(mustChange.n) },
    securite: { utilisateursConnectes: Number(sessions.n), connexions24h: Number(connexions24.n), echecsConnexion24h: Number(echecs24.n), comptesVerrouilles: verrouilles },
    audit,
    systeme: { baseDeDonnees: 'Opérationnelle', tailleBase: dbSize.rows[0].taille, derniereMigration: migrations ? migrations.name : null, uptimeSecondes: Math.round(process.uptime()), node: process.version },
  };
}

async function sgDashboard(ctx) {
  const [perf, instructionsDir, instrStats, taskStats, docsValides, pip, courriers] = await Promise.all([
    performanceParStructure(),
    db('instructions as i').join('users as u', 'u.id', 'i.destinataire_user_id').leftJoin('agents as a', 'a.id', 'u.agent_id')
      .where('i.emetteur_user_id', ctx.userId).orderBy('i.created_at', 'desc').limit(15)
      .select('i.id', 'i.reference', 'i.objet', 'i.statut', 'i.avancement', 'i.echeance', 'i.date_reponse', nomSql('a')),
    statutsCount('instructions', (q) => q.whereNot('statut', 'BROUILLON')),
    statutsCount('tasks'),
    db('documents').whereIn('statut', ['VALIDE', 'ARCHIVE']).count('* as n').first(),
    db('pip_projects').whereNot('statut', 'BROUILLON').select('statut').count('* as n').sum('cout_total as cout').groupBy('statut'),
    statutsCount('courriers'),
  ]);
  return {
    vueGlobale: {
      direction: DEP_NOM,
      divisions: perf.divisions.length,
      bureaux: Number((await db('bureaux').where({ actif: true }).count('* as n').first()).n),
      bureauxRattachesDirection: perf.bureauxRattachesDirection.length,
      agents: await agentsCount(),
    },
    instructionsAuDirecteur: instructionsDir,
    statistiques: { instructions: instrStats, taches: taskStats, documentsValides: Number(docsValides.n), courriers },
    pip: pip.map((p) => ({ statut: p.statut, nombre: Number(p.n), cout: Number(p.cout || 0) })),
    performance: perf,
  };
}

async function directeurDashboard(ctx) {
  const [perf, tachesRetard, instructionsRetard, docsAValider, presencesSoumises, courriersRecevoir, courriersCirculation, pipAValider, instructionsSG, presSemaine] = await Promise.all([
    performanceParStructure(),
    db('tasks as t').join('users as u', 'u.id', 't.agent_user_id').leftJoin('agents as a', 'a.id', 'u.agent_id').leftJoin('bureaux as b', 'b.id', 't.bureau_id')
      .where('t.statut', 'EN_RETARD').orderBy('t.echeance').limit(15).select('t.id', 't.reference', 't.titre', 't.echeance', 'b.nom as bureau', nomSql('a')),
    db('instructions').where('statut', 'EN_RETARD').orderBy('echeance').limit(10).select('id', 'reference', 'objet', 'echeance', 'destinataire_role'),
    db('documents').where({ detenteur_user_id: ctx.userId }).whereIn('statut', ['EN_EXAMEN']).whereNot('auteur_user_id', ctx.userId).orderBy('updated_at', 'desc').select('id', 'reference', 'titre', 'type_document', 'updated_at'),
    db('presence_sheets as s').leftJoin('bureaux as b', 'b.id', 's.bureau_id').where('s.statut', 'SOUMISE').select('s.id', 's.reference', 's.submitted_at', 'b.nom as bureau'),
    db('courrier_transmissions as t').join('courriers as c', 'c.id', 't.courrier_id').where({ 't.to_user_id': ctx.userId, 't.etat_reception': 'EN_ATTENTE' }).select('c.id', 'c.numero_enregistrement', 'c.objet', 'c.urgence', 't.created_at'),
    statutsCount('courriers'),
    db('pip_projects').where({ detenteur_user_id: ctx.userId, statut: 'VERIFIE' }).select('id', 'code', 'intitule', 'cout_total', 'devise'),
    db('instructions').where({ destinataire_user_id: ctx.userId }).whereNotIn('statut', ['CLOTUREE', 'BROUILLON']).orderBy('created_at', 'desc').limit(10).select('id', 'reference', 'objet', 'statut', 'echeance', 'avancement'),
    presenceSemaine(),
  ]);
  return {
    performance: perf, tachesEnRetard: tachesRetard, instructionsEnRetard: instructionsRetard, documentsAValider: docsAValider,
    presencesSoumises, presencesSemaine: presSemaine, courriersARecevoir: courriersRecevoir, courriers: courriersCirculation,
    pipAValider, instructionsRecues: instructionsSG,
    pip: await statutsCount('pip_projects'),
  };
}

async function presenceSemaine(where = (q) => q) {
  const last = await where(db('presence_sheets as s')).whereIn('s.statut', ['SOUMISE', 'VERROUILLEE']).max('s.semaine_debut as d').first();
  if (!last || !last.d) return null;
  const rows = await where(db('presence_entries as e').join('presence_sheets as s', 's.id', 'e.sheet_id'))
    .where('s.semaine_debut', last.d).whereIn('s.statut', ['SOUMISE', 'VERROUILLEE']).select('e.lundi', 'e.mardi', 'e.mercredi', 'e.jeudi', 'e.vendredi');
  const tot = {};
  let n = 0;
  for (const r of rows) for (const j of ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi']) { tot[r[j]] = (tot[r[j]] || 0) + 1; n += 1; }
  return { semaine: last.d, repartition: tot, tauxPresence: n ? Math.round((((tot.PRESENT || 0) + (tot.RETARD || 0) + (tot.MISSION || 0)) / n) * 100) : null };
}

async function chefDivisionDashboard(ctx) {
  const div = await db('divisions').where({ id: ctx.divisionId }).first();
  const [perf, docs, tasks, instr, pres, pipAVerifier] = await Promise.all([
    performanceParStructure({ divisionId: ctx.divisionId }),
    db('documents').where({ detenteur_user_id: ctx.userId }).whereIn('statut', ['EN_EXAMEN', 'VALIDE_DIVISION']).whereNot('auteur_user_id', ctx.userId).select('id', 'reference', 'titre', 'statut', 'updated_at'),
    statutsCount('tasks', (q) => q.where('division_id', ctx.divisionId)),
    scopeInstructions(db('instructions as i'), ctx).where('i.destinataire_user_id', ctx.userId).whereNotIn('i.statut', ['CLOTUREE']).select('i.id', 'i.reference', 'i.objet', 'i.statut', 'i.echeance', 'i.avancement').orderBy('i.created_at', 'desc').limit(10),
    scopePresences(db('presence_sheets as s'), ctx).orderBy('s.semaine_debut', 'desc').limit(8).leftJoin('bureaux as b', 'b.id', 's.bureau_id').select('s.id', 's.reference', 's.statut', 'b.nom as bureau'),
    db('pip_projects').where({ detenteur_user_id: ctx.userId, statut: 'EN_VERIFICATION' }).select('id', 'code', 'intitule'),
  ]);
  return {
    division: div ? { id: div.id, nom: div.nom, missions: div.missions } : null,
    bureaux: perf.divisions[0] ? perf.divisions[0].bureaux : [],
    indicateurs: perf.divisions[0] || null,
    documentsAExaminer: docs, taches: tasks, instructionsRecues: instr, presences: pres, pipAVerifier,
    tachesEnRetard: await db('tasks').where({ division_id: ctx.divisionId, statut: 'EN_RETARD' }).select('id', 'reference', 'titre', 'echeance'),
    presencesSemaine: await presenceSemaine((q) => q.where('s.division_id', ctx.divisionId)),
  };
}

async function chefBureauDashboard(ctx) {
  const bureau = await db('bureaux as b').leftJoin('divisions as d', 'd.id', 'b.division_id').where('b.id', ctx.bureauId).first('b.*', 'd.nom as division_nom');
  const [agents, tasksStats, tasks, docs, pres, instr] = await Promise.all([
    db('affectations as a').join('agents as ag', 'ag.id', 'a.agent_id').leftJoin('postes_organiques as p', 'p.id', 'a.poste_id').leftJoin('users as u', 'u.agent_id', 'ag.id')
      .where({ 'a.bureau_id': ctx.bureauId, 'a.est_active': true })
      .select('ag.id', 'ag.matricule', 'p.libelle as poste', 'u.id as user_id', nomSql('ag'),
        db.raw(`(SELECT count(*) FROM tasks t WHERE t.agent_user_id = u.id AND t.statut IN ('TRANSMISE','RECUE','EN_COURS','A_CORRIGER','EN_RETARD'))::int as taches_en_cours`)),
    statutsCount('tasks', (q) => q.where('bureau_id', ctx.bureauId)),
    db('tasks as t').join('users as u', 'u.id', 't.agent_user_id').leftJoin('agents as a', 'a.id', 'u.agent_id').where('t.bureau_id', ctx.bureauId)
      .whereNotIn('t.statut', ['CLOTUREE']).orderBy('t.echeance').limit(15).select('t.id', 't.reference', 't.titre', 't.statut', 't.avancement', 't.echeance', nomSql('a')),
    db('documents').where({ detenteur_user_id: ctx.userId, statut: 'EN_EXAMEN' }).whereNot('auteur_user_id', ctx.userId).select('id', 'reference', 'titre', 'updated_at'),
    db('presence_sheets').where({ bureau_id: ctx.bureauId }).orderBy('semaine_debut', 'desc').limit(6).select('id', 'reference', 'statut', 'semaine_debut'),
    db('instructions').where({ destinataire_user_id: ctx.userId }).whereNotIn('statut', ['CLOTUREE']).orderBy('created_at', 'desc').limit(10).select('id', 'reference', 'objet', 'statut', 'echeance', 'avancement'),
  ]);
  return {
    // Le Bureau Secrétariat de Direction reste un Bureau : tableau de bord de Chef de Bureau.
    bureau: bureau ? {
      id: bureau.id, nom: bureau.nom, rangOrganique: bureau.rang_organique,
      rattachement: bureau.parent_type === 'DIRECTION' ? 'Bureau directement rattaché au Directeur' : `Rattaché à la ${bureau.division_nom}`,
      superieurDirect: bureau.superieur_direct === 'DIRECTEUR' ? 'Directeur' : 'Chef de Division',
      estSecretariatDirection: bureau.est_secretariat_direction,
    } : null,
    agents, taches: tasksStats, tachesEnCours: tasks, documentsAVerifier: docs, presences: pres, instructionsRecues: instr,
    delegations: ctx.delegations,
    presencesSemaine: await presenceSemaine((q) => q.where('s.bureau_id', ctx.bureauId)),
  };
}

async function agentDashboard(ctx) {
  const [taches, docs, notifs] = await Promise.all([
    db('tasks').where({ agent_user_id: ctx.userId }).whereNotIn('statut', ['CLOTUREE']).orderBy('echeance').select('id', 'reference', 'titre', 'statut', 'avancement', 'echeance', 'priorite'),
    db('documents').where({ auteur_user_id: ctx.userId }).whereNotIn('statut', ['ARCHIVE']).orderBy('updated_at', 'desc').limit(10).select('id', 'reference', 'titre', 'statut', 'updated_at'),
    db('notifications').where({ user_id: ctx.userId }).orderBy('created_at', 'desc').limit(8),
  ]);
  const a = ctx.affectation;
  return {
    profil: {
      nom: ctx.agent ? [ctx.agent.prenom, ctx.agent.nom, ctx.agent.postnom].filter(Boolean).join(' ') : ctx.username,
      matricule: ctx.agent?.matricule, bureau: a?.bureau_nom, division: a?.est_secretariat_direction ? 'Aucune' : a?.division_nom, poste: a?.poste_libelle,
    },
    taches, documents: docs, notifications: notifs,
  };
}

router.get('/', async (req, res) => {
  const ctx = req.ctx;
  const base = { role: ctx.primaryRole, perimetre: ctx.perimetre, ...(await commun(ctx)) };
  let data;
  switch (ctx.primaryRole) {
    case 'SECRETAIRE_GENERAL': data = await sgDashboard(ctx); break;
    case 'DIRECTEUR': data = await directeurDashboard(ctx); break;
    case 'CHEF_DIVISION': data = ctx.perimetre === 'DIVISION' ? await chefDivisionDashboard(ctx) : await agentDashboard(ctx); break;
    case 'CHEF_BUREAU': data = ctx.perimetre === 'BUREAU' ? await chefBureauDashboard(ctx) : await agentDashboard(ctx); break;
    case 'AGENT': data = await agentDashboard(ctx); break;
    default: data = {};
  }
  if (ctx.roles.includes('ADMIN_SYSTEME')) data.admin = { ...(await adminDashboard()), donneesDemo: await donneesDemo() };
  // Mise en service des comptes (Admin, Directeur, Bureau Secrétariat de Direction)
  if (ctx.can('liste.consulter') || ctx.can('compte.enroler')) data.miseEnService = await liste.progression();
  res.json({ ...base, ...data });
});

// Compteurs rapides pour le menu (éléments en attente d’action)
router.get('/compteurs', async (req, res) => {
  const ctx = req.ctx;
  const [docs, instr, taches, courriers, pip, pres] = await Promise.all([
    ctx.can('documents.consulter') ? scopeDocuments(db('documents as d'), ctx).where('d.detenteur_user_id', ctx.userId).whereIn('d.statut', ['EN_EXAMEN', 'VALIDE_DIVISION', 'A_CORRIGER']).count('* as n').first() : { n: 0 },
    ctx.can('instructions.consulter') ? scopeInstructions(db('instructions as i'), ctx).where('i.destinataire_user_id', ctx.userId).whereIn('i.statut', ['TRANSMISE', 'A_CORRIGER']).count('* as n').first() : { n: 0 },
    ctx.can('taches.consulter') ? scopeTasks(db('tasks as t'), ctx).where((w) => w.where((x) => x.where('t.agent_user_id', ctx.userId).whereIn('t.statut', ['TRANSMISE', 'A_CORRIGER'])).orWhere((x) => x.where('t.assigne_par_user_id', ctx.userId).where('t.statut', 'EXECUTEE'))).count('* as n').first() : { n: 0 },
    ctx.can('courriers.consulter') ? scopeCourriers(db('courriers as c'), ctx).whereExists(db('courrier_transmissions as t').whereRaw('t.courrier_id = c.id').where({ 't.to_user_id': ctx.userId, 't.etat_reception': 'EN_ATTENTE' })).count('* as n').first() : { n: 0 },
    ctx.can('pip.consulter') ? scopePip(db('pip_projects as p'), ctx).where('p.detenteur_user_id', ctx.userId).whereIn('p.statut', ['EN_VERIFICATION', 'VERIFIE', 'A_CORRIGER']).count('* as n').first() : { n: 0 },
    ctx.can('presences.verrouiller') ? db('presence_sheets').where('statut', 'SOUMISE').count('* as n').first() : { n: 0 },
  ]);
  const alertes = ctx.can('securite.superviser') ? await db('alertes_securite').whereNull('acquittee_at').whereIn('gravite', ['ATTENTION', 'CRITIQUE']).count('* as n').first() : { n: 0 };
  res.json({ documents: Number(docs.n), instructions: Number(instr.n), taches: Number(taches.n), courriers: Number(courriers.n), pip: Number(pip.n), presences: Number(pres.n), alertes: Number(alertes.n) });
});

module.exports = router;

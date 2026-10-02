'use strict';
/**
 * Liste déclarative des agents de la Direction : consultation, inscription / retrait,
 * validation par le Directeur (ou l’Admin), historique et export signable.
 */
const express = require('express');
const { z } = require('zod');
const db = require('../../db/knex');
const validate = require('../../middleware/validate');
const { requirePerm } = require('../../middleware/auth');
const { audit } = require('../../services/audit');
const { notify } = require('../../services/notifications');
const liste = require('../../services/listeDeclarative');
const pdf = require('../../services/pdf');
const { sendWorkbook } = require('../../services/excel');
const { notFound, badRequest } = require('../../utils/errors');
const { DEP_NOM } = require('../../constants');

const router = express.Router();
const idParam = z.object({ id: z.coerce.number().int().positive() });

router.get('/', requirePerm('liste.consulter'), async (req, res) => {
  const [e, prog, historique] = await Promise.all([
    liste.etat(), liste.progression(),
    db('listes_declaratives_validations as v').join('users as u', 'u.id', 'v.valide_par').leftJoin('agents as ag', 'ag.id', 'u.agent_id')
      .orderBy('v.id', 'desc').limit(20).select('v.id', 'v.valide_at', 'v.nb_agents', 'v.valide_par_role', 'v.commentaire', 'u.username', db.raw(`NULLIF(concat_ws(' ', ag.prenom, ag.nom), '') as valide_par_nom`)),
  ]);
  res.json({
    statut: e.statut, validation: e.validation ? { ...e.validation, agents: undefined } : null,
    ecarts: { ajoutes: e.ecarts.ajoutes.length, modifies: e.ecarts.modifies.length, retires: e.ecarts.retires },
    agents: e.agents, progression: prog, historique,
    actions: { valider: req.ctx.can('liste.valider'), gerer: req.ctx.can('liste.gerer') },
  });
});

router.post('/valider', requirePerm('liste.valider'), validate({ body: z.object({ commentaire: z.string().trim().max(1000).optional() }) }), async (req, res) => {
  const e = await liste.etat();
  if (!e.agents.length) throw badRequest('La liste déclarative est vide : importez ou inscrivez d’abord les agents.');
  if (e.statut === 'VALIDEE') throw badRequest('La liste est déjà validée et n’a pas changé depuis.');
  const v = await liste.valider(req.ctx, req.valid.body.commentaire);
  await audit(req, { action: 'VALIDATION', module: 'liste_declarative', entite: 'validation', entiteId: v.id, apres: { nb_agents: v.nb_agents, role: v.valide_par_role }, message: `Validation de la liste déclarative (${v.nb_agents} agents)` });
  // Information de l’Admin et du Bureau Secrétariat : les enrôlements peuvent commencer.
  const destinataires = await db('users as u')
    .leftJoin('user_roles as ur', 'ur.user_id', 'u.id').leftJoin('roles as r', 'r.id', 'ur.role_id')
    .leftJoin('affectations as a', function j() { this.on('a.agent_id', 'u.agent_id').andOn('a.est_active', db.raw('true')); })
    .leftJoin('bureaux as b', 'b.id', 'a.bureau_id')
    .where('u.statut', 'ACTIF').where((w) => w.where('r.code', 'ADMIN').orWhere('b.est_secretariat_direction', true)).distinct().pluck('u.id');
  await notify(destinataires, { type: 'COMPTE_CREE', titre: 'Liste déclarative validée : enrôlement des agents ouvert', message: `${v.nb_agents} agent(s) sur la liste validée.`, lien: '/comptes/enrolement', expediteur: req.ctx.userId });
  res.status(201).json({ message: 'Liste déclarative validée.', validation: { id: v.id, valide_at: v.valide_at, nb_agents: v.nb_agents } });
});

async function setInscription(req, res, inscrit) {
  const a = await db('agents').where({ id: req.valid.params.id }).first();
  if (!a) throw notFound('Agent introuvable.');
  if (a.est_autorite) throw badRequest('Une autorité hors DEP ne figure pas sur la liste déclarative.');
  if (!inscrit && await db('users').where({ agent_id: a.id }).first()) throw badRequest('Cet agent possède déjà un compte : désactivez ou archivez son compte et sa fiche plutôt que de le retirer de la liste.');
  await db('agents').where({ id: a.id }).update({ liste_declarative: inscrit, updated_at: db.fn.now() });
  await audit(req, { action: 'MODIFICATION', module: 'liste_declarative', entite: 'agent', entiteId: a.id, avant: { liste_declarative: a.liste_declarative }, apres: { liste_declarative: inscrit }, message: inscrit ? 'Inscription sur la liste déclarative' : 'Retrait de la liste déclarative' });
  res.json({ message: inscrit ? 'Agent inscrit sur la liste déclarative (à revalider).' : 'Agent retiré de la liste déclarative (à revalider).' });
}

router.post('/agents/:id/inscrire', requirePerm('liste.gerer'), validate({ params: idParam }), (req, res) => setInscription(req, res, true));
router.post('/agents/:id/retirer', requirePerm('liste.gerer'), validate({ params: idParam }), (req, res) => setInscription(req, res, false));

router.get('/export/:format', requirePerm('liste.consulter'), validate({ params: z.object({ format: z.enum(['pdf', 'xlsx']) }) }), async (req, res) => {
  const e = await liste.etat();
  const structure = (a) => (a.bureau_nom ? `${a.bureau_nom}${a.est_secretariat_direction ? ' (rattaché au Directeur)' : a.division_nom ? ` — ${a.division_nom}` : ''}` : a.division_nom || 'Sans affectation');
  const columns = [
    { header: 'N°', value: (a) => e.agents.indexOf(a) + 1, width: 5 },
    { header: 'Nom, postnom et prénom', value: (a) => [a.nom, a.postnom, a.prenom].filter(Boolean).join(' '), width: 32 },
    { header: 'Matricule', key: 'matricule', width: 13 }, { header: 'Grade', key: 'grade_code', width: 8 },
    { header: 'Structure', value: structure, width: 46 }, { header: 'Poste', key: 'poste', width: 30 },
  ];
  const statut = { NON_VALIDEE: 'Non validée', VALIDEE: 'Validée', A_REVALIDER: 'À revalider' }[e.statut];
  // Liste officielle seulement si elle est validée et inchangée ; sinon, projet.
  const titre = e.statut === 'VALIDEE' ? 'LISTE DÉCLARATIVE OFFICIELLE DES AGENTS' : 'PROJET DE LISTE DÉCLARATIVE DES AGENTS (NON VALIDÉ)';
  const sous = `${DEP_NOM} — ${e.agents.length} agent(s) — Statut : ${statut}${e.validation ? ` (dernière validation le ${pdf.fmtDateTime(e.validation.valide_at)})` : ''}`;
  await audit(req, { action: 'EXPORT', module: 'liste_declarative', message: req.valid.params.format.toUpperCase() });
  if (req.valid.params.format === 'xlsx') return sendWorkbook(res, e.statut === 'VALIDEE' ? 'liste-officielle-agents-DEP.xlsx' : 'projet-liste-declarative-DEP.xlsx', [{ name: 'Liste déclarative', titre, sousTitre: sous, columns, rows: e.agents }]);
  const { doc, finish } = pdf.createPdf(res, { filename: e.statut === 'VALIDEE' ? 'liste-officielle-agents-DEP.pdf' : 'projet-liste-declarative-DEP.pdf', titre, sousTitre: sous, landscape: true });
  pdf.table(doc, columns, e.agents, { fontSize: 8 });
  pdf.signatureBlock(doc, [{ libelle: 'Le Directeur', nom: e.validation && e.validation.valide_par_role === 'DIRECTEUR' ? e.validation.valide_par_nom : '' }]);
  return finish();
});

module.exports = router;

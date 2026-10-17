'use strict';
/**
 * Recherche globale. Chaque catégorie réutilise le filtre de périmètre de son module :
 * un résultat hors du périmètre administratif de l’utilisateur n’est jamais renvoyé.
 */
const express = require('express');
const { z } = require('zod');
const db = require('../../db/knex');
const validate = require('../../middleware/validate');
const { scopeInstructions, scopeTasks, scopeCourriers, scopeDocuments, scopePip } = require('../../services/access');
const agents = require('../agents/routes');

const router = express.Router();
const LIMIT = 6;

function like(q, cols, term) {
  return q.where((w) => { for (const c of cols) w.orWhereILike(c, `%${term}%`); });
}

router.get('/', validate({ query: z.object({ q: z.string().trim().min(2, 'au moins 2 caractères').max(100) }) }), async (req, res) => {
  const { ctx } = req;
  const t = req.valid.query.q;
  const jobs = [];

  if (ctx.can('personnel.consulter') || ctx.can('personnel.suivre')) {
    jobs.push(like(agents.scopeAgents(agents.baseQuery(), ctx), ['ag.nom', 'ag.postnom', 'ag.prenom', 'ag.matricule'], t).whereNull('ag.archived_at').limit(LIMIT)
      .select('ag.id', 'ag.matricule', 'ag.nom', 'ag.postnom', 'ag.prenom', 'b.nom as bureau_nom', 'd.nom as division_nom')
      .then((rows) => ['agents', rows.map((r) => ({ id: r.id, titre: [r.prenom, r.nom, r.postnom].filter(Boolean).join(' '), sousTitre: `${r.matricule} · ${r.bureau_nom || r.division_nom || 'Direction'}`, lien: `/personnel/${r.id}` }))]));
  }
  if (ctx.can('instructions.consulter')) {
    jobs.push(like(scopeInstructions(db('instructions as i'), ctx), ['i.objet', 'i.reference', 'i.contenu'], t)
      .where((w) => w.whereNot('i.statut', 'BROUILLON').orWhere('i.emetteur_user_id', ctx.userId))
      .orderBy('i.created_at', 'desc').limit(LIMIT).select('i.id', 'i.reference', 'i.objet', 'i.statut')
      .then((rows) => ['instructions', rows.map((r) => ({ id: r.id, titre: r.objet, sousTitre: r.reference, statut: r.statut, lien: `/instructions/${r.id}` }))]));
  }
  if (ctx.can('taches.consulter')) {
    jobs.push(like(scopeTasks(db('tasks as t'), ctx), ['t.titre', 't.reference', 't.description'], t)
      .orderBy('t.created_at', 'desc').limit(LIMIT).select('t.id', 't.reference', 't.titre', 't.statut')
      .then((rows) => ['taches', rows.map((r) => ({ id: r.id, titre: r.titre, sousTitre: r.reference, statut: r.statut, lien: `/taches/${r.id}` }))]));
  }
  if (ctx.can('courriers.consulter')) {
    jobs.push(like(scopeCourriers(db('courriers as c'), ctx), ['c.objet', 'c.numero_enregistrement', 'c.expediteur', 'c.destinataire', 'c.reference_externe'], t)
      .orderBy('c.date_enregistrement', 'desc').limit(LIMIT).select('c.id', 'c.numero_enregistrement', 'c.objet', 'c.statut', 'c.expediteur')
      .then((rows) => ['courriers', rows.map((r) => ({ id: r.id, titre: r.objet, sousTitre: `${r.numero_enregistrement} · ${r.expediteur}`, statut: r.statut, lien: `/courriers/${r.id}` }))]));
  }
  if (ctx.can('documents.consulter')) {
    jobs.push(like(scopeDocuments(db('documents as d'), ctx), ['d.titre', 'd.reference'], t)
      .orderBy('d.updated_at', 'desc').limit(LIMIT).select('d.id', 'd.reference', 'd.titre', 'd.statut')
      .then((rows) => ['documents', rows.map((r) => ({ id: r.id, titre: r.titre, sousTitre: r.reference, statut: r.statut, lien: `/documents/${r.id}` }))]));
  }
  if (ctx.can('pip.consulter')) {
    jobs.push(like(scopePip(db('pip_projects as p'), ctx), ['p.intitule', 'p.code', 'p.secteur'], t)
      .orderBy('p.updated_at', 'desc').limit(LIMIT).select('p.id', 'p.code', 'p.intitule', 'p.statut')
      .then((rows) => ['pip', rows.map((r) => ({ id: r.id, titre: r.intitule, sousTitre: r.code, statut: r.statut, lien: `/pip/${r.id}` }))]));
  }
  if (ctx.can('donnees.consulter')) {
    jobs.push(like(db('sect_acteurs as a').join('sect_zones as z', 'z.id', 'a.zone_id'), ['a.raison_sociale', 'a.sigle', 'a.reference', 'a.rccm', 'a.id_nat', 'a.ville'], t)
      .orderBy('a.raison_sociale').limit(LIMIT).select('a.id', 'a.reference', 'a.raison_sociale', 'a.sigle', 'a.statut', 'z.libelle as zone')
      .then((rows) => ['acteurs', rows.map((r) => ({ id: r.id, titre: r.sigle ? `${r.raison_sociale} (${r.sigle})` : r.raison_sociale, sousTitre: `${r.reference} · ${r.zone}`, statut: r.statut, lien: `/donnees/acteurs/${r.id}` }))]));
    jobs.push(like(require('../donnees/routes').scopeCampagnes(db('sect_campagnes as c'), ctx), ['c.titre', 'c.reference', 'c.periode'], t)
      .orderBy('c.periode_debut', 'desc').limit(LIMIT).select('c.id', 'c.reference', 'c.titre', 'c.statut', 'c.periode')
      .then((rows) => ['campagnes', rows.map((r) => ({ id: r.id, titre: r.titre, sousTitre: `${r.reference} · ${r.periode}`, statut: r.statut, lien: `/donnees/campagnes/${r.id}` }))]));
  }
  const results = Object.fromEntries(await Promise.all(jobs));
  res.json({ q: t, resultats: results, total: Object.values(results).reduce((n, l) => n + l.length, 0) });
});

module.exports = router;

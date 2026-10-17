'use strict';
/**
 * Présences journalières (cahier des charges, sections 25 et 46, annexe 11).
 *  - Le Secrétariat de Direction (permission « presences.preparer_direction ») tient chaque jour
 *    ouvrable deux listes, Cadres et Agents : heure d’arrivée (H-A) et de départ (H-D), ou motif
 *    d’absence avec éventuellement une pièce.
 *  - Rapport hebdomadaire : en préparation → transmis au Directeur (les listes de la semaine sont
 *    verrouillées) → verrouillé définitivement, ou rejeté avec motif puis retransmis après
 *    rectificatifs.
 *  - Toute correction d’une liste transmise passe par un rectificatif validé par le Directeur ;
 *    l’original reste intact (déclencheurs PostgreSQL), les valeurs effectives l’intègrent.
 *  - Les Chefs de Division et de Bureau consultent les présences de leur structure ; le Secrétaire
 *    Général ne reçoit que des agrégats.
 * Les anciennes listes hebdomadaires par Bureau restent consultables sous /presences/anciennes.
 */
const express = require('express');
const { z } = require('zod');
const db = require('../../db/knex');
const validate = require('../../middleware/validate');
const { requirePerm } = require('../../middleware/auth');
const { audit } = require('../../services/audit');
const { notify } = require('../../services/notifications');
const { directeursActifs } = require('../../services/alertes');
const { addHistory, getHistory } = require('../../services/history');
const P = require('../../services/presences');
const exportsPresences = require('../../services/presencesExport');
const { notFound, badRequest, forbidden, conflict } = require('../../utils/errors');

const router = express.Router();
router.use('/anciennes', require('./anciennes'));

const idParam = z.object({ id: z.coerce.number().int().positive() });
const dateIso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date attendue au format AAAA-MM-JJ.');
const heure = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Heure attendue au format HH:MM.');
const STATUTS_SEMAINE = { EN_PREPARATION: 'En préparation', TRANSMIS: 'Transmis', VERROUILLE: 'Verrouillé', REJETE: 'Rejeté' };

/** Droits de la personne connectée sur les présences. */
function acces(ctx) {
  const gerer = ctx.can('presences.preparer_direction') && ctx.perimetre !== 'SUPERVISION_GLOBALE';
  const directeur = ctx.can('presences.verrouiller') && ctx.perimetre !== 'SUPERVISION_GLOBALE';
  const global = gerer || directeur;
  const sg = !global && ctx.perimetre === 'SUPERVISION_GLOBALE' && ctx.can('presences.consulter');
  const chef = !global && !sg && ctx.can('presences.consulter') && ['DIVISION', 'BUREAU'].includes(ctx.perimetre);
  return { gerer, directeur, global, sg, chef, consulter: global || sg || chef };
}
function exigerConsultation(ctx) {
  const a = acces(ctx);
  if (!a.consulter) throw forbidden('Vous n’avez pas accès aux présences de la Direction.');
  return a;
}
function exigerGestion(ctx) {
  const a = acces(ctx);
  if (!a.gerer) throw forbidden('La tenue des présences relève du Secrétariat de Direction.');
  return a;
}
/** Lignes visibles : toutes pour le Secrétariat et le Directeur, celles de sa structure pour un Chef, aucune pour le SG. */
function lignesVisibles(ctx, a, lignes) {
  if (a.global) return lignes;
  if (a.chef) return lignes.filter((l) => (ctx.perimetre === 'DIVISION' ? l.division_id === ctx.divisionId : l.bureau_id === ctx.bureauId));
  return [];
}

const dateDe = (d) => (d instanceof Date ? d.toLocaleDateString('en-CA', { timeZone: 'Africa/Kinshasa' }) : String(d).slice(0, 10));
const fr = (iso) => String(iso).slice(0, 10).split('-').reverse().join('/');
const semaineRef = (lundi) => { const s = P.semaineIso(lundi); return `DEP/PRES/${s.annee}/S${String(s.numero).padStart(2, '0')}`; };
const normaliserSemaine = (s) => s && ({ ...s, semaine_debut: dateDe(s.semaine_debut), semaine_fin: dateDe(s.semaine_fin) });

async function chargerSemaine(id, trx = db) {
  const s = await trx('presence_semaines').where({ id }).first();
  if (!s) throw notFound('Rapport hebdomadaire introuvable.');
  return normaliserSemaine(s);
}

/** Semaine du lundi donné ; créée à la première liste. */
async function semaineDe(lundi, userId, trx) {
  const existante = await trx('presence_semaines').where({ semaine_debut: lundi }).first();
  if (existante) return normaliserSemaine(existante);
  const s = P.semaineIso(lundi);
  const [cree] = await trx('presence_semaines').insert({
    reference: semaineRef(lundi), semaine_debut: lundi, semaine_fin: P.ajouterJours(lundi, 4), annee: s.annee, numero_semaine: s.numero, created_by: userId,
  }).onConflict('semaine_debut').ignore().returning('*');
  return normaliserSemaine(cree || await trx('presence_semaines').where({ semaine_debut: lundi }).first());
}

/** Complète une liste en préparation : ajoute les agents éligibles absents de la liste, met à jour l’ordre et le regroupement. */
async function synchroniserListe(liste, eligibles, trx) {
  const lignes = await trx('presence_lignes').where({ liste_id: liste.id });
  const parAgent = new Map(lignes.map((l) => [l.agent_id, l]));
  const cible = eligibles.filter((e) => e.categorie === liste.categorie);
  const ajouts = [];
  for (const [ordre, e] of cible.entries()) {
    const instantane = { ordre: ordre + 1, structure_code: e.structure_code, structure_libelle: e.structure_libelle, grade_code: e.grade_code, division_id: e.division_id, bureau_id: e.bureau_id };
    const l = parAgent.get(e.agent_id);
    if (!l) ajouts.push({ liste_id: liste.id, agent_id: e.agent_id, ...instantane });
    else if (Object.entries(instantane).some(([k, v]) => (l[k] ?? null) !== (v ?? null))) await trx('presence_lignes').where({ id: l.id }).update(instantane);
  }
  if (ajouts.length) await trx('presence_lignes').insert(ajouts);
  // Agents qui ne sont plus à la Direction : retirés seulement si rien n’a été saisi pour eux
  const ids = new Set(cible.map((e) => e.agent_id));
  const orphelines = lignes.filter((l) => !ids.has(l.agent_id) && !l.heure_arrivee && !l.motif).map((l) => l.id);
  if (orphelines.length) await trx('presence_lignes').whereIn('id', orphelines).del();
}

/** Listes du jour (Cadres puis Agents), créées en préparation pour le Secrétariat lorsque la date le permet. */
async function listesDuJour(date, ctx, a) {
  const lundi = P.lundiDe(date);
  const feries = await P.feries(date, date);
  const semaine = await db('presence_semaines').where({ semaine_debut: lundi }).first();
  const creer = a.gerer && P.estOuvrable(date) && date <= P.aujourdhui() && !feries[date] && (!semaine || semaine.statut === 'EN_PREPARATION');
  if (creer) {
    await db.transaction(async (trx) => {
      const s = await semaineDe(lundi, ctx.userId, trx);
      const h = await P.horaires(trx);
      const eligibles = await P.agentsEligibles(trx);
      for (const categorie of Object.keys(P.CATEGORIES)) {
        let liste = await trx('presence_listes').where({ date, categorie }).first();
        if (!liste) {
          [liste] = await trx('presence_listes').insert({
            semaine_id: s.id, date, categorie, heure_arrivee_ref: h.arrivee, heure_depart_ref: h.depart, tolerance_minutes: h.tolerance, created_by: ctx.userId,
          }).onConflict(['date', 'categorie']).ignore().returning('*');
          liste = liste || await trx('presence_listes').where({ date, categorie }).first();
        }
        if (liste.statut === 'BROUILLON') await synchroniserListe(liste, eligibles, trx);
      }
    });
  }
  return db('presence_listes').where({ date }).orderByRaw(`CASE categorie WHEN 'CADRES' THEN 0 ELSE 1 END`);
}

/** Détail d’une liste : lignes (valeurs saisies et effectives), bilan, rectificatifs, droits. */
async function detailListe(liste, ctx, a) {
  const [lignes, rectificatifs, semaine] = await Promise.all([
    P.lignesListe(liste.id),
    db('presence_rectificatifs as r').leftJoin('users as u', 'u.id', 'r.cree_par').where('r.liste_id', liste.id).orderBy('r.cree_at')
      .select('r.*', 'u.username as auteur'),
    db('presence_semaines').where({ id: liste.semaine_id }).first(),
  ]);
  const effectives = P.appliquerRectificatifs(lignes, rectificatifs);
  const visibles = lignesVisibles(ctx, a, effectives);
  const idsVisibles = new Set(visibles.map((l) => l.agent_id));
  return {
    ...liste,
    date: dateDe(liste.date),
    categorie_libelle: P.CATEGORIES[liste.categorie],
    semaine: normaliserSemaine(semaine),
    bilan: P.bilan(effectives),
    lignes: visibles,
    rectificatifs: a.global ? rectificatifs : rectificatifs.filter((r) => r.statut === 'VALIDE').map((r) => ({ ...r, lignes: r.lignes.filter((x) => idsVisibles.has(x.agent_id)) })).filter((r) => r.lignes.length),
    actions: {
      saisir: a.gerer && liste.statut === 'BROUILLON',
      rectifier: a.gerer && liste.statut !== 'BROUILLON' && semaine.statut !== 'EN_PREPARATION',
      decider: a.directeur,
    },
  };
}

async function chargerListe(id) {
  const l = await db('presence_listes').where({ id }).first();
  if (!l) throw notFound('Liste de présence introuvable.');
  return l;
}

/** Contrôle de complétude d’une semaine : chaque jour ouvrable non férié a ses deux listes entièrement renseignées. */
async function controleSemaine(s) {
  const jours = P.joursOuvrables(s.semaine_debut);
  const feries = await P.feries(jours[0], jours[4]);
  const listes = await db('presence_listes').where({ semaine_id: s.id });
  const manquants = [];
  for (const [i, date] of jours.entries()) {
    if (feries[date]) continue;
    for (const categorie of Object.keys(P.CATEGORIES)) {
      const l = listes.find((x) => dateDe(x.date) === date && x.categorie === categorie);
      if (!l) { manquants.push({ date, categorie, message: `${P.JOURS[i]} ${fr(date)} : liste des ${P.CATEGORIES[categorie]} non établie.` }); continue; }
      const b = P.bilan(await db('presence_lignes').where({ liste_id: l.id }));
      const reste = b.non_renseignes + b.incomplets;
      if (reste) manquants.push({ date, categorie, liste_id: l.id, message: `${P.JOURS[i]} ${fr(date)} : ${reste} ligne(s) à compléter sur la liste des ${P.CATEGORIES[categorie]}.` });
    }
  }
  return { jours, feries, listes, manquants };
}

async function detailSemaine(s, ctx, a) {
  const jours = P.joursOuvrables(s.semaine_debut);
  const [feries, listes, rectificatifs, historique] = await Promise.all([
    P.feries(jours[0], jours[4]),
    db('presence_listes').where({ semaine_id: s.id }),
    db('presence_rectificatifs as r').join('presence_listes as l', 'l.id', 'r.liste_id').leftJoin('users as u', 'u.id', 'r.cree_par')
      .where('l.semaine_id', s.id).orderBy('r.cree_at').select('r.id', 'r.reference', 'r.statut', 'r.motif', 'r.cree_at', 'r.decide_at', 'r.commentaire_decision', 'r.liste_id', 'l.date', 'l.categorie', 'u.username as auteur', db.raw('jsonb_array_length(r.lignes)::int as nb_lignes')),
    a.sg ? [] : getHistory('PRESENCE_SEMAINE', s.id),
  ]);
  const rectParListe = new Map();
  if (listes.length) {
    const tous = await db('presence_rectificatifs').whereIn('liste_id', listes.map((l) => l.id));
    for (const r of tous) rectParListe.set(r.liste_id, [...(rectParListe.get(r.liste_id) || []), r]);
  }
  const parJour = [];
  for (const [i, date] of jours.entries()) {
    const jour = { date, jour: P.JOURS[i], ferie: feries[date] || null, listes: [] };
    for (const categorie of Object.keys(P.CATEGORIES)) {
      const l = listes.find((x) => dateDe(x.date) === date && x.categorie === categorie);
      if (!l) { jour.listes.push({ categorie, categorie_libelle: P.CATEGORIES[categorie], id: null }); continue; }
      const effectives = P.appliquerRectificatifs(await P.lignesListe(l.id), rectParListe.get(l.id) || []);
      jour.listes.push({ id: l.id, categorie, categorie_libelle: P.CATEGORIES[categorie], statut: l.statut, bilan: P.bilan(a.sg ? effectives : lignesVisibles(ctx, a, effectives)) });
    }
    parJour.push(jour);
  }
  const controle = s.statut === 'EN_PREPARATION' && a.gerer ? (await controleSemaine(s)).manquants : [];
  const depuisRejet = s.statut === 'REJETE' ? rectificatifs.filter((r) => new Date(r.cree_at) > new Date(s.rejete_at)).length : 0;
  const enAttente = rectificatifs.filter((r) => r.statut === 'PROPOSE').length;
  return {
    ...s,
    statut_libelle: STATUTS_SEMAINE[s.statut],
    jours: parJour,
    rectificatifs: a.global ? rectificatifs : a.chef ? rectificatifs.filter((r) => r.statut === 'VALIDE') : [],
    historique,
    controle,
    actions: {
      transmettre: a.gerer && s.statut === 'EN_PREPARATION' && !controle.length,
      retransmettre: a.gerer && s.statut === 'REJETE' && depuisRejet > 0,
      verrouiller: a.directeur && s.statut === 'TRANSMIS',
      rejeter: a.directeur && s.statut === 'TRANSMIS',
      exporter: a.global && ctx.can('exports.generer'),
      voir_rectificatifs: a.global,
      rectificatifs_en_attente: enAttente,
    },
  };
}

// ─── Paramètres : horaires de référence et jours fériés ─────────────────────────────────────────
router.get('/parametres', async (req, res) => {
  exigerConsultation(req.ctx);
  const annee = new Date().getFullYear();
  const [h, feries] = await Promise.all([P.horaires(), db('jours_feries').where('date', '>=', `${annee - 1}-01-01`).orderBy('date')]);
  res.json({ horaires: h, feries: feries.map((f) => ({ ...f, date: dateDe(f.date) })), motifs: P.MOTIFS, categories: P.CATEGORIES, jours: P.JOURS, aujourdhui: P.aujourdhui(), droits: acces(req.ctx) });
});

router.put('/parametres', validate({ body: z.object({ arrivee: heure, depart: heure, tolerance: z.coerce.number().int().min(0).max(120) }) }), async (req, res) => {
  const a = acces(req.ctx);
  if (!a.directeur && !a.gerer) throw forbidden();
  const b = req.valid.body;
  if (b.depart <= b.arrivee) throw badRequest('L’heure de départ doit suivre l’heure d’arrivée.');
  const avant = await P.horaires();
  const valeurs = { presence_heure_arrivee: b.arrivee, presence_heure_depart: b.depart, presence_tolerance_minutes: String(b.tolerance) };
  await db.transaction(async (trx) => {
    for (const [cle, valeur] of Object.entries(valeurs)) await trx('parametres').where({ cle }).update({ valeur, updated_at: trx.fn.now(), updated_by: req.ctx.userId });
  });
  await audit(req, { action: 'MODIFICATION', module: 'presences', entite: 'parametres', avant, apres: b, message: 'Horaires de référence des présences' });
  res.json({ horaires: await P.horaires() });
});

router.post('/feries', validate({ body: z.object({ date: dateIso, libelle: z.string().trim().min(2).max(200) }) }), async (req, res) => {
  const a = acces(req.ctx);
  if (!a.directeur && !a.gerer) throw forbidden();
  const { date, libelle } = req.valid.body;
  if (!P.estOuvrable(date)) throw badRequest('Un jour férié ne se déclare que pour un jour ouvrable (lundi à vendredi).');
  const deja = await db('presence_listes').where({ date }).whereNot('statut', 'BROUILLON').first();
  if (deja) throw conflict('Des listes de ce jour sont déjà transmises : le jour ne peut plus être déclaré férié.');
  const [f] = await db('jours_feries').insert({ date, libelle, created_by: req.ctx.userId }).onConflict('date').merge(['libelle']).returning('*');
  await audit(req, { action: 'CREATION', module: 'presences', entite: 'jour_ferie', entiteId: f.id, apres: f });
  res.status(201).json({ ...f, date: dateDe(f.date) });
});

router.delete('/feries/:id', validate({ params: idParam }), async (req, res) => {
  const a = acces(req.ctx);
  if (!a.directeur && !a.gerer) throw forbidden();
  const f = await db('jours_feries').where({ id: req.valid.params.id }).first();
  if (!f) throw notFound('Jour férié introuvable.');
  await db('jours_feries').where({ id: f.id }).del();
  await audit(req, { action: 'SUPPRESSION', module: 'presences', entite: 'jour_ferie', entiteId: f.id, avant: f });
  res.json({ message: 'Jour férié retiré.' });
});

// ─── Rapports hebdomadaires ─────────────────────────────────────────────────────────────────────
router.get(['/', '/semaines'], validate({ query: z.object({ annee: z.coerce.number().int().optional(), statut: z.enum(Object.keys(STATUTS_SEMAINE)).optional() }) }), async (req, res) => {
  const a = exigerConsultation(req.ctx);
  const { annee, statut } = req.valid.query;
  const q = db('presence_semaines as s').leftJoin('users as u', 'u.id', 's.transmis_par')
    .select('s.*', 'u.username as transmis_par_nom',
      db.raw(`(SELECT count(*) FROM presence_rectificatifs r JOIN presence_listes l ON l.id = r.liste_id WHERE l.semaine_id = s.id AND r.statut = 'PROPOSE')::int as rectificatifs_en_attente`))
    .orderBy('s.semaine_debut', 'desc').limit(120);
  if (annee) q.where('s.annee', annee);
  if (statut) q.where('s.statut', statut);
  // Le Directeur, les Chefs et le SG voient les rapports à partir de leur transmission
  if (!a.gerer) q.whereNot('s.statut', 'EN_PREPARATION');
  const rows = (await q).map(normaliserSemaine);
  // Bilan de chaque semaine (agent-jours), d’après les valeurs effectives visibles
  const ids = rows.map((s) => s.id);
  const listes = ids.length ? await db('presence_listes').whereIn('semaine_id', ids) : [];
  const lignes = listes.length ? await db('presence_lignes').whereIn('liste_id', listes.map((l) => l.id)) : [];
  const rects = listes.length ? await db('presence_rectificatifs').whereIn('liste_id', listes.map((l) => l.id)).where({ statut: 'VALIDE' }) : [];
  const data = rows.map((s) => {
    const ls = listes.filter((l) => l.semaine_id === s.id);
    let toutes = [];
    for (const l of ls) toutes = toutes.concat(P.appliquerRectificatifs(lignes.filter((x) => x.liste_id === l.id), rects.filter((r) => r.liste_id === l.id)));
    return { ...s, statut_libelle: STATUTS_SEMAINE[s.statut], nb_listes: ls.length, bilan: P.bilan(a.sg ? toutes : lignesVisibles(req.ctx, a, toutes)) };
  });
  res.json({ data, droits: a });
});

router.get('/semaines/:id', validate({ params: idParam }), async (req, res) => {
  const a = exigerConsultation(req.ctx);
  const s = await chargerSemaine(req.valid.params.id);
  if (!a.gerer && s.statut === 'EN_PREPARATION') throw forbidden('Ce rapport n’a pas encore été transmis au Directeur.');
  res.json(await detailSemaine(s, req.ctx, a));
});

router.post('/semaines/:id/transmettre', validate({ params: idParam, body: z.object({ commentaire: z.string().trim().max(2000).optional().nullable() }) }), async (req, res) => {
  exigerGestion(req.ctx);
  const s = await chargerSemaine(req.valid.params.id);
  if (s.statut !== 'EN_PREPARATION') throw badRequest('Seul un rapport en préparation peut être transmis.');
  const { manquants } = await controleSemaine(s);
  if (manquants.length) throw badRequest('Le rapport ne peut pas être transmis : des listes sont incomplètes.', { manquants });
  await db.transaction(async (trx) => {
    await trx('presence_listes').where({ semaine_id: s.id, statut: 'BROUILLON' }).update({ statut: 'TRANSMISE', updated_by: req.ctx.userId, updated_at: trx.fn.now() });
    await trx('presence_semaines').where({ id: s.id }).update({ statut: 'TRANSMIS', transmis_par: req.ctx.userId, transmis_at: trx.fn.now(), updated_at: trx.fn.now() });
    await addHistory('PRESENCE_SEMAINE', s.id, req.ctx.userId, { action: 'TRANSMISSION', ancien: 'EN_PREPARATION', nouveau: 'TRANSMIS', commentaire: req.valid.body.commentaire || 'Transmis au Directeur — listes de la semaine verrouillées en écriture' }, trx);
  });
  await audit(req, { action: 'TRANSMISSION', module: 'presences', entite: 'presence_semaine', entiteId: s.id, avant: { statut: s.statut }, apres: { statut: 'TRANSMIS' } });
  await notify(await directeursActifs(), { type: 'PRESENCE', titre: `Rapport de présence transmis : ${s.reference}`, message: `Semaine du ${fr(s.semaine_debut)} au ${fr(s.semaine_fin)}`, lien: `/presences/semaines/${s.id}`, expediteur: req.ctx.userId });
  res.json(await detailSemaine(await chargerSemaine(s.id), req.ctx, acces(req.ctx)));
});

router.post('/semaines/:id/verrouiller', requirePerm('presences.verrouiller'), validate({ params: idParam, body: z.object({ commentaire: z.string().trim().max(2000).optional().nullable() }) }), async (req, res) => {
  const a = acces(req.ctx);
  if (!a.directeur) throw forbidden();
  const s = await chargerSemaine(req.valid.params.id);
  if (s.statut !== 'TRANSMIS') throw badRequest('Seul un rapport transmis peut être verrouillé.');
  await db.transaction(async (trx) => {
    await trx('presence_listes').where({ semaine_id: s.id, statut: 'TRANSMISE' }).update({ statut: 'VERROUILLEE', updated_by: req.ctx.userId, updated_at: trx.fn.now() });
    await trx('presence_semaines').where({ id: s.id }).update({ statut: 'VERROUILLE', verrouille_par: req.ctx.userId, verrouille_at: trx.fn.now(), commentaire_verrouillage: req.valid.body.commentaire || null, updated_at: trx.fn.now() });
    await addHistory('PRESENCE_SEMAINE', s.id, req.ctx.userId, { action: 'VERROUILLAGE', ancien: 'TRANSMIS', nouveau: 'VERROUILLE', commentaire: req.valid.body.commentaire || 'Verrouillé définitivement par le Directeur' }, trx);
  });
  await audit(req, { action: 'VALIDATION', module: 'presences', entite: 'presence_semaine', entiteId: s.id, avant: { statut: 'TRANSMIS' }, apres: { statut: 'VERROUILLE' } });
  await notify([s.transmis_par], { type: 'PRESENCE', titre: `Rapport de présence verrouillé : ${s.reference}`, message: req.valid.body.commentaire || null, lien: `/presences/semaines/${s.id}`, expediteur: req.ctx.userId });
  res.json(await detailSemaine(await chargerSemaine(s.id), req.ctx, a));
});

router.post('/semaines/:id/rejeter', requirePerm('presences.verrouiller'), validate({ params: idParam, body: z.object({ motif: z.string().trim().min(5, 'Indiquez le motif du rejet (5 caractères au moins).').max(2000) }) }), async (req, res) => {
  const a = acces(req.ctx);
  if (!a.directeur) throw forbidden();
  const s = await chargerSemaine(req.valid.params.id);
  if (s.statut !== 'TRANSMIS') throw badRequest('Seul un rapport transmis peut être rejeté.');
  await db.transaction(async (trx) => {
    await trx('presence_semaines').where({ id: s.id }).update({ statut: 'REJETE', rejete_par: req.ctx.userId, rejete_at: trx.fn.now(), motif_rejet: req.valid.body.motif, updated_at: trx.fn.now() });
    await addHistory('PRESENCE_SEMAINE', s.id, req.ctx.userId, { action: 'REJET', ancien: 'TRANSMIS', nouveau: 'REJETE', commentaire: req.valid.body.motif }, trx);
  });
  await audit(req, { action: 'REJET', module: 'presences', entite: 'presence_semaine', entiteId: s.id, avant: { statut: 'TRANSMIS' }, apres: { statut: 'REJETE' }, message: req.valid.body.motif });
  await notify([s.transmis_par], { type: 'PRESENCE', titre: `Rapport de présence rejeté : ${s.reference}`, message: req.valid.body.motif, lien: `/presences/semaines/${s.id}`, expediteur: req.ctx.userId });
  res.json(await detailSemaine(await chargerSemaine(s.id), req.ctx, a));
});

router.post('/semaines/:id/retransmettre', validate({ params: idParam, body: z.object({ commentaire: z.string().trim().max(2000).optional().nullable() }) }), async (req, res) => {
  const a = exigerGestion(req.ctx);
  const s = await chargerSemaine(req.valid.params.id);
  if (s.statut !== 'REJETE') throw badRequest('Seul un rapport rejeté peut être retransmis.');
  const n = await db('presence_rectificatifs as r').join('presence_listes as l', 'l.id', 'r.liste_id').where('l.semaine_id', s.id).where('r.cree_at', '>', s.rejete_at).count('* as n').first();
  if (!Number(n.n)) throw badRequest('Établissez d’abord les rectificatifs demandés par le Directeur, puis retransmettez le rapport.');
  await db.transaction(async (trx) => {
    await trx('presence_semaines').where({ id: s.id }).update({ statut: 'TRANSMIS', transmis_par: req.ctx.userId, transmis_at: trx.fn.now(), updated_at: trx.fn.now() });
    await addHistory('PRESENCE_SEMAINE', s.id, req.ctx.userId, { action: 'RETRANSMISSION', ancien: 'REJETE', nouveau: 'TRANSMIS', commentaire: req.valid.body.commentaire || `Retransmis après ${n.n} rectificatif(s)` }, trx);
  });
  await audit(req, { action: 'TRANSMISSION', module: 'presences', entite: 'presence_semaine', entiteId: s.id, avant: { statut: 'REJETE' }, apres: { statut: 'TRANSMIS' }, message: 'Retransmission' });
  await notify(await directeursActifs(), { type: 'PRESENCE', titre: `Rapport de présence retransmis : ${s.reference}`, message: req.valid.body.commentaire || null, lien: `/presences/semaines/${s.id}`, expediteur: req.ctx.userId });
  res.json(await detailSemaine(await chargerSemaine(s.id), req.ctx, a));
});

router.get('/semaines/:id/export/:format', requirePerm('exports.generer'), validate({ params: z.object({ id: z.coerce.number().int().positive(), format: z.enum(['pdf', 'xlsx']) }) }), async (req, res) => {
  const a = exigerConsultation(req.ctx);
  if (!a.global) throw forbidden('L’export nominatif des présences est réservé au Secrétariat de Direction et au Directeur.');
  const s = await chargerSemaine(req.valid.params.id);
  const donnees = await exportsPresences.donneesSemaine(s);
  await audit(req, { action: 'EXPORT', module: 'presences', entite: 'presence_semaine', entiteId: s.id, message: req.valid.params.format.toUpperCase() });
  if (req.valid.params.format === 'xlsx') return exportsPresences.excel(res, donnees);
  return exportsPresences.pdf(res, donnees);
});

// ─── Listes journalières ────────────────────────────────────────────────────────────────────────
router.get('/jour/:date', validate({ params: z.object({ date: dateIso }) }), async (req, res) => {
  const a = exigerConsultation(req.ctx);
  if (a.sg) throw forbidden('Le Secrétaire Général consulte les synthèses des rapports transmis.');
  const { date } = req.valid.params;
  const lundi = P.lundiDe(date);
  const [listes, feries, semaine] = await Promise.all([listesDuJour(date, req.ctx, a), P.feries(date, date), db('presence_semaines').where({ semaine_debut: lundi }).first()]);
  const details = [];
  for (const l of listes) details.push(await detailListe(l, req.ctx, a));
  const raison = !P.estOuvrable(date) ? 'Samedi et dimanche ne sont pas des jours ouvrables.'
    : feries[date] ? `Jour férié : ${feries[date]}.`
      : date > P.aujourdhui() ? 'Les présences ne se saisissent pas à l’avance.'
        : !listes.length && !a.gerer ? 'Les listes de ce jour n’ont pas encore été établies par le Secrétariat de Direction.' : null;
  res.json({
    date, jour: P.estOuvrable(date) ? P.JOURS[(new Date(`${date}T12:00:00Z`).getUTCDay() || 7) - 1] : null,
    ferie: feries[date] || null, raison, semaine: normaliserSemaine(semaine) || null, listes: details,
    horaires: await P.horaires(), motifs: P.MOTIFS, droits: a,
  });
});

const ligneSaisie = z.object({
  agent_id: z.coerce.number().int().positive(),
  heure_arrivee: heure.optional().nullable().or(z.literal('')),
  heure_depart: heure.optional().nullable().or(z.literal('')),
  motif: z.enum(Object.keys(P.MOTIFS)).optional().nullable().or(z.literal('')),
  piece_id: z.coerce.number().int().positive().optional().nullable(),
  observation: z.string().trim().max(500).optional().nullable(),
});

/** Normalise et contrôle une ligne saisie ; calcule le retard d’après les horaires de la liste. */
function preparerLigne(x, liste, piecesAutorisees) {
  const motif = x.motif || null;
  const arrivee = motif ? null : (x.heure_arrivee || null);
  const depart = motif ? null : (x.heure_depart || null);
  if (depart && !arrivee) throw badRequest('Heure de départ sans heure d’arrivée.', { agent_id: x.agent_id });
  if (arrivee && depart && depart < arrivee) throw badRequest('L’heure de départ précède l’heure d’arrivée.', { agent_id: x.agent_id });
  const pieceId = motif ? (x.piece_id || null) : null;
  if (pieceId && !piecesAutorisees.has(pieceId)) throw badRequest('Pièce justificative inconnue pour cette liste.', { agent_id: x.agent_id });
  return {
    heure_arrivee: arrivee, heure_depart: depart, motif, piece_id: pieceId, observation: x.observation || null,
    retard_minutes: P.retard(arrivee, liste.heure_arrivee_ref, liste.tolerance_minutes),
  };
}

const piecesDeListe = async (listeId) => new Set(await db('attachments').where({ entity_type: 'PRESENCE_LISTE', entity_id: listeId }).pluck('id'));

router.put('/listes/:id', validate({ params: idParam, body: z.object({ lignes: z.array(ligneSaisie).min(1).max(500) }) }), async (req, res) => {
  const a = exigerGestion(req.ctx);
  const liste = await chargerListe(req.valid.params.id);
  if (liste.statut !== 'BROUILLON') throw badRequest('Liste transmise : toute correction passe par un rectificatif validé par le Directeur.');
  const existantes = new Map((await db('presence_lignes').where({ liste_id: liste.id })).map((l) => [l.agent_id, l]));
  const pieces = await piecesDeListe(liste.id);
  const maj = req.valid.body.lignes.map((x) => {
    const l = existantes.get(x.agent_id);
    if (!l) throw badRequest('Agent absent de cette liste.', { agent_id: x.agent_id });
    return [l.id, preparerLigne(x, liste, pieces)];
  });
  await db.transaction(async (trx) => {
    for (const [id, v] of maj) await trx('presence_lignes').where({ id }).update(v);
    await trx('presence_listes').where({ id: liste.id }).update({ updated_by: req.ctx.userId, updated_at: trx.fn.now() });
  });
  await audit(req, { action: 'MODIFICATION', module: 'presences', entite: 'presence_liste', entiteId: liste.id, message: `Saisie de ${maj.length} ligne(s) — ${P.CATEGORIES[liste.categorie]} du ${fr(dateDe(liste.date))}` });
  res.json(await detailListe(await chargerListe(liste.id), req.ctx, a));
});

router.get('/listes/:id', validate({ params: idParam }), async (req, res) => {
  const a = exigerConsultation(req.ctx);
  if (a.sg) throw forbidden('Le Secrétaire Général consulte les synthèses des rapports transmis.');
  res.json(await detailListe(await chargerListe(req.valid.params.id), req.ctx, a));
});

// ─── Rectificatifs ──────────────────────────────────────────────────────────────────────────────
router.post('/listes/:id/rectificatifs', validate({ params: idParam, body: z.object({ motif: z.string().trim().min(5, 'Indiquez le motif du rectificatif (5 caractères au moins).').max(2000), lignes: z.array(ligneSaisie).min(1).max(500) }) }), async (req, res) => {
  const a = exigerGestion(req.ctx);
  const liste = await chargerListe(req.valid.params.id);
  if (liste.statut === 'BROUILLON') throw badRequest('Liste en préparation : corrigez-la directement.');
  const s = await chargerSemaine(liste.semaine_id);
  const rects = await db('presence_rectificatifs').where({ liste_id: liste.id });
  if (rects.some((r) => r.statut === 'PROPOSE')) throw conflict('Un rectificatif de cette liste attend déjà la décision du Directeur.');
  const effectives = new Map(P.appliquerRectificatifs(await db('presence_lignes').where({ liste_id: liste.id }), rects).map((l) => [l.agent_id, l]));
  const pieces = await piecesDeListe(liste.id);
  const lignes = [];
  for (const x of req.valid.body.lignes) {
    const l = effectives.get(x.agent_id);
    if (!l) throw badRequest('Agent absent de cette liste.', { agent_id: x.agent_id });
    const v = preparerLigne(x, liste, pieces);
    const avant = { heure_arrivee: l.heure_arrivee, heure_depart: l.heure_depart, motif: l.motif, piece_id: l.piece_id, observation: l.observation, retard_minutes: l.retard_minutes };
    if (['heure_arrivee', 'heure_depart', 'motif', 'piece_id', 'observation'].every((k) => (avant[k] ?? null) === (v[k] ?? null))) continue;
    if (!v.motif && (!v.heure_arrivee || !v.heure_depart)) throw badRequest('Une ligne rectifiée porte un motif d’absence ou les deux heures.', { agent_id: x.agent_id });
    lignes.push({ agent_id: x.agent_id, ...v, avant });
  }
  if (!lignes.length) throw badRequest('Le rectificatif ne change aucune valeur.');
  const reference = `${s.reference}/${dateDe(liste.date).slice(5).replace('-', '')}-${liste.categorie[0]}-R${rects.length + 1}`;
  const r = await db.transaction(async (trx) => {
    const [cree] = await trx('presence_rectificatifs').insert({ reference, liste_id: liste.id, motif: req.valid.body.motif, lignes: JSON.stringify(lignes), cree_par: req.ctx.userId }).returning('*');
    await addHistory('PRESENCE_SEMAINE', s.id, req.ctx.userId, { action: 'RECTIFICATIF', commentaire: `${reference} (${P.CATEGORIES[liste.categorie]} du ${fr(dateDe(liste.date))}) : ${req.valid.body.motif}`, details: { rectificatif_id: cree.id, lignes: lignes.length } }, trx);
    return cree;
  });
  await audit(req, { action: 'CREATION', module: 'presences', entite: 'presence_rectificatif', entiteId: r.id, apres: { reference, liste_id: liste.id, lignes } });
  await notify(await directeursActifs(), { type: 'PRESENCE', titre: `Rectificatif de présence à valider : ${reference}`, message: req.valid.body.motif, lien: `/presences/semaines/${s.id}`, expediteur: req.ctx.userId });
  res.status(201).json(await detailListe(liste, req.ctx, a));
});

router.get('/rectificatifs', validate({ query: z.object({ statut: z.enum(['PROPOSE', 'VALIDE', 'REFUSE']).optional() }) }), async (req, res) => {
  const a = exigerConsultation(req.ctx);
  if (!a.global) throw forbidden();
  const q = db('presence_rectificatifs as r').join('presence_listes as l', 'l.id', 'r.liste_id').join('presence_semaines as s', 's.id', 'l.semaine_id').leftJoin('users as u', 'u.id', 'r.cree_par')
    .select('r.id', 'r.reference', 'r.statut', 'r.motif', 'r.cree_at', 'r.decide_at', 'l.date', 'l.categorie', 's.id as semaine_id', 's.reference as semaine_reference', 'u.username as auteur', db.raw('jsonb_array_length(r.lignes)::int as nb_lignes'))
    .orderBy('r.cree_at', 'desc').limit(200);
  if (req.valid.query.statut) q.where('r.statut', req.valid.query.statut);
  res.json({ data: (await q).map((r) => ({ ...r, date: dateDe(r.date) })) });
});

router.get('/rectificatifs/:id', validate({ params: idParam }), async (req, res) => {
  const a = exigerConsultation(req.ctx);
  if (!a.global) throw forbidden();
  const r = await db('presence_rectificatifs').where({ id: req.valid.params.id }).first();
  if (!r) throw notFound('Rectificatif introuvable.');
  const agents = await db('agents').whereIn('id', r.lignes.map((x) => x.agent_id)).select('id', db.raw(`concat_ws(' ', nom, postnom, prenom) as nom_complet`));
  const noms = new Map(agents.map((x) => [x.id, x.nom_complet]));
  const liste = await chargerListe(r.liste_id);
  res.json({ ...r, liste: { ...liste, date: dateDe(liste.date) }, lignes: r.lignes.map((x) => ({ ...x, nom_complet: noms.get(x.agent_id) })), actions: { decider: a.directeur && r.statut === 'PROPOSE' } });
});

router.post('/rectificatifs/:id/decision', requirePerm('presences.verrouiller'), validate({ params: idParam, body: z.object({ decision: z.enum(['VALIDE', 'REFUSE']), commentaire: z.string().trim().max(2000).optional().nullable() }) }), async (req, res) => {
  const a = acces(req.ctx);
  if (!a.directeur) throw forbidden();
  const r = await db('presence_rectificatifs').where({ id: req.valid.params.id }).first();
  if (!r) throw notFound('Rectificatif introuvable.');
  if (r.statut !== 'PROPOSE') throw badRequest('Ce rectificatif a déjà fait l’objet d’une décision.');
  const { decision, commentaire } = req.valid.body;
  if (decision === 'REFUSE' && !commentaire) throw badRequest('Indiquez le motif du refus.');
  const liste = await chargerListe(r.liste_id);
  await db.transaction(async (trx) => {
    await trx('presence_rectificatifs').where({ id: r.id }).update({ statut: decision, decide_par: req.ctx.userId, decide_at: trx.fn.now(), commentaire_decision: commentaire || null });
    await addHistory('PRESENCE_SEMAINE', liste.semaine_id, req.ctx.userId, { action: decision === 'VALIDE' ? 'RECTIFICATIF_VALIDE' : 'RECTIFICATIF_REFUSE', commentaire: `${r.reference}${commentaire ? ` : ${commentaire}` : ''}` }, trx);
  });
  await audit(req, { action: decision === 'VALIDE' ? 'VALIDATION' : 'REJET', module: 'presences', entite: 'presence_rectificatif', entiteId: r.id, avant: { statut: 'PROPOSE' }, apres: { statut: decision }, message: commentaire || null });
  await notify([r.cree_par], { type: 'PRESENCE', titre: `Rectificatif ${decision === 'VALIDE' ? 'validé' : 'refusé'} : ${r.reference}`, message: commentaire || null, lien: `/presences/semaines/${liste.semaine_id}`, expediteur: req.ctx.userId });
  res.json({ ...(await db('presence_rectificatifs').where({ id: r.id }).first()), actions: { decider: false } });
});

// ─── Synthèse mensuelle ─────────────────────────────────────────────────────────────────────────
const moisParam = z.object({ mois: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Mois attendu au format AAAA-MM.').optional() });
/** Périmètre de la synthèse : toute la Direction (Secrétariat, Directeur), la structure d’un Chef, agrégats seuls pour le SG. */
function perimetreSynthese(ctx, a) {
  if (a.global) return { nominatif: true, portee: 'Direction' };
  if (a.sg) return { nominatif: false, portee: 'Direction' };
  return ctx.perimetre === 'DIVISION' ? { divisionId: ctx.divisionId, nominatif: true, portee: 'Division' } : { bureauId: ctx.bureauId, nominatif: true, portee: 'Bureau' };
}
async function synthese(req) {
  const a = exigerConsultation(req.ctx);
  const mois = req.valid.query.mois || P.aujourdhui().slice(0, 7);
  const p = perimetreSynthese(req.ctx, a);
  return { ...(await P.syntheseMensuelle({ mois, ...p })), portee: p.portee, motifs: P.MOTIFS };
}

router.get('/synthese', validate({ query: moisParam }), async (req, res) => {
  res.json(await synthese(req));
});

router.get('/synthese/export/:format', requirePerm('exports.generer'), validate({ params: z.object({ format: z.enum(['pdf', 'xlsx']) }), query: moisParam }), async (req, res) => {
  const d = await synthese(req);
  await audit(req, { action: 'EXPORT', module: 'presences', entite: 'presence_synthese', message: `Synthèse ${d.mois} (${req.valid.params.format.toUpperCase()})` });
  if (req.valid.params.format === 'xlsx') return exportsPresences.syntheseExcel(res, d);
  return exportsPresences.synthesePdf(res, d);
});

// ─── Présences personnelles ─────────────────────────────────────────────────────────────────────
/** Présences de l’agent connecté sur les rapports transmis (valeurs effectives, rectificatifs compris). */
router.get('/moi', validate({ query: z.object({ mois: z.string().regex(/^\d{4}-\d{2}$/).optional() }) }), async (req, res) => {
  if (!req.ctx.agentId) return res.json({ data: [], bilan: P.bilan([]) });
  const q = db('presence_lignes as l').join('presence_listes as li', 'li.id', 'l.liste_id').join('presence_semaines as s', 's.id', 'li.semaine_id')
    .where('l.agent_id', req.ctx.agentId).whereNot('li.statut', 'BROUILLON')
    .select('l.*', 'li.date', 'li.categorie', 'li.heure_arrivee_ref', 's.reference', 's.statut as statut_semaine').orderBy('li.date', 'desc').limit(130);
  if (req.valid.query.mois) q.whereRaw(`to_char(li.date, 'YYYY-MM') = ?`, [req.valid.query.mois]);
  const lignes = await q;
  const rects = lignes.length ? await db('presence_rectificatifs').whereIn('liste_id', lignes.map((l) => l.liste_id)).where({ statut: 'VALIDE' }) : [];
  const data = lignes.map((l) => ({ ...P.appliquerRectificatifs([l], rects.filter((r) => r.liste_id === l.liste_id))[0], date: dateDe(l.date) }));
  return res.json({ data: data.map((l) => ({ ...l, etat: P.etat(l) })), bilan: P.bilan(data), motifs: P.MOTIFS });
});

module.exports = router;
module.exports.acces = acces;

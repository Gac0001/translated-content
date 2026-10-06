'use strict';
/**
 * Réunions (cahier des charges, §§ 16 et 25) : ordre du jour, participants, convocation, présence,
 * compte rendu et décisions.
 *   Brouillon → Convoquée → Tenue → Compte rendu à valider → Clôturée (compte rendu verrouillé)
 *   Annulée (motif) à tout moment avant la tenue ; report par changement de date notifié.
 * Le Directeur, les Chefs de Division et de Bureau organisent les réunions de leur structure ;
 * le Bureau Secrétariat de Direction prépare celles que préside le Directeur et rédige leur
 * compte rendu. Le président valide le compte rendu : ses décisions entrent alors au registre.
 */
const express = require('express');
const { z } = require('zod');
const db = require('../../db/knex');
const validate = require('../../middleware/validate');
const { requirePerm } = require('../../middleware/auth');
const { audit } = require('../../services/audit');
const { notify } = require('../../services/notifications');
const { addHistory, getHistory } = require('../../services/history');
const { nextReference } = require('../../services/sequence');
const { loadAllNodes } = require('../../services/hierarchy');
const { directeursActifs } = require('../../services/alertes');
const pdf = require('../../services/pdf');
const { badRequest, forbidden, notFound } = require('../../utils/errors');

const router = express.Router();
const idParam = z.object({ id: z.coerce.number().int().positive() });
const STATUTS = {
  BROUILLON: 'Brouillon', CONVOQUEE: 'Convoquée', TENUE: 'Tenue', CR_A_VALIDER: 'Compte rendu à valider', CLOTUREE: 'Clôturée', ANNULEE: 'Annulée',
};
const PRESENCES = { PRESENT: 'Présent', ABSENT: 'Absent', EXCUSE: 'Excusé', REPRESENTE: 'Représenté' };
const nomComplet = (prefix) => db.raw(`nullif(concat_ws(' ', ${prefix}.prenom, ${prefix}.nom), '')`);

function baseQuery() {
  return db('reunions as r')
    .join('users as up', 'up.id', 'r.president_user_id').leftJoin('agents as ap', 'ap.id', 'up.agent_id')
    .join('users as uo', 'uo.id', 'r.organisateur_user_id').leftJoin('agents as ao', 'ao.id', 'uo.agent_id')
    .leftJoin('users as ur', 'ur.id', 'r.redacteur_user_id').leftJoin('agents as ar', 'ar.id', 'ur.agent_id')
    .select('r.*', db.raw(`coalesce(${nomComplet('ap').toString()}, up.username) as president_nom`),
      db.raw(`coalesce(${nomComplet('ao').toString()}, uo.username) as organisateur_nom`),
      db.raw(`coalesce(${nomComplet('ar').toString()}, ur.username) as redacteur_nom`));
}

/** Réunions visibles : celles auxquelles on prend part, et celles de son périmètre. */
function scopeReunions(qb, ctx) {
  return qb.where((w) => {
    w.whereIn('r.statut', ['BROUILLON']).where((x) => x.where('r.organisateur_user_id', ctx.userId).orWhere('r.president_user_id', ctx.userId).orWhere('r.redacteur_user_id', ctx.userId));
    w.orWhere((o) => {
      o.whereNot('r.statut', 'BROUILLON').where((x) => {
        x.where('r.organisateur_user_id', ctx.userId).orWhere('r.president_user_id', ctx.userId).orWhere('r.redacteur_user_id', ctx.userId)
          .orWhereExists(db('reunion_participants as p').whereRaw('p.reunion_id = r.id').where('p.user_id', ctx.userId));
        if (ctx.perimetre === 'DIRECTION') x.orWhereRaw('true');
        if (ctx.perimetre === 'DIVISION') x.orWhere('r.division_id', ctx.divisionId);
        if (ctx.perimetre === 'BUREAU') x.orWhere('r.bureau_id', ctx.bureauId);
        if (ctx.can('reunions.preparer_direction')) x.orWhere('r.niveau', 'DIRECTION');
      });
    });
  });
}

async function charger(ctx, id) {
  const exists = await db('reunions').where({ id }).first();
  if (!exists) throw notFound('Réunion introuvable.');
  const r = await scopeReunions(baseQuery().where('r.id', id), ctx).first();
  if (!r) throw forbidden('Cette réunion est hors de votre périmètre.', 'HORS_PERIMETRE');
  return r;
}

/** Rôles de l’utilisateur dans la réunion. */
function roles(ctx, r) {
  const organisateur = r.organisateur_user_id === ctx.userId;
  const president = r.president_user_id === ctx.userId;
  const redacteur = r.redacteur_user_id === ctx.userId;
  // Le Secrétariat prépare les réunions que préside le Directeur.
  const secretariat = r.niveau === 'DIRECTION' && ctx.can('reunions.preparer_direction');
  return { organisateur, president, redacteur, preparer: organisateur || president || secretariat, rediger: redacteur || organisateur || president || secretariat };
}

const participantsDe = (id) => db('reunion_participants as p').leftJoin('users as u', 'u.id', 'p.user_id').leftJoin('agents as a', 'a.id', 'u.agent_id')
  .where('p.reunion_id', id).orderBy('p.id')
  .select('p.*', db.raw(`coalesce(${nomComplet('a').toString()}, u.username) as nom`));

const decisionsDe = (id) => db('decisions as d').join('users as u', 'u.id', 'd.responsable_user_id').leftJoin('agents as a', 'a.id', 'u.agent_id')
  .where('d.reunion_id', id).orderBy('d.id')
  .select('d.*', db.raw(`coalesce(${nomComplet('a').toString()}, u.username) as responsable_nom`));

/** Comptes internes invitables : agents de la DEP en fonction et Secrétaire Général. */
async function invitables() {
  const all = await loadAllNodes();
  return all.filter((n) => n.node).map((n) => ({ userId: n.userId, nomComplet: n.nomComplet, roleLibelle: n.roleLibelle, structure: n.structure }))
    .sort((a, b) => a.nomComplet.localeCompare(b.nomComplet, 'fr'));
}

router.get('/invitables', async (req, res) => {
  if (!req.ctx.can('reunions.organiser') && !req.ctx.can('reunions.preparer_direction')) throw forbidden();
  res.json({ data: await invitables() });
});

router.get('/', validate({ query: z.object({ periode: z.enum(['a_venir', 'passees', 'toutes']).optional(), statut: z.enum(Object.keys(STATUTS)).optional() }) }), async (req, res) => {
  const { periode = 'toutes', statut } = req.valid.query;
  const q = scopeReunions(baseQuery(), req.ctx);
  if (statut) q.where('r.statut', statut);
  if (periode === 'a_venir') q.where('r.debut', '>=', db.raw(`date_trunc('day', now())`)).orderBy('r.debut', 'asc');
  else q.orderBy('r.debut', 'desc');
  if (periode === 'passees') q.where('r.debut', '<', db.raw(`date_trunc('day', now())`));
  const rows = await q.limit(500);
  res.json({
    data: rows,
    droits: { organiser: req.ctx.can('reunions.organiser') || req.ctx.can('reunions.preparer_direction'), pourDirecteur: req.ctx.can('reunions.preparer_direction') && req.ctx.primaryRole !== 'DIRECTEUR' },
  });
});

router.get('/:id', validate({ params: idParam }), async (req, res) => {
  const r = await charger(req.ctx, req.valid.params.id);
  const [participants, decisions, historique] = await Promise.all([participantsDe(r.id), decisionsDe(r.id), getHistory('REUNION', r.id)]);
  const ro = roles(req.ctx, r);
  const commencee = new Date(r.debut) <= new Date();
  res.json({
    ...r, participants, decisions, historique,
    actions: {
      ...ro,
      modifier: ro.preparer && ['BROUILLON', 'CONVOQUEE'].includes(r.statut),
      convoquer: ro.preparer && r.statut === 'BROUILLON',
      reporter: ro.preparer && r.statut === 'CONVOQUEE',
      annuler: ro.preparer && ['BROUILLON', 'CONVOQUEE'].includes(r.statut),
      presences: ro.rediger && (['CONVOQUEE', 'TENUE'].includes(r.statut)) && commencee,
      tenue: ro.rediger && r.statut === 'CONVOQUEE' && commencee,
      compteRendu: ro.rediger && r.statut === 'TENUE',
      soumettre: ro.rediger && r.statut === 'TENUE' && !ro.president,
      validerCr: ro.president && (r.statut === 'CR_A_VALIDER' || r.statut === 'TENUE'),
      retournerCr: ro.president && r.statut === 'CR_A_VALIDER',
    },
  });
});

const dateHeure = z.string().datetime({ offset: true }).or(z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/));
const pointSchema = z.object({ titre: z.string().trim().min(2).max(300), rapporteur: z.string().trim().max(200).optional().nullable(), duree: z.coerce.number().int().min(0).max(600).optional().nullable() });
const reunionSchema = z.object({
  objet: z.string().trim().min(3).max(300),
  debut: dateHeure,
  fin: dateHeure.optional().nullable(),
  lieu: z.string().trim().max(200).optional().nullable(),
  ordre_du_jour: z.array(pointSchema).max(30).default([]),
  participants: z.array(z.coerce.number().int().positive()).max(200).default([]),
  externes: z.array(z.object({ nom: z.string().trim().min(2).max(200), qualite: z.string().trim().max(200).optional().nullable() })).max(50).default([]),
  redacteur_user_id: z.coerce.number().int().positive().optional().nullable(),
  confidentialite: z.enum(['ORDINAIRE', 'CONFIDENTIEL', 'SECRET']).default('ORDINAIRE'),
  pour_directeur: z.boolean().optional().default(false),
});

function controlerDates(debut, fin) {
  const d = new Date(debut);
  if (Number.isNaN(d.getTime())) throw badRequest('Date de début invalide.');
  if (fin && new Date(fin) <= d) throw badRequest('La fin de la réunion doit suivre son début.');
}

async function controlerParticipants(ids, redacteur) {
  const valides = new Set((await invitables()).map((n) => n.userId));
  const inconnus = [...ids, ...(redacteur ? [redacteur] : [])].filter((x) => !valides.has(x));
  if (inconnus.length) throw badRequest('Participant inconnu ou hors de la Direction.');
}

async function ecrireParticipants(trx, reunionId, ids, externes, presidentId) {
  await trx('reunion_participants').where({ reunion_id: reunionId }).del();
  const lignes = [...new Set(ids)].filter((x) => x !== presidentId).map((u) => ({ reunion_id: reunionId, user_id: u }));
  for (const e of externes) lignes.push({ reunion_id: reunionId, nom_externe: e.nom, qualite_externe: e.qualite || null });
  if (lignes.length) await trx('reunion_participants').insert(lignes);
}

router.post('/', validate({ body: reunionSchema }), async (req, res) => {
  const b = req.valid.body;
  const ctx = req.ctx;
  controlerDates(b.debut, b.fin);
  let niveau; let presidentId = ctx.userId; let redacteur = b.redacteur_user_id || ctx.userId;
  const aff = ctx.affectation || {};
  if (ctx.primaryRole === 'DIRECTEUR' && ctx.can('reunions.organiser')) niveau = 'DIRECTION';
  else if (b.pour_directeur && ctx.can('reunions.preparer_direction')) {
    // Réunion présidée par le Directeur, préparée par le Bureau Secrétariat de Direction
    const [dir] = await directeursActifs();
    if (!dir) throw badRequest('Aucun Directeur en fonction.');
    niveau = 'DIRECTION'; presidentId = dir; redacteur = b.redacteur_user_id || ctx.userId;
  } else if (ctx.primaryRole === 'CHEF_DIVISION' && ctx.perimetre === 'DIVISION' && ctx.can('reunions.organiser')) niveau = 'DIVISION';
  else if (ctx.primaryRole === 'CHEF_BUREAU' && ctx.bureauId && ctx.can('reunions.organiser')) niveau = 'BUREAU';
  else throw forbidden('Vous ne pouvez pas organiser de réunion.');
  await controlerParticipants(b.participants, b.redacteur_user_id);
  const dep = await db('directions').where({ code: 'DEP' }).first();
  const row = await db.transaction(async (trx) => {
    const reference = await nextReference('REU', 'DEP/REU', trx);
    const [r] = await trx('reunions').insert({
      reference, objet: b.objet, niveau, debut: b.debut, fin: b.fin || null, lieu: b.lieu || null, ordre_du_jour: JSON.stringify(b.ordre_du_jour),
      president_user_id: presidentId, organisateur_user_id: ctx.userId, redacteur_user_id: redacteur, confidentialite: b.confidentialite,
      direction_id: dep.id, division_id: niveau === 'DIRECTION' ? null : (aff.division_id || null), bureau_id: niveau === 'BUREAU' ? ctx.bureauId : null,
    }).returning('*');
    await ecrireParticipants(trx, r.id, b.participants, b.externes, presidentId);
    await addHistory('REUNION', r.id, ctx.userId, { action: 'CREATION', nouveau: 'BROUILLON', commentaire: `Réunion préparée : ${b.objet}` }, trx);
    return r;
  });
  await audit(req, { action: 'CREATION', module: 'reunions', entite: 'reunion', entiteId: row.id, apres: { reference: row.reference, objet: row.objet } });
  res.status(201).json(row);
});

router.put('/:id', validate({ params: idParam, body: reunionSchema.omit({ pour_directeur: true }) }), async (req, res) => {
  const r = await charger(req.ctx, req.valid.params.id);
  if (!roles(req.ctx, r).preparer || !['BROUILLON', 'CONVOQUEE'].includes(r.statut)) throw forbidden('Réunion non modifiable.');
  const b = req.valid.body;
  controlerDates(b.debut, b.fin);
  await controlerParticipants(b.participants, b.redacteur_user_id);
  const avant = await participantsDe(r.id);
  const deplacee = new Date(b.debut).getTime() !== new Date(r.debut).getTime();
  await db.transaction(async (trx) => {
    await trx('reunions').where({ id: r.id }).update({
      objet: b.objet, debut: b.debut, fin: b.fin || null, lieu: b.lieu || null, ordre_du_jour: JSON.stringify(b.ordre_du_jour),
      redacteur_user_id: b.redacteur_user_id || r.redacteur_user_id, confidentialite: b.confidentialite, rappel_envoye: deplacee ? false : r.rappel_envoye, updated_at: trx.fn.now(),
    });
    await ecrireParticipants(trx, r.id, b.participants, b.externes, r.president_user_id);
    await addHistory('REUNION', r.id, req.ctx.userId, { action: deplacee && r.statut === 'CONVOQUEE' ? 'REPORT' : 'MODIFICATION', commentaire: deplacee ? `Nouvelle date : ${new Date(b.debut).toLocaleString('fr-FR', { timeZone: 'Africa/Kinshasa' })}` : 'Réunion modifiée' }, trx);
  });
  if (r.statut === 'CONVOQUEE') {
    const anciens = new Set(avant.map((p) => p.user_id).filter(Boolean));
    const tous = [...new Set([...b.participants, r.president_user_id])].filter((x) => x !== req.ctx.userId);
    await notify(tous, { type: 'REUNION', titre: `${deplacee ? 'Réunion reportée' : 'Réunion modifiée'} : ${b.objet}`, message: `Réf. ${r.reference}`, lien: `/reunions/${r.id}`, expediteur: req.ctx.userId });
    const retires = [...anciens].filter((x) => !b.participants.includes(x));
    if (retires.length) await notify(retires, { type: 'REUNION', titre: `Vous n’êtes plus convoqué(e) : ${b.objet}`, message: `Réf. ${r.reference}`, lien: '/reunions', expediteur: req.ctx.userId });
    await synchroniserAgenda(r.id, req.ctx.userId);
  }
  await audit(req, { action: 'MODIFICATION', module: 'reunions', entite: 'reunion', entiteId: r.id, message: deplacee ? 'Report' : 'Modification' });
  res.json(await charger(req.ctx, r.id));
});

/** Réunion présidée par le Directeur : reportée dans son agenda (créée, déplacée ou annulée). */
async function synchroniserAgenda(reunionId, userId) {
  const r = await db('reunions').where({ id: reunionId }).first();
  if (r.niveau !== 'DIRECTION') return;
  const ev = await db('agenda_evenements').where({ reunion_id: r.id }).first();
  const statut = r.statut === 'ANNULEE' ? 'ANNULE' : ['TENUE', 'CR_A_VALIDER', 'CLOTUREE'].includes(r.statut) ? 'TENU' : 'CONFIRME';
  const champs = { titre: r.objet, debut: r.debut, fin: r.fin, lieu: r.lieu, statut, confidentiel: r.confidentialite !== 'ORDINAIRE', updated_at: db.fn.now() };
  if (ev) {
    const deplace = new Date(ev.debut).getTime() !== new Date(r.debut).getTime();
    await db('agenda_evenements').where({ id: ev.id }).update({ ...champs, ...(deplace ? { rappel_veille_envoye: false, rappel_heure_envoye: false } : {}) });
  } else if (r.statut !== 'ANNULEE') {
    await db('agenda_evenements').insert({ ...champs, type: 'REUNION', reunion_id: r.id, created_by: userId });
  }
}

async function changer(req, r, patch, action, commentaire) {
  const [u] = await db('reunions').where({ id: r.id }).update({ ...patch, updated_at: db.fn.now() }).returning('*');
  await addHistory('REUNION', r.id, req.ctx.userId, { action, ancien: r.statut, nouveau: u.statut, commentaire });
  await audit(req, { action: action === 'VALIDATION_CR' ? 'VALIDATION' : 'MODIFICATION', module: 'reunions', entite: 'reunion', entiteId: r.id, avant: { statut: r.statut }, apres: { statut: u.statut }, message: action });
  return u;
}

async function internes(r) {
  return [...new Set([r.president_user_id, r.organisateur_user_id, r.redacteur_user_id, ...(await db('reunion_participants').where({ reunion_id: r.id }).whereNotNull('user_id').pluck('user_id'))])].filter(Boolean);
}

router.post('/:id/convoquer', validate({ params: idParam }), async (req, res) => {
  const r = await charger(req.ctx, req.valid.params.id);
  if (!roles(req.ctx, r).preparer || r.statut !== 'BROUILLON') throw badRequest('Seule une réunion en préparation peut être convoquée, par ses organisateurs.');
  if (new Date(r.debut) <= new Date()) throw badRequest('La date de la réunion est passée : modifiez-la avant de convoquer.');
  if (!(await db('reunion_participants').where({ reunion_id: r.id }).first())) throw badRequest('Ajoutez au moins un participant.');
  const u = await changer(req, r, { statut: 'CONVOQUEE', convoquee_at: db.fn.now() }, 'CONVOCATION', 'Convocations envoyées');
  const quand = new Date(r.debut).toLocaleString('fr-FR', { timeZone: 'Africa/Kinshasa', dateStyle: 'full', timeStyle: 'short' });
  await notify((await internes(r)).filter((x) => x !== req.ctx.userId), { type: 'REUNION', titre: `Convocation : ${r.objet}`, message: `${quand}${r.lieu ? ` — ${r.lieu}` : ''}`, lien: `/reunions/${r.id}`, expediteur: req.ctx.userId });
  await synchroniserAgenda(r.id, req.ctx.userId);
  res.json(u);
});

router.post('/:id/annuler', validate({ params: idParam, body: z.object({ motif: z.string().trim().min(3).max(2000) }) }), async (req, res) => {
  const r = await charger(req.ctx, req.valid.params.id);
  if (!roles(req.ctx, r).preparer || !['BROUILLON', 'CONVOQUEE'].includes(r.statut)) throw badRequest('Cette réunion ne peut plus être annulée.');
  const u = await changer(req, r, { statut: 'ANNULEE', motif_annulation: req.valid.body.motif }, 'ANNULATION', req.valid.body.motif);
  if (r.statut === 'CONVOQUEE') {
    await notify((await internes(r)).filter((x) => x !== req.ctx.userId), { type: 'REUNION', titre: `Réunion annulée : ${r.objet}`, message: req.valid.body.motif, lien: `/reunions/${r.id}`, expediteur: req.ctx.userId });
    await synchroniserAgenda(r.id, req.ctx.userId);
  }
  res.json(u);
});

router.put('/:id/presences', validate({ params: idParam, body: z.object({ presences: z.array(z.object({ id: z.coerce.number().int().positive(), presence: z.enum(Object.keys(PRESENCES)), represente_par: z.string().trim().max(200).optional().nullable() })).max(300) }) }), async (req, res) => {
  const r = await charger(req.ctx, req.valid.params.id);
  if (!roles(req.ctx, r).rediger || !['CONVOQUEE', 'TENUE'].includes(r.statut)) throw forbidden('Présence non modifiable.');
  if (new Date(r.debut) > new Date()) throw badRequest('La présence se relève à partir de l’heure de la réunion.');
  const ids = new Set(await db('reunion_participants').where({ reunion_id: r.id }).pluck('id'));
  for (const p of req.valid.body.presences) {
    if (!ids.has(p.id)) throw badRequest('Participant inconnu.');
    await db('reunion_participants').where({ id: p.id }).update({ presence: p.presence, represente_par: p.presence === 'REPRESENTE' ? (p.represente_par || null) : null });
  }
  await addHistory('REUNION', r.id, req.ctx.userId, { action: 'PRESENCE', commentaire: `Présence relevée (${req.valid.body.presences.filter((p) => p.presence === 'PRESENT').length} présent(s))` });
  res.json({ data: await participantsDe(r.id) });
});

router.post('/:id/tenue', validate({ params: idParam }), async (req, res) => {
  const r = await charger(req.ctx, req.valid.params.id);
  if (!roles(req.ctx, r).rediger || r.statut !== 'CONVOQUEE') throw badRequest('Seule une réunion convoquée peut être déclarée tenue.');
  if (new Date(r.debut) > new Date()) throw badRequest('La réunion n’a pas encore commencé.');
  const u = await changer(req, r, { statut: 'TENUE', tenue_at: db.fn.now() }, 'TENUE', 'Réunion tenue : rédaction du compte rendu');
  await synchroniserAgenda(r.id, req.ctx.userId);
  res.json(u);
});

const decisionSchema = z.object({
  libelle: z.string().trim().min(3).max(500),
  description: z.string().trim().max(5000).optional().nullable(),
  resultat_attendu: z.string().trim().max(2000).optional().nullable(),
  responsable_user_id: z.coerce.number().int().positive(),
  echeance: z.string().date().optional().nullable(),
});

router.put('/:id/compte-rendu', validate({ params: idParam, body: z.object({ compte_rendu: z.string().trim().max(50000), decisions: z.array(decisionSchema).max(50).default([]) }) }), async (req, res) => {
  const r = await charger(req.ctx, req.valid.params.id);
  if (!roles(req.ctx, r).rediger || r.statut !== 'TENUE') throw forbidden('Le compte rendu se rédige après la tenue de la réunion, par son rédacteur.');
  const b = req.valid.body;
  const nodes = await loadAllNodes();
  const parId = new Map(nodes.filter((n) => n.node).map((n) => [n.userId, n]));
  for (const d of b.decisions) if (!parId.has(d.responsable_user_id)) throw badRequest('Responsable de décision inconnu ou hors de la Direction.');
  const dep = await db('directions').where({ code: 'DEP' }).first();
  await db.transaction(async (trx) => {
    await trx('reunions').where({ id: r.id }).update({ compte_rendu: b.compte_rendu, updated_at: trx.fn.now() });
    // Les décisions restent à l’état de projet jusqu’à la validation du compte rendu par le président.
    await trx('decisions').where({ reunion_id: r.id, statut: 'PROJET' }).del();
    for (const d of b.decisions) {
      const resp = parId.get(d.responsable_user_id);
      await trx('decisions').insert({
        ...d, echeance: d.echeance || null, reference: await nextReference('DEC', 'DEP/DEC', trx), origine: 'REUNION', reunion_id: r.id, statut: 'PROJET',
        decideur_user_id: r.president_user_id, created_by: req.ctx.userId, direction_id: dep.id, division_id: resp.divisionId || null, bureau_id: resp.bureauId || null,
      });
    }
  });
  await audit(req, { action: 'MODIFICATION', module: 'reunions', entite: 'reunion', entiteId: r.id, message: `Compte rendu enregistré (${b.decisions.length} décision(s))` });
  res.json({ ...(await charger(req.ctx, r.id)), decisions: await decisionsDe(r.id) });
});

router.post('/:id/soumettre-cr', validate({ params: idParam }), async (req, res) => {
  const r = await charger(req.ctx, req.valid.params.id);
  if (!roles(req.ctx, r).rediger || r.statut !== 'TENUE') throw badRequest('Compte rendu non soumis : la réunion doit être tenue.');
  if (!r.compte_rendu || r.compte_rendu.trim().length < 10) throw badRequest('Rédigez le compte rendu avant de le soumettre.');
  const u = await changer(req, r, { statut: 'CR_A_VALIDER', cr_soumis_at: db.fn.now() }, 'SOUMISSION_CR', 'Compte rendu soumis au président');
  await notify(r.president_user_id, { type: 'REUNION', titre: `Compte rendu à valider : ${r.objet}`, message: `Réf. ${r.reference}`, lien: `/reunions/${r.id}`, expediteur: req.ctx.userId });
  res.json(u);
});

router.post('/:id/retourner-cr', validate({ params: idParam, body: z.object({ observations: z.string().trim().min(3).max(5000) }) }), async (req, res) => {
  const r = await charger(req.ctx, req.valid.params.id);
  if (r.president_user_id !== req.ctx.userId || r.statut !== 'CR_A_VALIDER') throw forbidden('Seul le président retourne le compte rendu soumis.');
  const u = await changer(req, r, { statut: 'TENUE', observations_president: req.valid.body.observations }, 'RETOUR_CR', req.valid.body.observations);
  await notify([r.redacteur_user_id, r.organisateur_user_id].filter((x) => x && x !== req.ctx.userId), { type: 'REUNION', titre: `Compte rendu à corriger : ${r.objet}`, message: req.valid.body.observations, lien: `/reunions/${r.id}`, expediteur: req.ctx.userId });
  res.json(u);
});

router.post('/:id/valider-cr', validate({ params: idParam }), async (req, res) => {
  const r = await charger(req.ctx, req.valid.params.id);
  if (r.president_user_id !== req.ctx.userId || !['CR_A_VALIDER', 'TENUE'].includes(r.statut)) throw forbidden('Seul le président valide le compte rendu.');
  if (!r.compte_rendu || r.compte_rendu.trim().length < 10) throw badRequest('Le compte rendu est vide.');
  const projets = await db('decisions').where({ reunion_id: r.id, statut: 'PROJET' });
  const u = await db.transaction(async (trx) => {
    await trx('decisions').where({ reunion_id: r.id, statut: 'PROJET' }).update({ statut: 'A_EXECUTER', decidee_at: trx.fn.now(), updated_at: trx.fn.now() });
    for (const d of projets) await addHistory('DECISION', d.id, req.ctx.userId, { action: 'DECISION', nouveau: 'A_EXECUTER', commentaire: `Décision de la réunion ${r.reference}` }, trx);
    const [x] = await trx('reunions').where({ id: r.id }).update({ statut: 'CLOTUREE', cr_valide_par: req.ctx.userId, cr_valide_at: trx.fn.now(), updated_at: trx.fn.now() }).returning('*');
    await addHistory('REUNION', r.id, req.ctx.userId, { action: 'VALIDATION_CR', ancien: r.statut, nouveau: 'CLOTUREE', commentaire: `Compte rendu validé ; ${projets.length} décision(s) au registre` }, trx);
    return x;
  });
  await audit(req, { action: 'VALIDATION', module: 'reunions', entite: 'reunion', entiteId: r.id, message: `Compte rendu validé (${projets.length} décision(s))` });
  for (const d of projets) {
    await notify(d.responsable_user_id, { type: 'DECISION', titre: `Décision à exécuter : ${d.libelle}`, message: `${d.reference} — réunion ${r.reference}${d.echeance ? ` — échéance ${String(d.echeance).split('-').reverse().join('/')}` : ''}`, lien: `/decisions/${d.id}`, expediteur: req.ctx.userId });
  }
  const presents = await db('reunion_participants').where({ reunion_id: r.id }).whereNotNull('user_id').pluck('user_id');
  await notify([...new Set([...presents, r.redacteur_user_id, r.organisateur_user_id])].filter((x) => x && x !== req.ctx.userId), { type: 'REUNION', titre: `Compte rendu validé : ${r.objet}`, message: `Réf. ${r.reference}`, lien: `/reunions/${r.id}`, expediteur: req.ctx.userId });
  res.json(u);
});

router.get('/:id/pdf', requirePerm('exports.generer'), validate({ params: idParam }), async (req, res) => {
  const r = await charger(req.ctx, req.valid.params.id);
  const [participants, decisions] = await Promise.all([participantsDe(r.id), decisionsDe(r.id)]);
  await audit(req, { action: 'EXPORT', module: 'reunions', entite: 'reunion', entiteId: r.id, message: 'Compte rendu PDF' });
  const cr = r.statut === 'CLOTUREE';
  const { doc, finish } = pdf.createPdf(res, { filename: `${r.reference.replace(/\//g, '-')}.pdf`, titre: cr ? 'COMPTE RENDU DE RÉUNION' : 'CONVOCATION ET ORDRE DU JOUR', sousTitre: r.objet, reference: r.reference });
  pdf.keyValues(doc, [
    ['Date', new Date(r.debut).toLocaleString('fr-FR', { timeZone: 'Africa/Kinshasa', dateStyle: 'full', timeStyle: 'short' })],
    ['Lieu', r.lieu || '—'], ['Président', r.president_nom], ['Rédacteur', r.redacteur_nom || '—'], ['Statut', STATUTS[r.statut]],
    ...(r.cr_valide_at ? [['Compte rendu validé le', pdf.fmtDateTime(r.cr_valide_at)]] : []),
  ]);
  pdf.section(doc, 'Ordre du jour', (r.ordre_du_jour || []).map((p, i) => `${i + 1}. ${p.titre}${p.rapporteur ? ` (${p.rapporteur})` : ''}`).join('\n') || '—');
  pdf.table(doc, [
    { header: 'Participant', value: (p) => p.nom || `${p.nom_externe}${p.qualite_externe ? ` — ${p.qualite_externe}` : ''}`, width: 4 },
    { header: 'Présence', value: (p) => (p.presence ? `${PRESENCES[p.presence]}${p.represente_par ? ` par ${p.represente_par}` : ''}` : '—'), width: 2 },
  ], participants);
  if (r.compte_rendu) pdf.section(doc, 'Compte rendu', r.compte_rendu);
  if (decisions.length) {
    pdf.table(doc, [
      { header: 'Référence', key: 'reference', width: 2 }, { header: 'Décision', key: 'libelle', width: 5 },
      { header: 'Responsable', key: 'responsable_nom', width: 2.5 }, { header: 'Échéance', value: (d) => pdf.fmtDate(d.echeance), width: 1.5 },
    ], decisions);
  }
  return finish();
});

module.exports = router;
module.exports.scopeReunions = scopeReunions;
module.exports.synchroniserAgenda = synchroniserAgenda;
module.exports.STATUTS = STATUTS;

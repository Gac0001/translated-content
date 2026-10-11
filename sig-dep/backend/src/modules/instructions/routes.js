'use strict';
/**
 * Instructions : émises exclusivement vers le subordonné direct dans la chaîne hiérarchique.
 *   Secrétaire Général → Directeur → Chef de Division → Chef de Bureau
 *   Directeur → Chef du Bureau Secrétariat de Direction
 * Exception : le Directeur peut adresser une instruction à tout agent de la DEP, avec une
 * justification obligatoire et une copie automatique au supérieur immédiat du destinataire.
 * Les comptes rendus remontent vers l’émetteur. Chaque étape est horodatée.
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
const { ctxNode, relation, loadAllNodes, directContacts } = require('../../services/hierarchy');
const { scopeInstructions, loadEntity } = require('../../services/access');
const pdf = require('../../services/pdf');
const { sendWorkbook } = require('../../services/excel');
const { notFound, badRequest, forbidden } = require('../../utils/errors');
const { ROLE_LIBELLES } = require('../../constants');
const traitement = require('../../services/traitement');

const router = express.Router();
const idParam = z.object({ id: z.coerce.number().int().positive() });
const PRIORITES = ['BASSE', 'NORMALE', 'HAUTE', 'URGENTE'];
const STATUT_LIBELLES = traitement.LIBELLES;
const STATUTS = Object.keys(STATUT_LIBELLES);
const { ACTIFS } = traitement;

function baseQuery() {
  return db('instructions as i')
    .join('users as ue', 'ue.id', 'i.emetteur_user_id').leftJoin('agents as ae', 'ae.id', 'ue.agent_id')
    .join('users as ud', 'ud.id', 'i.destinataire_user_id').leftJoin('agents as ad', 'ad.id', 'ud.agent_id')
    .leftJoin('users as uc', 'uc.id', 'i.copie_user_id').leftJoin('agents as ac', 'ac.id', 'uc.agent_id')
    .select('i.*', db.raw(`concat_ws(' ', ae.prenom, ae.nom) as emetteur_nom`), db.raw(`concat_ws(' ', ad.prenom, ad.nom) as destinataire_nom`),
      db.raw(`nullif(concat_ws(' ', ac.prenom, ac.nom), '') as copie_nom`));
}

/** Contrôle de la chaîne hiérarchique : l’émetteur doit être le supérieur DIRECT du destinataire. */
async function assertCanAddress(ctx, destinataireId) {
  const me = ctxNode(ctx);
  if (!me) throw forbidden('Votre compte n’occupe aucune position dans la chaîne hiérarchique de la DEP : vous ne pouvez adresser d’instruction.', 'HORS_CHAINE');
  const all = await loadAllNodes();
  const dest = all.find((n) => n.userId === destinataireId);
  if (!dest || !dest.node) throw badRequest('Destinataire inconnu ou hors de la chaîne hiérarchique.');
  const rel = relation(me, dest.node);
  if (rel !== 'DESCENDANT') {
    let msg = 'Transmission contraire à la chaîne hiérarchique : une instruction ne peut être adressée qu’à votre subordonné direct.';
    if (ctx.primaryRole === 'SECRETAIRE_GENERAL') msg = 'Toute instruction du Secrétaire Général doit obligatoirement être adressée au Directeur.';
    if (ctx.primaryRole === 'AGENT') msg = 'Un Agent ne peut pas adresser d’instruction.';
    throw forbidden(msg, 'CHAINE_HIERARCHIQUE');
  }
  return dest;
}

/**
 * Instruction exceptionnelle du Directeur : tout agent de la DEP qui n’est pas son subordonné direct.
 * Renvoie le destinataire et son supérieur immédiat, qui reçoit la copie.
 */
async function assertExceptionnelle(ctx, destinataireId) {
  if (!ctx.can('instructions.exceptionnelle') || ctx.primaryRole !== 'DIRECTEUR') throw forbidden('Seul le Directeur peut adresser une instruction exceptionnelle.', 'CHAINE_HIERARCHIQUE');
  const me = ctxNode(ctx);
  const all = await loadAllNodes();
  const dest = all.find((n) => n.userId === destinataireId);
  if (!me || !dest || !dest.node || dest.userId === ctx.userId || dest.primaryRole === 'SECRETAIRE_GENERAL') throw badRequest('Destinataire inconnu ou hors de la Direction.');
  if (relation(me, dest.node) === 'DESCENDANT') throw badRequest('Ce destinataire relève directement de vous : adressez-lui une instruction ordinaire.');
  const superieur = all.find((n) => n.node && n.node.key === dest.node.parent && n.userId !== ctx.userId) || null;
  return { dest, superieur };
}

async function resoudreDestinataire(ctx, destinataireId, exceptionnelle) {
  if (exceptionnelle) return assertExceptionnelle(ctx, destinataireId);
  return { dest: await assertCanAddress(ctx, destinataireId), superieur: null };
}

router.get('/destinataires', requirePerm('instructions.emettre'), async (req, res) => {
  const list = await directContacts(req.ctx, 'DESCENDANT');
  const data = list.filter((n) => n.primaryRole !== 'AGENT' || req.ctx.primaryRole === 'CHEF_BUREAU');
  let exceptionnels = [];
  if (req.ctx.can('instructions.exceptionnelle') && req.ctx.primaryRole === 'DIRECTEUR') {
    const all = await loadAllNodes();
    const directs = new Set(list.map((n) => n.userId));
    exceptionnels = all.filter((n) => n.node && n.userId !== req.ctx.userId && n.primaryRole !== 'SECRETAIRE_GENERAL' && !directs.has(n.userId))
      .map((n) => ({ ...n, superieur: (all.find((x) => x.node && x.node.key === n.node.parent) || {}).nomComplet || null }))
      .sort((a, b) => a.nomComplet.localeCompare(b.nomComplet, 'fr'));
  }
  res.json({ data, exceptionnels });
});

const listQuery = z.object({
  statut: z.enum(STATUTS).optional(),
  priorite: z.enum(PRIORITES).optional(),
  boite: z.enum(['recues', 'emises', 'toutes']).optional(),
  q: z.string().trim().max(100).optional(),
});

function listed(req) {
  const { statut, priorite, boite, q } = req.valid.query;
  const query = scopeInstructions(baseQuery(), req.ctx);
  if (statut) query.where('i.statut', statut);
  if (priorite) query.where('i.priorite', priorite);
  if (boite === 'recues') query.where('i.destinataire_user_id', req.ctx.userId).whereNot('i.statut', 'BROUILLON');
  if (boite === 'emises') query.where('i.emetteur_user_id', req.ctx.userId);
  // Les brouillons ne sont visibles que de leur émetteur
  query.where((w) => w.whereNot('i.statut', 'BROUILLON').orWhere('i.emetteur_user_id', req.ctx.userId));
  if (q) query.where((w) => w.whereILike('i.objet', `%${q}%`).orWhereILike('i.reference', `%${q}%`));
  return query.orderBy('i.created_at', 'desc');
}

router.get('/', requirePerm('instructions.consulter'), validate({ query: listQuery }), async (req, res) => {
  res.json({ data: await listed(req).limit(500) });
});

router.get('/export/:format', requirePerm('instructions.consulter'), requirePerm('exports.generer'), validate({ params: z.object({ format: z.enum(['pdf', 'xlsx']) }), query: listQuery }), async (req, res) => {
  const rows = await listed(req);
  const columns = [
    { header: 'Référence', key: 'reference', width: 16 },
    { header: 'Objet', key: 'objet', width: 36 },
    { header: 'Émetteur', value: (r) => `${r.emetteur_nom} (${ROLE_LIBELLES[r.emetteur_role]})`, width: 26 },
    { header: 'Destinataire', value: (r) => `${r.destinataire_nom} (${ROLE_LIBELLES[r.destinataire_role]})`, width: 26 },
    { header: 'Priorité', key: 'priorite', width: 10 },
    { header: 'Émission', value: (r) => pdf.fmtDate(r.date_emission), width: 11 },
    { header: 'Échéance', value: (r) => pdf.fmtDate(r.echeance), width: 11 },
    { header: 'Statut', value: (r) => STATUT_LIBELLES[r.statut], width: 11 },
    { header: 'Avancement', value: (r) => `${r.avancement} %`, width: 10 },
  ];
  await audit(req, { action: 'EXPORT', module: 'instructions', message: `Registre des instructions (${req.valid.params.format})` });
  if (req.valid.params.format === 'xlsx') return sendWorkbook(res, 'instructions-DEP.xlsx', [{ name: 'Instructions', titre: 'Registre des instructions', columns, rows }]);
  const { doc, finish } = pdf.createPdf(res, { filename: 'instructions-DEP.pdf', titre: 'Registre des instructions', landscape: true });
  pdf.table(doc, columns, rows);
  return finish();
});

router.get('/:id', requirePerm('instructions.consulter'), validate({ params: idParam }), async (req, res) => {
  await loadEntity(req.ctx, 'INSTRUCTION', req.valid.params.id);
  const row = await baseQuery().where('i.id', req.valid.params.id).first();
  if (row.statut === 'BROUILLON' && row.emetteur_user_id !== req.ctx.userId) throw forbidden('Brouillon non transmis.');
  const [historique, sousInstructions, taches, pieces, prolongations] = await Promise.all([
    getHistory('INSTRUCTION', row.id),
    scopeInstructions(baseQuery().where('i.parent_id', row.id), req.ctx),
    db('tasks as t').leftJoin('users as u', 'u.id', 't.agent_user_id').leftJoin('agents as a', 'a.id', 'u.agent_id').where('t.instruction_id', row.id).select('t.id', 't.reference', 't.titre', 't.statut', 't.avancement', db.raw(`concat_ws(' ', a.prenom, a.nom) as agent_nom`)),
    db('attachments').where({ entity_type: 'INSTRUCTION', entity_id: row.id }).whereNull('deleted_at'),
    traitement.prolongations('INSTRUCTION', row.id),
  ]);
  const parent = row.parent_id ? await db('instructions').where({ id: row.parent_id }).first('id', 'reference', 'objet') : null;
  const estEmetteur = row.emetteur_user_id === req.ctx.userId;
  const estDestinataire = row.destinataire_user_id === req.ctx.userId;
  const demande = prolongations.find((p) => p.statut === 'DEMANDEE') || null;
  res.json({
    ...row, historique, sousInstructions, taches, pieces, parent, prolongations,
    actions: {
      estEmetteur, estDestinataire, estCopie: row.copie_user_id === req.ctx.userId,
      bloquer: estDestinataire && ACTIFS.includes(row.statut),
      debloquer: (estDestinataire || estEmetteur) && row.statut === 'BLOQUEE',
      rapportIntermediaire: estDestinataire && ACTIFS.includes(row.statut),
      demanderProlongation: estDestinataire && [...ACTIFS, 'BLOQUEE'].includes(row.statut) && !demande,
      deciderProlongation: estEmetteur && !!demande,
      prolonger: estEmetteur && !demande && !traitement.TERMINES.includes(row.statut) && row.statut !== 'BROUILLON',
      annuler: estEmetteur && !traitement.TERMINES.includes(row.statut),
    },
  });
});

const createSchema = z.object({
  destinataire_user_id: z.coerce.number().int().positive(),
  objet: z.string().trim().min(3).max(500),
  contenu: z.string().trim().min(3).max(20000),
  priorite: z.enum(PRIORITES).default('NORMALE'),
  echeance: z.string().date().optional().nullable(),
  parent_id: z.coerce.number().int().positive().optional().nullable(),
  courrier_id: z.coerce.number().int().positive().optional().nullable(),
  brouillon: z.boolean().optional().default(false),
  exceptionnelle: z.boolean().optional().default(false),
  justification_exception: z.string().trim().max(5000).optional().nullable(),
});

/** Crée (et transmet, sauf brouillon) une instruction ; utilisé aussi pour mettre en œuvre une décision. */
async function creerInstruction(req, b) {
  if (b.exceptionnelle && (!b.justification_exception || b.justification_exception.length < 10)) throw badRequest('Justifiez l’instruction exceptionnelle (10 caractères au moins).');
  const { dest, superieur } = await resoudreDestinataire(req.ctx, b.destinataire_user_id, b.exceptionnelle);
  if (b.exceptionnelle && b.parent_id) throw badRequest('Une instruction exceptionnelle ne peut pas décliner une autre instruction.');
  if (b.echeance && new Date(b.echeance) < new Date(new Date().toISOString().slice(0, 10))) throw badRequest('L’échéance ne peut pas être antérieure à aujourd’hui.');
  if (b.parent_id) {
    const parent = await db('instructions').where({ id: b.parent_id }).first();
    if (!parent || parent.destinataire_user_id !== req.ctx.userId) throw forbidden('Vous ne pouvez décliner qu’une instruction qui vous a été adressée.');
  }
  const dep = await db('directions').where({ code: 'DEP' }).first();
  const row = await db.transaction(async (trx) => {
    const reference = await nextReference('INS', 'DEP/INS', trx);
    const [r] = await trx('instructions').insert({
      reference, parent_id: b.parent_id || null, courrier_id: b.courrier_id || null,
      emetteur_user_id: req.ctx.userId, destinataire_user_id: dest.userId,
      emetteur_role: req.ctx.primaryRole, destinataire_role: dest.primaryRole,
      objet: b.objet, contenu: b.contenu, priorite: b.priorite, echeance: b.echeance || null,
      statut: b.brouillon ? 'BROUILLON' : 'TRANSMISE', date_emission: b.brouillon ? null : trx.fn.now(),
      direction_id: dep.id, division_id: dest.divisionId || null, bureau_id: dest.bureauId || null,
      exceptionnelle: !!b.exceptionnelle, justification_exception: b.exceptionnelle ? b.justification_exception : null,
      copie_user_id: superieur ? superieur.userId : null,
    }).returning('*');
    const copie = superieur ? ` ; copie à ${superieur.nomComplet} (${superieur.roleLibelle})` : '';
    await addHistory('INSTRUCTION', r.id, req.ctx.userId, { action: b.brouillon ? 'CREATION_BROUILLON' : 'TRANSMISSION', nouveau: r.statut, commentaire: `${b.exceptionnelle ? 'Instruction exceptionnelle a' : 'A'}dressée à ${dest.nomComplet} (${dest.roleLibelle})${copie}` }, trx);
    return r;
  });
  await audit(req, { action: b.brouillon ? 'CREATION' : 'TRANSMISSION', module: 'instructions', entite: 'instruction', entiteId: row.id, apres: row, message: b.exceptionnelle ? `Instruction exceptionnelle — ${b.justification_exception}` : undefined });
  if (!b.brouillon) await notifierTransmission(req, row);
  return row;
}

router.post('/', requirePerm('instructions.emettre'), validate({ body: createSchema }), async (req, res) => {
  res.status(201).json(await creerInstruction(req, req.valid.body));
});

/** Notifie le destinataire et, pour une instruction exceptionnelle, le supérieur immédiat en copie. */
async function notifierTransmission(req, row) {
  await notify(row.destinataire_user_id, { type: 'INSTRUCTION', titre: `${row.exceptionnelle ? 'Instruction exceptionnelle du Directeur' : 'Nouvelle instruction'} : ${row.objet}`, message: `Réf. ${row.reference}`, lien: `/instructions/${row.id}`, expediteur: req.ctx.userId });
  if (row.copie_user_id) {
    await notify(row.copie_user_id, { type: 'INSTRUCTION', titre: `Copie — instruction exceptionnelle du Directeur : ${row.objet}`, message: `Réf. ${row.reference}. Justification : ${row.justification_exception}`, lien: `/instructions/${row.id}`, expediteur: req.ctx.userId });
  }
}

async function loadOwn(req, role) {
  const row = await loadEntity(req.ctx, 'INSTRUCTION', req.valid.params.id);
  if (role === 'emetteur' && row.emetteur_user_id !== req.ctx.userId) throw forbidden('Seul l’émetteur de l’instruction peut effectuer cette opération.');
  if (role === 'destinataire' && row.destinataire_user_id !== req.ctx.userId) throw forbidden('Seul le destinataire de l’instruction peut effectuer cette opération.');
  return row;
}

function assertStatut(row, allowed) {
  if (!allowed.includes(row.statut)) throw badRequest(`Opération impossible au statut « ${STATUT_LIBELLES[row.statut]} ».`);
}

async function transition(req, row, patch, action, commentaire, notifyTo, notifType, titre) {
  const [updated] = await db('instructions').where({ id: row.id }).update({ ...patch, updated_at: db.fn.now() }).returning('*');
  await addHistory('INSTRUCTION', row.id, req.ctx.userId, { action, ancien: row.statut, nouveau: updated.statut, avancement: updated.avancement, commentaire });
  await audit(req, { action: action.startsWith('VALID') ? 'VALIDATION' : action === 'TRANSMISSION' ? 'TRANSMISSION' : 'MODIFICATION', module: 'instructions', entite: 'instruction', entiteId: row.id, avant: { statut: row.statut, avancement: row.avancement }, apres: { statut: updated.statut, avancement: updated.avancement }, message: action });
  if (notifyTo) await notify(notifyTo, { type: notifType, titre: `${titre} — ${row.reference}`, message: commentaire || row.objet, lien: `/instructions/${row.id}`, expediteur: req.ctx.userId });
  return updated;
}

router.put('/:id', requirePerm('instructions.emettre'), validate({ params: idParam, body: createSchema.omit({ brouillon: true, parent_id: true, exceptionnelle: true }).partial() }), async (req, res) => {
  const row = await loadOwn(req, 'emetteur');
  assertStatut(row, ['BROUILLON']);
  const b = req.valid.body;
  const patch = { ...b };
  if (!row.exceptionnelle) delete patch.justification_exception;
  else if (b.justification_exception !== undefined && (!b.justification_exception || b.justification_exception.length < 10)) throw badRequest('Justifiez l’instruction exceptionnelle (10 caractères au moins).');
  if (b.destinataire_user_id) {
    const { dest, superieur } = await resoudreDestinataire(req.ctx, b.destinataire_user_id, row.exceptionnelle);
    Object.assign(patch, { destinataire_role: dest.primaryRole, division_id: dest.divisionId || null, bureau_id: dest.bureauId || null, copie_user_id: superieur ? superieur.userId : null });
  }
  const [u] = await db('instructions').where({ id: row.id }).update({ ...patch, updated_at: db.fn.now() }).returning('*');
  await audit(req, { action: 'MODIFICATION', module: 'instructions', entite: 'instruction', entiteId: row.id, avant: row, apres: u });
  res.json(u);
});

router.post('/:id/transmettre', requirePerm('instructions.emettre'), validate({ params: idParam }), async (req, res) => {
  const row = await loadOwn(req, 'emetteur');
  assertStatut(row, ['BROUILLON']);
  const { superieur } = await resoudreDestinataire(req.ctx, row.destinataire_user_id, row.exceptionnelle);
  const u = await transition(req, row, { statut: 'TRANSMISE', date_emission: db.fn.now(), copie_user_id: superieur ? superieur.userId : null }, 'TRANSMISSION', null, null);
  await notifierTransmission(req, u);
  res.json(u);
});

router.post('/:id/accuser-reception', requirePerm('instructions.executer'), validate({ params: idParam }), async (req, res) => {
  const row = await loadOwn(req, 'destinataire');
  assertStatut(row, ['TRANSMISE']);
  res.json(await transition(req, row, { statut: 'RECUE' }, 'RECEPTION', 'Accusé de réception', row.emetteur_user_id, 'INSTRUCTION_REPONSE', 'Instruction reçue'));
});

router.post('/:id/avancement', requirePerm('instructions.executer'), validate({ params: idParam, body: z.object({ avancement: z.coerce.number().int().min(0).max(99), observations: z.string().trim().max(5000).optional() }) }), async (req, res) => {
  const row = await loadOwn(req, 'destinataire');
  assertStatut(row, ACTIFS);
  const late = row.echeance && new Date(row.echeance) < new Date(new Date().toISOString().slice(0, 10));
  const b = req.valid.body;
  res.json(await transition(req, row, { statut: late ? 'EN_RETARD' : 'EN_COURS', avancement: b.avancement, observations: b.observations ?? row.observations }, 'AVANCEMENT', b.observations || `Avancement : ${b.avancement} %`, null));
});

router.post('/:id/rendre-compte', requirePerm('instructions.executer'), validate({ params: idParam, body: z.object({ reponse: z.string().trim().min(3).max(20000) }) }), async (req, res) => {
  const row = await loadOwn(req, 'destinataire');
  assertStatut(row, ACTIFS);
  res.json(await transition(req, row, { statut: 'EXECUTEE', avancement: 100, reponse: req.valid.body.reponse, date_reponse: db.fn.now() }, 'COMPTE_RENDU', req.valid.body.reponse.slice(0, 300), row.emetteur_user_id, 'INSTRUCTION_REPONSE', 'Compte rendu reçu'));
});

router.post('/:id/valider', requirePerm('instructions.valider'), validate({ params: idParam, body: z.object({ observations: z.string().trim().max(5000).optional() }) }), async (req, res) => {
  const row = await loadOwn(req, 'emetteur');
  assertStatut(row, ['EXECUTEE']);
  res.json(await transition(req, row, { statut: 'VALIDEE', observations: req.valid.body.observations ?? row.observations }, 'VALIDATION', req.valid.body.observations || 'Exécution validée', row.destinataire_user_id, 'INSTRUCTION', 'Instruction validée'));
});

router.post('/:id/retourner', requirePerm('instructions.valider'), validate({ params: idParam, body: z.object({ observations: z.string().trim().min(3).max(5000) }) }), async (req, res) => {
  const row = await loadOwn(req, 'emetteur');
  assertStatut(row, ['EXECUTEE']);
  res.json(await transition(req, row, { statut: 'A_CORRIGER', avancement: 90, observations: req.valid.body.observations }, 'RETOUR_CORRECTION', req.valid.body.observations, row.destinataire_user_id, 'INSTRUCTION', 'Instruction à corriger'));
});

router.post('/:id/cloturer', requirePerm('instructions.valider'), validate({ params: idParam }), async (req, res) => {
  const row = await loadOwn(req, 'emetteur');
  assertStatut(row, ['VALIDEE']);
  res.json(await transition(req, row, { statut: 'CLOTUREE', date_cloture: db.fn.now() }, 'CLOTURE', 'Instruction clôturée', row.destinataire_user_id, 'INSTRUCTION', 'Instruction clôturée'));
});

// ─── Blocage, rapport intermédiaire, annulation, prolongations ──────────────
const motifSchema = z.object({ motif: z.string().trim().min(3).max(5000) });
const dateSchema = z.object({ echeance: z.string().date(), motif: z.string().trim().min(3).max(5000) });

router.post('/:id/bloquer', requirePerm('instructions.executer'), validate({ params: idParam, body: motifSchema }), async (req, res) => {
  res.json(await traitement.bloquer(req, 'INSTRUCTION', await loadOwn(req, 'destinataire'), req.valid.body.motif));
});
router.post('/:id/debloquer', requirePerm('instructions.consulter'), validate({ params: idParam, body: z.object({ commentaire: z.string().trim().max(5000).optional() }) }), async (req, res) => {
  res.json(await traitement.debloquer(req, 'INSTRUCTION', await loadOwn(req), req.valid.body.commentaire));
});
router.post('/:id/rapport-intermediaire', requirePerm('instructions.executer'), validate({ params: idParam, body: z.object({ texte: z.string().trim().min(3).max(20000), avancement: z.coerce.number().int().min(0).max(99).optional() }) }), async (req, res) => {
  res.json(await traitement.rapportIntermediaire(req, 'INSTRUCTION', await loadOwn(req, 'destinataire'), req.valid.body));
});
router.post('/:id/annuler', requirePerm('instructions.emettre'), validate({ params: idParam, body: motifSchema }), async (req, res) => {
  res.json(await traitement.annuler(req, 'INSTRUCTION', await loadOwn(req, 'emetteur'), req.valid.body.motif));
});
router.post('/:id/prolongation', requirePerm('instructions.executer'), validate({ params: idParam, body: dateSchema }), async (req, res) => {
  res.status(201).json(await traitement.demanderProlongation(req, 'INSTRUCTION', await loadOwn(req, 'destinataire'), req.valid.body));
});
router.post('/:id/prolongation/decision', requirePerm('instructions.valider'), validate({ params: idParam, body: z.object({ accorder: z.boolean(), echeance: z.string().date().optional(), commentaire: z.string().trim().max(5000).optional() }) }), async (req, res) => {
  res.json(await traitement.deciderProlongation(req, 'INSTRUCTION', await loadOwn(req, 'emetteur'), req.valid.body));
});
router.post('/:id/prolonger', requirePerm('instructions.valider'), validate({ params: idParam, body: dateSchema }), async (req, res) => {
  res.json(await traitement.prolonger(req, 'INSTRUCTION', await loadOwn(req, 'emetteur'), req.valid.body));
});

router.get('/:id/pdf', requirePerm('instructions.consulter'), requirePerm('exports.generer'), validate({ params: idParam }), async (req, res) => {
  await loadEntity(req.ctx, 'INSTRUCTION', req.valid.params.id);
  const row = await baseQuery().where('i.id', req.valid.params.id).first();
  if (row.statut === 'BROUILLON' && row.emetteur_user_id !== req.ctx.userId) throw notFound();
  const hist = await getHistory('INSTRUCTION', row.id);
  await audit(req, { action: 'EXPORT', module: 'instructions', entite: 'instruction', entiteId: row.id, message: 'Fiche PDF' });
  const { doc, finish } = pdf.createPdf(res, { filename: `instruction-${row.id}.pdf`, titre: 'FICHE D’INSTRUCTION', sousTitre: row.reference, reference: row.reference });
  pdf.keyValues(doc, [
    ['Émetteur', `${row.emetteur_nom} — ${ROLE_LIBELLES[row.emetteur_role]}`],
    ['Destinataire', `${row.destinataire_nom} — ${ROLE_LIBELLES[row.destinataire_role]}`],
    ...(row.exceptionnelle ? [['Instruction exceptionnelle', row.justification_exception], ['Copie', row.copie_nom || '—']] : []),
    ['Objet', row.objet], ['Priorité', row.priorite], ['Date d’émission', pdf.fmtDateTime(row.date_emission)],
    ['Échéance', pdf.fmtDate(row.echeance)], ['Statut', STATUT_LIBELLES[row.statut]], ['Avancement', `${row.avancement} %`],
    ['Date de clôture', pdf.fmtDateTime(row.date_cloture)],
    ...(row.echeance_initiale ? [['Échéance initiale', pdf.fmtDate(row.echeance_initiale)]] : []),
    ...(row.statut === 'ANNULEE' ? [['Motif d’annulation', row.motif_annulation]] : []),
  ]);
  pdf.section(doc, 'Contenu', row.contenu);
  pdf.section(doc, 'Observations', row.observations);
  pdf.section(doc, 'Réponse / compte rendu', row.reponse);
  pdf.table(doc, [
    { header: 'Date', value: (h) => pdf.fmtDateTime(h.created_at), width: 2 },
    { header: 'Auteur', value: (h) => h.auteur || h.username || 'Système', width: 2 },
    { header: 'Action', key: 'action', width: 2 },
    { header: 'Statut', value: (h) => STATUT_LIBELLES[h.nouveau_statut] || '', width: 1.5 },
    { header: 'Commentaire', key: 'commentaire', width: 4 },
  ], hist);
  return finish();
});

module.exports = router;
module.exports.STATUT_LIBELLES = STATUT_LIBELLES;
module.exports.creerInstruction = creerInstruction;

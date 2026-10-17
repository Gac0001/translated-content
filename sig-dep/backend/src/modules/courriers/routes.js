'use strict';
/**
 * Courriers entrants et sortants : enregistrement, transmissions hiérarchiques horodatées,
 * accusés de réception, annotations, historique de circulation, classement et archivage.
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
const { scopeCourriers, loadEntity } = require('../../services/access');
const pdf = require('../../services/pdf');
const { sendWorkbook } = require('../../services/excel');
const { notFound, badRequest, forbidden } = require('../../utils/errors');

const router = express.Router();
const idParam = z.object({ id: z.coerce.number().int().positive() });
const URGENCES = ['NORMAL', 'URGENT', 'TRES_URGENT'];
const CONFID = ['ORDINAIRE', 'CONFIDENTIEL', 'SECRET'];
const STATUTS = ['ENREGISTRE', 'EN_CIRCULATION', 'TRAITE', 'CLASSE', 'ARCHIVE'];
const LIB = {
  ENREGISTRE: 'Enregistré', EN_CIRCULATION: 'En circulation', TRAITE: 'Traité', CLASSE: 'Classé', ARCHIVE: 'Archivé',
  NORMAL: 'Normal', URGENT: 'Urgent', TRES_URGENT: 'Très urgent', ORDINAIRE: 'Ordinaire', CONFIDENTIEL: 'Confidentiel', SECRET: 'Secret',
  ENTRANT: 'Entrant', SORTANT: 'Sortant',
};

function baseQuery() {
  return db('courriers as c').leftJoin('users as h', 'h.id', 'c.detenteur_user_id').leftJoin('agents as ha', 'ha.id', 'h.agent_id')
    .select('c.*', db.raw(`concat_ws(' ', ha.prenom, ha.nom) as detenteur_nom`));
}

const listQuery = z.object({
  sens: z.enum(['ENTRANT', 'SORTANT']).optional(), statut: z.enum(STATUTS).optional(), urgence: z.enum(URGENCES).optional(),
  confidentialite: z.enum(CONFID).optional(), q: z.string().trim().max(100).optional(),
  du: z.string().date().optional(), au: z.string().date().optional(), a_recevoir: z.enum(['true', 'false']).optional(),
});

function listed(req) {
  const f = req.valid.query;
  const q = scopeCourriers(baseQuery(), req.ctx).orderBy('c.date_enregistrement', 'desc').orderBy('c.id', 'desc');
  if (f.sens) q.where('c.sens', f.sens);
  if (f.statut) q.where('c.statut', f.statut); else q.whereNot('c.statut', 'ARCHIVE');
  if (f.urgence) q.where('c.urgence', f.urgence);
  if (f.confidentialite) q.where('c.confidentialite', f.confidentialite);
  if (f.du) q.where('c.date_courrier', '>=', f.du);
  if (f.au) q.where('c.date_courrier', '<=', f.au);
  if (f.q) q.where((w) => w.whereILike('c.objet', `%${f.q}%`).orWhereILike('c.numero_enregistrement', `%${f.q}%`).orWhereILike('c.expediteur', `%${f.q}%`).orWhereILike('c.destinataire', `%${f.q}%`));
  if (f.a_recevoir === 'true') q.whereExists(db('courrier_transmissions as t').whereRaw('t.courrier_id = c.id').where({ 't.to_user_id': req.ctx.userId, 't.etat_reception': 'EN_ATTENTE' }));
  return q;
}

router.get('/', requirePerm('courriers.consulter'), validate({ query: listQuery }), async (req, res) => {
  res.json({ data: await listed(req).limit(500) });
});

router.get('/contacts', requirePerm('courriers.transmettre', 'dossiers.transmettre'), async (req, res) => {
  res.json({ data: await directContacts(req.ctx) });
});

router.get('/export/:format', requirePerm('courriers.consulter'), requirePerm('exports.generer'), validate({ params: z.object({ format: z.enum(['pdf', 'xlsx']) }), query: listQuery }), async (req, res) => {
  const rows = await listed(req);
  const columns = [
    { header: 'N° d’enregistrement', key: 'numero_enregistrement', width: 18 }, { header: 'Sens', value: (r) => LIB[r.sens], width: 9 },
    { header: 'Date', value: (r) => pdf.fmtDate(r.date_courrier), width: 11 }, { header: 'Expéditeur', key: 'expediteur', width: 24 },
    { header: 'Destinataire', key: 'destinataire', width: 24 }, { header: 'Objet', key: 'objet', width: 36 },
    { header: 'Urgence', value: (r) => LIB[r.urgence], width: 10 }, { header: 'Confidentialité', value: (r) => LIB[r.confidentialite], width: 12 },
    { header: 'Statut', value: (r) => LIB[r.statut], width: 12 }, { header: 'Classement', key: 'classement', width: 14 },
  ];
  await audit(req, { action: 'EXPORT', module: 'courriers', message: `Registre des courriers (${req.valid.params.format})` });
  if (req.valid.params.format === 'xlsx') return sendWorkbook(res, 'registre-courriers-DEP.xlsx', [{ name: 'Registre', titre: 'Registre des courriers', columns, rows }]);
  const { doc, finish } = pdf.createPdf(res, { filename: 'registre-courriers-DEP.pdf', titre: 'Registre des courriers', landscape: true });
  pdf.table(doc, columns, rows, { fontSize: 7.5 });
  return finish();
});

async function detail(ctx, id) {
  await loadEntity(ctx, 'COURRIER', id);
  const c = await baseQuery().where('c.id', id).first();
  const [transmissions, annotations, pieces, historique, instructions] = await Promise.all([
    db('courrier_transmissions as t')
      .join('users as f', 'f.id', 't.from_user_id').leftJoin('agents as fa', 'fa.id', 'f.agent_id')
      .join('users as d', 'd.id', 't.to_user_id').leftJoin('agents as da', 'da.id', 'd.agent_id')
      .where('t.courrier_id', id).orderBy('t.created_at', 'asc')
      .select('t.*', db.raw(`concat_ws(' ', fa.prenom, fa.nom) as emetteur_nom`), db.raw(`concat_ws(' ', da.prenom, da.nom) as destinataire_nom`)),
    db('courrier_annotations as a').join('users as u', 'u.id', 'a.user_id').leftJoin('agents as ag', 'ag.id', 'u.agent_id')
      .where('a.courrier_id', id).orderBy('a.created_at').select('a.*', db.raw(`concat_ws(' ', ag.prenom, ag.nom) as auteur`)),
    db('attachments').where({ entity_type: 'COURRIER', entity_id: id }).whereNull('deleted_at'),
    getHistory('COURRIER', id),
    db('instructions').where({ courrier_id: id }).select('id', 'reference', 'objet', 'statut'),
  ]);
  return { ...c, transmissions, annotations, pieces, historique, instructions };
}

router.get('/:id', requirePerm('courriers.consulter'), validate({ params: idParam }), async (req, res) => {
  const d = await detail(req.ctx, req.valid.params.id);
  const estDetenteur = d.detenteur_user_id === req.ctx.userId;
  const registrar = req.ctx.can('courriers.enregistrer');
  res.json({
    ...d,
    actions: {
      modifier: registrar && d.statut === 'ENREGISTRE' && (d.created_by === req.ctx.userId || req.ctx.perimetre === 'DIRECTION'),
      transmettre: (estDetenteur || (registrar && d.statut === 'ENREGISTRE')) && !['CLASSE', 'ARCHIVE'].includes(d.statut) && (req.ctx.can('courriers.transmettre') || req.ctx.can('dossiers.transmettre')),
      annoter: req.ctx.can('courriers.annoter') && req.ctx.perimetre !== 'SUPERVISION_GLOBALE',
      traiter: estDetenteur && ['EN_CIRCULATION', 'ENREGISTRE'].includes(d.statut) && req.ctx.perimetre !== 'SUPERVISION_GLOBALE',
      classer: (req.ctx.can('courriers.classer') || registrar) && ['TRAITE', 'ENREGISTRE', 'EN_CIRCULATION'].includes(d.statut),
      archiver: req.ctx.can('courriers.classer') && d.statut === 'CLASSE',
      accuserReception: d.transmissions.filter((t) => t.to_user_id === req.ctx.userId && t.etat_reception === 'EN_ATTENTE').map((t) => t.id),
    },
  });
});

const courrierSchema = z.object({
  sens: z.enum(['ENTRANT', 'SORTANT']),
  reference_externe: z.string().trim().max(120).optional().nullable(),
  expediteur: z.string().trim().min(2).max(250),
  destinataire: z.string().trim().min(2).max(250),
  objet: z.string().trim().min(3).max(500),
  date_courrier: z.string().date(),
  urgence: z.enum(URGENCES).default('NORMAL'),
  confidentialite: z.enum(CONFID).default('ORDINAIRE'),
  resume: z.string().trim().max(10000).optional().nullable(),
  classement: z.string().trim().max(120).optional().nullable(),
});

router.post('/', requirePerm('courriers.enregistrer'), validate({ body: courrierSchema }), async (req, res) => {
  const b = req.valid.body;
  const dep = await db('directions').where({ code: 'DEP' }).first();
  const row = await db.transaction(async (trx) => {
    const numero = await nextReference(b.sens === 'ENTRANT' ? 'CE' : 'CS', b.sens === 'ENTRANT' ? 'DEP/CE' : 'DEP/CS', trx);
    const [c] = await trx('courriers').insert({
      ...b, numero_enregistrement: numero, direction_id: dep.id, division_id: req.ctx.divisionId, bureau_id: req.ctx.bureauId,
      detenteur_user_id: req.ctx.userId, created_by: req.ctx.userId, statut: 'ENREGISTRE',
    }).returning('*');
    await addHistory('COURRIER', c.id, req.ctx.userId, { action: 'ENREGISTREMENT', nouveau: 'ENREGISTRE', commentaire: `Courrier ${LIB[b.sens].toLowerCase()} n° ${numero}` }, trx);
    return c;
  });
  await audit(req, { action: 'CREATION', module: 'courriers', entite: 'courrier', entiteId: row.id, apres: row });
  res.status(201).json(row);
});

router.put('/:id', requirePerm('courriers.enregistrer'), validate({ params: idParam, body: courrierSchema.omit({ sens: true }).partial() }), async (req, res) => {
  const c = await loadEntity(req.ctx, 'COURRIER', req.valid.params.id);
  if (c.statut !== 'ENREGISTRE') throw badRequest('Un courrier déjà mis en circulation ne peut plus être modifié ; ajoutez une annotation.');
  if (c.created_by !== req.ctx.userId && req.ctx.perimetre !== 'DIRECTION') throw forbidden();
  const [u] = await db('courriers').where({ id: c.id }).update({ ...req.valid.body, updated_at: db.fn.now() }).returning('*');
  await audit(req, { action: 'MODIFICATION', module: 'courriers', entite: 'courrier', entiteId: c.id, avant: c, apres: u });
  res.json(u);
});

router.post('/:id/transmettre', requirePerm('courriers.transmettre', 'dossiers.transmettre'), validate({ params: idParam, body: z.object({ to_user_id: z.coerce.number().int().positive(), observations: z.string().trim().max(3000).optional().nullable() }) }), async (req, res) => {
  const c = await loadEntity(req.ctx, 'COURRIER', req.valid.params.id);
  if (['CLASSE', 'ARCHIVE'].includes(c.statut)) throw badRequest('Courrier classé ou archivé : transmission impossible.');
  const registrar = req.ctx.can('courriers.enregistrer') && c.statut === 'ENREGISTRE';
  if (c.detenteur_user_id !== req.ctx.userId && !registrar) throw forbidden('Seul le détenteur actuel du courrier peut le transmettre.');
  const me = ctxNode(req.ctx);
  const all = await loadAllNodes();
  const dest = all.find((n) => n.userId === req.valid.body.to_user_id);
  const sens = dest && dest.node ? relation(me, dest.node) : null;
  if (!sens) throw forbidden('Transmission contraire à la chaîne hiérarchique : un courrier ne circule qu’entre supérieur et subordonné directs.', 'CHAINE_HIERARCHIQUE');
  const t = await db.transaction(async (trx) => {
    const [tr] = await trx('courrier_transmissions').insert({
      courrier_id: c.id, from_user_id: req.ctx.userId, to_user_id: dest.userId, sens_hierarchique: sens,
      to_division_id: dest.divisionId || null, to_bureau_id: dest.bureauId || null, observations: req.valid.body.observations,
    }).returning('*');
    await trx('courriers').where({ id: c.id }).update({ detenteur_user_id: dest.userId, statut: 'EN_CIRCULATION', updated_at: trx.fn.now() });
    await addHistory('COURRIER', c.id, req.ctx.userId, { action: 'TRANSMISSION', ancien: c.statut, nouveau: 'EN_CIRCULATION', commentaire: `Transmis à ${dest.nomComplet} (${dest.roleLibelle})${req.valid.body.observations ? ` — ${req.valid.body.observations}` : ''}` }, trx);
    return tr;
  });
  await audit(req, { action: 'TRANSMISSION', module: 'courriers', entite: 'courrier', entiteId: c.id, apres: t });
  await notify(dest.userId, { type: 'COURRIER', titre: `Courrier transmis : ${c.numero_enregistrement}`, message: c.objet, lien: `/courriers/${c.id}`, expediteur: req.ctx.userId, confidentiel: c.confidentialite !== 'ORDINAIRE' });
  res.status(201).json(t);
});

router.post('/transmissions/:id/accuser-reception', requirePerm('courriers.consulter'), validate({ params: idParam, body: z.object({ observation_reception: z.string().trim().max(2000).optional().nullable() }) }), async (req, res) => {
  const t = await db('courrier_transmissions').where({ id: req.valid.params.id }).first();
  if (!t) throw notFound('Transmission introuvable.');
  if (t.to_user_id !== req.ctx.userId) throw forbidden('Seul le destinataire peut accuser réception.');
  if (t.etat_reception === 'RECU') throw badRequest('Réception déjà confirmée.');
  await db('courrier_transmissions').where({ id: t.id }).update({ etat_reception: 'RECU', recu_at: db.fn.now(), observation_reception: req.valid.body.observation_reception });
  await addHistory('COURRIER', t.courrier_id, req.ctx.userId, { action: 'ACCUSE_RECEPTION', commentaire: req.valid.body.observation_reception || 'Réception confirmée' });
  await audit(req, { action: 'MODIFICATION', module: 'courriers', entite: 'courrier_transmission', entiteId: t.id, message: 'Accusé de réception' });
  await notify(t.from_user_id, { type: 'COURRIER', titre: 'Accusé de réception d’un courrier', lien: `/courriers/${t.courrier_id}`, expediteur: req.ctx.userId });
  res.json({ message: 'Réception confirmée.' });
});

router.post('/:id/annoter', requirePerm('courriers.annoter'), validate({ params: idParam, body: z.object({ texte: z.string().trim().min(2).max(3000) }) }), async (req, res) => {
  const c = await loadEntity(req.ctx, 'COURRIER', req.valid.params.id);
  const [a] = await db('courrier_annotations').insert({ courrier_id: c.id, user_id: req.ctx.userId, texte: req.valid.body.texte }).returning('*');
  await addHistory('COURRIER', c.id, req.ctx.userId, { action: 'ANNOTATION', commentaire: req.valid.body.texte });
  await audit(req, { action: 'CREATION', module: 'courriers', entite: 'annotation', entiteId: a.id, apres: a });
  res.status(201).json(a);
});

async function setStatut(req, c, statut, patch = {}, action = statut) {
  const [u] = await db('courriers').where({ id: c.id }).update({ statut, ...patch, updated_at: db.fn.now() }).returning('*');
  await addHistory('COURRIER', c.id, req.ctx.userId, { action, ancien: c.statut, nouveau: statut, commentaire: patch.classement ? `Classement : ${patch.classement}` : null });
  await audit(req, { action: statut === 'ARCHIVE' ? 'ARCHIVAGE' : 'MODIFICATION', module: 'courriers', entite: 'courrier', entiteId: c.id, avant: { statut: c.statut }, apres: { statut, ...patch } });
  return u;
}

router.post('/:id/traiter', requirePerm('courriers.consulter'), validate({ params: idParam }), async (req, res) => {
  const c = await loadEntity(req.ctx, 'COURRIER', req.valid.params.id, 'write');
  if (c.detenteur_user_id !== req.ctx.userId) throw forbidden('Seul le détenteur peut marquer le courrier comme traité.');
  if (!['EN_CIRCULATION', 'ENREGISTRE'].includes(c.statut)) throw badRequest('Statut incompatible.');
  res.json(await setStatut(req, c, 'TRAITE', {}, 'TRAITEMENT'));
});

router.post('/:id/classer', validate({ params: idParam, body: z.object({ classement: z.string().trim().min(1).max(120) }) }), async (req, res) => {
  if (!req.ctx.can('courriers.classer') && !req.ctx.can('courriers.enregistrer')) throw forbidden();
  const c = await loadEntity(req.ctx, 'COURRIER', req.valid.params.id);
  if (['CLASSE', 'ARCHIVE'].includes(c.statut)) throw badRequest('Courrier déjà classé.');
  res.json(await setStatut(req, c, 'CLASSE', { classement: req.valid.body.classement }, 'CLASSEMENT'));
});

router.post('/:id/archiver', requirePerm('courriers.classer'), validate({ params: idParam }), async (req, res) => {
  const c = await loadEntity(req.ctx, 'COURRIER', req.valid.params.id);
  if (c.statut !== 'CLASSE') throw badRequest('Seul un courrier classé peut être archivé.');
  res.json(await setStatut(req, c, 'ARCHIVE', { archived_at: db.fn.now() }, 'ARCHIVAGE'));
});

router.get('/:id/fiche', requirePerm('courriers.consulter'), requirePerm('exports.generer'), validate({ params: idParam }), async (req, res) => {
  const d = await detail(req.ctx, req.valid.params.id);
  await audit(req, { action: 'EXPORT', module: 'courriers', entite: 'courrier', entiteId: d.id, message: 'Fiche de circulation PDF' });
  const { doc, finish } = pdf.createPdf(res, { filename: `courrier-${d.id}.pdf`, titre: `FICHE DE CIRCULATION — COURRIER ${LIB[d.sens].toUpperCase()}`, sousTitre: d.numero_enregistrement, reference: d.numero_enregistrement });
  pdf.keyValues(doc, [
    ['N° d’enregistrement', d.numero_enregistrement], ['Référence externe', d.reference_externe], ['Date du courrier', pdf.fmtDate(d.date_courrier)],
    ['Date d’enregistrement', pdf.fmtDate(d.date_enregistrement)], ['Expéditeur', d.expediteur], ['Destinataire', d.destinataire], ['Objet', d.objet],
    ['Degré d’urgence', LIB[d.urgence]], ['Confidentialité', LIB[d.confidentialite]], ['Statut', LIB[d.statut]], ['Classement', d.classement],
  ]);
  if (d.resume) pdf.section(doc, 'Résumé', d.resume);
  doc.font('Helvetica-Bold').fontSize(10.5).fillColor(pdf.BLUE).text('Transmissions').fillColor('#000').moveDown(0.3);
  pdf.table(doc, [
    { header: 'Date et heure', value: (t) => pdf.fmtDateTime(t.created_at), width: 2 }, { header: 'Émetteur', key: 'emetteur_nom', width: 2.2 },
    { header: 'Destinataire', key: 'destinataire_nom', width: 2.2 }, { header: 'Réception', value: (t) => (t.etat_reception === 'RECU' ? `Reçu le ${pdf.fmtDateTime(t.recu_at)}` : 'En attente'), width: 2.2 },
    { header: 'Observations', key: 'observations', width: 3 },
  ], d.transmissions);
  if (d.annotations.length) {
    doc.font('Helvetica-Bold').fontSize(10.5).fillColor(pdf.BLUE).text('Annotations').fillColor('#000').moveDown(0.3);
    pdf.table(doc, [{ header: 'Date', value: (a) => pdf.fmtDateTime(a.created_at), width: 2 }, { header: 'Auteur', key: 'auteur', width: 2 }, { header: 'Annotation', key: 'texte', width: 6 }], d.annotations);
  }
  return finish();
});

module.exports = router;

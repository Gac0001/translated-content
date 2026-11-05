'use strict';
/**
 * Collecte auprès des services du Secrétariat Général (cahier, § 36).
 * Campagne préparée par le Bureau organisateur (Bureau Programme : PTBA, cadre de performance,
 * dépenses d’investissement ; Bureau Suivi-Évaluation : plan d’actions, rapport d’activités, fiche
 * PNSD), ouverte et clôturée par le Chef de la Division Programme et Suivi. Les agents du Bureau
 * organisateur génèrent les modèles et importent les retours ; son Chef les intègre ou les rejette.
 */
const express = require('express');
const fs = require('fs');
const { z } = require('zod');
const db = require('../../db/knex');
const validate = require('../../middleware/validate');
const { requirePerm } = require('../../middleware/auth');
const { audit } = require('../../services/audit');
const { notify } = require('../../services/notifications');
const { addHistory, getHistory } = require('../../services/history');
const { nextReference } = require('../../services/sequence');
const { loadAllNodes } = require('../../services/hierarchy');
const { makeUpload, sha256File, removeQuiet } = require('../../services/files');
const collectes = require('../../services/collectes');
const lettres = require('../../services/collecteLettres');
const { sendWorkbook } = require('../../services/excel');
const { ctxNode } = require('../../services/hierarchy');
const { badRequest, forbidden, notFound, conflict } = require('../../utils/errors');

const router = express.Router();
const upload = makeUpload();
const idParam = z.object({ id: z.coerce.number().int().positive() });
const serviceParams = z.object({ id: z.coerce.number().int().positive(), sid: z.coerce.number().int().positive() });
const iso = (d) => (d instanceof Date ? new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Kinshasa' }).format(d) : d ? String(d).slice(0, 10) : null);
const aujourdhui = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Kinshasa' }).format(new Date());
const BUREAUX = { programme: 'BUR-PRG', suivi: 'BUR-SEV' };

const bureauDe = (objet) => collectes.OBJETS[objet].bureau;
const peutPreparer = (ctx, objet) => ctx.can(`collecte.${bureauDe(objet)}`) || ctx.can('collecte.ouvrir');
const peutDecider = (ctx, objet) => ctx.can(`collecte.decider.${bureauDe(objet)}`) || ctx.can('collecte.ouvrir');

function droits(ctx, c) {
  const prep = peutPreparer(ctx, c.objet);
  return {
    modifier: prep && c.statut === 'PREPARATION',
    ouvrir: ctx.can('collecte.ouvrir') && c.statut === 'PREPARATION',
    cloturer: ctx.can('collecte.ouvrir') && c.statut === 'OUVERTE',
    modeles: prep && c.statut !== 'CLOTUREE',
    importer: prep && c.statut === 'OUVERTE',
    decider: peutDecider(ctx, c.objet) && c.statut === 'OUVERTE',
    // Lettres d’envoi et de relance : brouillons de correspondance préparés par le Bureau organisateur
    lettres: prep && c.statut !== 'CLOTUREE' && ctx.can('documents.rediger') && !!ctxNode(ctx),
  };
}

async function charger(ctx, id) {
  const c = await db('collectes').where({ id }).first();
  if (!c) throw notFound('Campagne introuvable.');
  if (ctx.perimetre === 'SUPERVISION_GLOBALE') throw forbidden('Les campagnes de collecte sont internes à la Direction.', 'HORS_PERIMETRE');
  return c;
}
const presenter = (c) => ({ ...c, echeance: iso(c.echeance), objet_libelle: collectes.OBJETS[c.objet].libelle });

async function comptesBureau(code) {
  const b = await db('bureaux').where({ code }).first('id');
  return b ? (await loadAllNodes()).filter((n) => n.node && n.bureauId === b.id).map((n) => n.userId) : [];
}
async function chefsDivisionPs() {
  const d = await db('divisions').where({ code: 'DIV-PS' }).first('id');
  return d ? (await loadAllNodes()).filter((n) => n.node && n.divisionId === d.id && !n.bureauId && n.primaryRole === 'CHEF_DIVISION').map((n) => n.userId) : [];
}

/** Services de la campagne avec leur dernière réception. */
async function services(c) {
  const rows = await db('collecte_services as cs').join('plan_services as s', 's.id', 'cs.service_id').where('cs.collecte_id', c.id)
    .orderBy(['s.ordre', 's.sigle']).select('cs.*', 's.sigle', 's.libelle', 's.programme_id');
  const recs = rows.length ? await db('collecte_receptions as r').leftJoin('users as u', 'u.id', 'r.recu_par').leftJoin('agents as a', 'a.id', 'u.agent_id')
    .whereIn('r.collecte_service_id', rows.map((r) => r.id)).orderBy('r.version', 'desc')
    .select('r.id', 'r.collecte_service_id', 'r.version', 'r.attachment_id', 'r.fichier', 'r.anomalies', 'r.erreurs', 'r.alertes', 'r.total', 'r.recu_at', db.raw(`concat_ws(' ', a.prenom, a.nom) as recu_par_nom`), db.raw('jsonb_array_length(r.donnees) as lignes')) : [];
  const relances = rows.length ? await db('collecte_lettres').where({ collecte_id: c.id, type: 'RELANCE' }).orderBy('created_at') : [];
  const retard = (r) => (['ATTENDU', 'EN_RETARD'].includes(r.statut) && iso(c.echeance) < aujourdhui()
    ? Math.round((Date.parse(aujourdhui()) - Date.parse(iso(c.echeance))) / 86400000) : 0);
  return rows.map((r) => {
    const receptions = recs.filter((x) => x.collecte_service_id === r.id).map((x) => ({ ...x, total: x.total === null ? null : Number(x.total) }));
    const rel = relances.filter((l) => (l.services || []).includes(r.id));
    return { ...r, receptions, derniere: receptions[0] || null, jours_retard: retard(r), relances: rel.length, derniere_relance: rel.length ? rel[rel.length - 1].created_at : null };
  });
}

/** Lettres de la campagne, avec l’état de leur document (brouillon, en circuit, signée et numérotée). */
async function lettresDe(c) {
  return db('collecte_lettres as l').join('documents as d', 'd.id', 'l.document_id').leftJoin('users as u', 'u.id', 'l.created_by').leftJoin('agents as a', 'a.id', 'u.agent_id')
    .where('l.collecte_id', c.id).orderBy('l.created_at')
    .select('l.id', 'l.type', 'l.services', 'l.created_at', 'd.id as document_id', 'd.reference', 'd.titre', 'd.statut', 'd.numero_officiel', 'd.numerote_at', db.raw(`concat_ws(' ', a.prenom, a.nom) as prepare_par`));
}

function resume(liste) {
  const n = (s) => liste.filter((x) => x.statut === s).length;
  return { total: liste.length, attendus: n('ATTENDU'), recus: n('RECU') + n('CORRIGE'), rejetes: n('REJETE'), integres: n('INTEGRE'), en_retard: n('EN_RETARD'), retour: liste.length ? Math.round((liste.filter((x) => x.receptions.length).length / liste.length) * 100) : 0 };
}

/** Passage en retard : services sans retour d’une campagne ouverte dont l’échéance est dépassée (tâche quotidienne). */
async function marquerRetards() {
  const ids = await db('collecte_services as cs').join('collectes as c', 'c.id', 'cs.collecte_id')
    .where('c.statut', 'OUVERTE').where('c.echeance', '<', aujourdhui()).where('cs.statut', 'ATTENDU').pluck('cs.id');
  if (!ids.length) return 0;
  await db('collecte_services').whereIn('id', ids).update({ statut: 'EN_RETARD', updated_at: db.fn.now() });
  // Le Bureau organisateur est invité à préparer une lettre de relance
  const parCampagne = await db('collecte_services as cs').join('collectes as c', 'c.id', 'cs.collecte_id').join('plan_services as s', 's.id', 'cs.service_id')
    .whereIn('cs.id', ids).select('c.id', 'c.reference', 'c.titre', 'c.objet', 's.sigle');
  for (const cid of [...new Set(parCampagne.map((x) => x.id))]) {
    const l = parCampagne.filter((x) => x.id === cid);
    await notify(await comptesBureau(BUREAUX[bureauDe(l[0].objet)]), { type: 'COLLECTE', titre: `Services en retard : ${l.map((x) => x.sigle).join(', ')}`, message: `${l[0].reference} — ${l[0].titre} : échéance dépassée, préparez une lettre de relance.`, lien: `/collectes/${cid}` });
  }
  return ids.length;
}

// ─── Campagnes ──────────────────────────────────────────────────────────────
router.get('/', requirePerm('planification.consulter'), async (req, res) => {
  if (req.ctx.perimetre === 'SUPERVISION_GLOBALE') return res.json({ data: [], droits: { creer: [] } });
  const rows = await db('collectes as c').orderBy('c.created_at', 'desc').select('c.*',
    db.raw('(SELECT count(*)::int FROM collecte_services s WHERE s.collecte_id = c.id) as services'),
    db.raw(`(SELECT count(*)::int FROM collecte_services s WHERE s.collecte_id = c.id AND s.statut <> 'ATTENDU' AND s.statut <> 'EN_RETARD') as retours`),
    db.raw(`(SELECT count(*)::int FROM collecte_services s WHERE s.collecte_id = c.id AND s.statut = 'INTEGRE') as integres`),
    db.raw(`(SELECT count(*)::int FROM collecte_services s WHERE s.collecte_id = c.id AND s.statut = 'EN_RETARD') as en_retard`));
  res.json({
    data: rows.map(presenter),
    objets: Object.entries(collectes.OBJETS).map(([code, o]) => ({ code, libelle: o.libelle, disponible: true })),
    droits: { creer: Object.keys(collectes.OBJETS).filter((o) => peutPreparer(req.ctx, o)) },
  });
});

const campagneSchema = z.object({
  objet: z.enum(Object.keys(collectes.OBJETS)), annee: z.coerce.number().int().min(2000).max(2100), titre: z.string().trim().min(5).max(300),
  echeance: z.string().date(), instructions: z.string().trim().max(5000).optional().nullable(),
  services: z.array(z.coerce.number().int().positive()).min(1).max(100),
});

router.post('/', requirePerm('planification.consulter'), validate({ body: campagneSchema }), async (req, res) => {
  const b = req.valid.body;
  if (!peutPreparer(req.ctx, b.objet)) throw forbidden(`Les campagnes « ${collectes.OBJETS[b.objet].libelle} » sont préparées par le ${bureauDe(b.objet) === 'programme' ? 'Bureau Programme' : 'Bureau Suivi-Évaluation'}.`);
  const ids = [...new Set(b.services)];
  if ((await db('plan_services').whereIn('id', ids).where({ actif: true })).length !== ids.length) throw badRequest('Service inconnu ou inactif.');
  const c = await db.transaction(async (trx) => {
    const [x] = await trx('collectes').insert({
      reference: await nextReference('COLLECTE', 'DEP/COL', trx), objet: b.objet, annee: b.annee, titre: b.titre, echeance: b.echeance,
      instructions: b.instructions || null, created_by: req.ctx.userId,
    }).returning('*');
    await trx('collecte_services').insert(ids.map((service_id) => ({ collecte_id: x.id, service_id })));
    await addHistory('COLLECTE', x.id, req.ctx.userId, { action: 'CREATION', nouveau: 'PREPARATION', commentaire: `${ids.length} service(s) ciblé(s)` }, trx);
    return x;
  });
  await audit(req, { action: 'CREATION', module: 'planification', entite: 'collecte', entiteId: c.id, apres: { reference: c.reference, objet: c.objet, annee: c.annee } });
  res.status(201).json(presenter(c));
});

router.get('/:id', requirePerm('planification.consulter'), validate({ params: idParam }), async (req, res) => {
  const c = await charger(req.ctx, req.valid.params.id);
  const liste = await services(c);
  res.json({ ...presenter(c), services: liste, resume: resume(liste), lettres: await lettresDe(c), historique: await getHistory('COLLECTE', c.id), droits: droits(req.ctx, c) });
});

router.put('/:id', requirePerm('planification.consulter'), validate({ params: idParam, body: campagneSchema.omit({ objet: true }) }), async (req, res) => {
  const c = await charger(req.ctx, req.valid.params.id);
  if (!droits(req.ctx, c).modifier) throw forbidden('Seule une campagne en préparation se modifie, par le Bureau organisateur.');
  const b = req.valid.body;
  const ids = [...new Set(b.services)];
  if ((await db('plan_services').whereIn('id', ids).where({ actif: true })).length !== ids.length) throw badRequest('Service inconnu ou inactif.');
  await db.transaction(async (trx) => {
    await trx('collectes').where({ id: c.id }).update({ annee: b.annee, titre: b.titre, echeance: b.echeance, instructions: b.instructions || null, updated_at: trx.fn.now() });
    await trx('collecte_services').where({ collecte_id: c.id }).whereNotIn('service_id', ids).del();
    const deja = await trx('collecte_services').where({ collecte_id: c.id }).pluck('service_id');
    const nouveaux = ids.filter((x) => !deja.includes(x));
    if (nouveaux.length) await trx('collecte_services').insert(nouveaux.map((service_id) => ({ collecte_id: c.id, service_id })));
    await addHistory('COLLECTE', c.id, req.ctx.userId, { action: 'MODIFICATION', commentaire: `${ids.length} service(s) ciblé(s)` }, trx);
  });
  await audit(req, { action: 'MODIFICATION', module: 'planification', entite: 'collecte', entiteId: c.id });
  res.json(presenter(await db('collectes').where({ id: c.id }).first()));
});

router.post('/:id/ouvrir', requirePerm('planification.consulter'), validate({ params: idParam }), async (req, res) => {
  const c = await charger(req.ctx, req.valid.params.id);
  if (!droits(req.ctx, c).ouvrir) throw forbidden('La campagne est ouverte par le Chef de la Division Programme et Suivi.');
  if (c.echeance && iso(c.echeance) < aujourdhui()) throw badRequest('L’échéance est déjà passée : modifiez-la avant d’ouvrir la campagne.');
  const [u] = await db('collectes').where({ id: c.id }).update({ statut: 'OUVERTE', ouverte_par: req.ctx.userId, ouverte_at: db.fn.now(), updated_at: db.fn.now() }).returning('*');
  await addHistory('COLLECTE', c.id, req.ctx.userId, { action: 'OUVERTURE', ancien: c.statut, nouveau: 'OUVERTE' });
  await audit(req, { action: 'MODIFICATION', module: 'planification', entite: 'collecte', entiteId: c.id, message: `Campagne ${c.reference} ouverte` });
  await notify(await comptesBureau(BUREAUX[bureauDe(c.objet)]), { type: 'COLLECTE', titre: `Campagne de collecte ouverte : ${c.titre}`, message: `${c.reference} — modèles à transmettre aux services, échéance le ${iso(c.echeance)}`, lien: `/collectes/${c.id}`, expediteur: req.ctx.userId });
  res.json(presenter(u));
});

router.post('/:id/cloturer', requirePerm('planification.consulter'), validate({ params: idParam }), async (req, res) => {
  const c = await charger(req.ctx, req.valid.params.id);
  if (!droits(req.ctx, c).cloturer) throw forbidden('La campagne est clôturée par le Chef de la Division Programme et Suivi.');
  const [u] = await db('collectes').where({ id: c.id }).update({ statut: 'CLOTUREE', cloturee_par: req.ctx.userId, cloturee_at: db.fn.now(), updated_at: db.fn.now() }).returning('*');
  const r = resume(await services(c));
  await addHistory('COLLECTE', c.id, req.ctx.userId, { action: 'CLOTURE', ancien: c.statut, nouveau: 'CLOTUREE', commentaire: `${r.integres} service(s) intégré(s) sur ${r.total}` });
  await audit(req, { action: 'MODIFICATION', module: 'planification', entite: 'collecte', entiteId: c.id, message: `Campagne ${c.reference} clôturée` });
  res.json(presenter(u));
});

router.delete('/:id', requirePerm('planification.consulter'), validate({ params: idParam }), async (req, res) => {
  const c = await charger(req.ctx, req.valid.params.id);
  if (!droits(req.ctx, c).modifier) throw forbidden('Seule une campagne en préparation se supprime.');
  await db('collectes').where({ id: c.id }).del();
  await audit(req, { action: 'SUPPRESSION', module: 'planification', entite: 'collecte', entiteId: c.id, avant: { reference: c.reference } });
  res.json({ ok: true });
});

// ─── Modèles et retours ─────────────────────────────────────────────────────
async function serviceDe(req) {
  const c = await charger(req.ctx, req.valid.params.id);
  const cs = await db('collecte_services as cs').join('plan_services as s', 's.id', 'cs.service_id').where({ 'cs.id': req.valid.params.sid, 'cs.collecte_id': c.id })
    .first('cs.*', 's.sigle', 's.libelle', 's.programme_id');
  if (!cs) throw notFound('Service non ciblé par la campagne.');
  return { c, cs, service: { id: cs.service_id, sigle: cs.sigle, libelle: cs.libelle, programme_id: cs.programme_id } };
}

router.get('/:id/services/:sid/modele', requirePerm('planification.consulter'), validate({ params: serviceParams }), async (req, res) => {
  const { c, cs, service } = await serviceDe(req);
  if (!droits(req.ctx, c).modeles) throw forbidden('Les modèles sont générés par le Bureau organisateur de la campagne.');
  const buf = await collectes.modele(c, service, cs);
  await audit(req, { action: 'EXPORT', module: 'planification', entite: 'collecte', entiteId: c.id, message: `Modèle ${service.sigle}` });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${c.objet.toLowerCase()}-${c.annee}-${service.sigle}.xlsx"`);
  res.send(buf);
});

/** Import du fichier retourné par un service : contrôlé, conservé (pièce jointe), versionné. */
router.post('/:id/services/:sid/import', requirePerm('planification.consulter'), validate({ params: serviceParams }), async (req, res, next) => {
  let ctxImport;
  try {
    ctxImport = await serviceDe(req);
    if (!droits(req.ctx, ctxImport.c).importer) throw forbidden('Les retours sont importés par le Bureau organisateur, pendant que la campagne est ouverte.');
    if (ctxImport.cs.statut === 'INTEGRE') throw conflict('La contribution de ce service est déjà intégrée.');
  } catch (e) { return next(e); }
  return upload.single('fichier')(req, res, async (err) => {
    if (err) return next(err);
    const f = req.file;
    try {
      if (!f) throw badRequest('Aucun fichier transmis.');
      const { c, cs, service } = ctxImport;
      const r = await collectes.analyser(fs.readFileSync(f.path), c, service);
      const nom = Buffer.from(f.originalname, 'latin1').toString('utf8').slice(0, 255);
      const erreurs = r.anomalies.filter((a) => a.gravite === 'ERREUR').length;
      const out = await db.transaction(async (trx) => {
        const [a] = await trx('attachments').insert({
          entity_type: 'COLLECTE', entity_id: c.id, original_name: nom, stored_name: f.filename, mime_type: f.mimetype, size_bytes: f.size,
          sha256: await sha256File(f.path), uploaded_by: req.ctx.userId,
        }).returning('id');
        const version = ((await trx('collecte_receptions').where({ collecte_service_id: cs.id }).max('version as m').first()).m || 0) + 1;
        const [rec] = await trx('collecte_receptions').insert({
          collecte_service_id: cs.id, version, attachment_id: a.id || a, fichier: nom, donnees: JSON.stringify(r.donnees), anomalies: JSON.stringify(r.anomalies),
          erreurs, alertes: r.anomalies.length - erreurs, total: r.total, recu_par: req.ctx.userId,
        }).returning(['id', 'version', 'erreurs', 'alertes', 'total']);
        const statut = cs.statut === 'REJETE' ? 'CORRIGE' : ['RECU', 'CORRIGE'].includes(cs.statut) ? cs.statut : 'RECU';
        await trx('collecte_services').where({ id: cs.id }).update({ statut, updated_at: trx.fn.now() });
        await addHistory('COLLECTE', c.id, req.ctx.userId, { action: 'RETOUR_SERVICE', ancien: cs.statut, nouveau: statut, commentaire: `${service.sigle} — version ${version} (« ${nom} ») : ${r.donnees.length} ligne(s), ${erreurs} erreur(s), ${r.anomalies.length - erreurs} alerte(s)` }, trx);
        return { ...rec, statut };
      });
      await audit(req, { action: 'IMPORT', module: 'planification', entite: 'collecte', entiteId: c.id, message: `${service.sigle} — version ${out.version}` });
      if (!out.erreurs) {
        await notify(await decideurs(c), { type: 'COLLECTE', titre: `Contribution à intégrer : ${service.sigle}`, message: `${c.reference} — ${c.titre}`, lien: `/collectes/${c.id}`, expediteur: req.ctx.userId });
      }
      return res.status(201).json({ ...out, anomalies: r.anomalies, lignes: r.donnees.length });
    } catch (e) {
      if (f) removeQuiet(f.filename);
      return next(e);
    }
  });
});

/** Chef du Bureau organisateur (titulaire ou intérimaire). */
async function decideurs(c) {
  const b = await db('bureaux').where({ code: BUREAUX[bureauDe(c.objet)] }).first('id');
  return b ? (await loadAllNodes()).filter((n) => n.node && n.bureauId === b.id && n.primaryRole === 'CHEF_BUREAU').map((n) => n.userId) : [];
}

router.get('/:id/services/:sid/receptions/:rid', requirePerm('planification.consulter'), validate({ params: serviceParams.extend({ rid: z.coerce.number().int().positive() }) }), async (req, res) => {
  const { cs } = await serviceDe(req);
  const r = await db('collecte_receptions').where({ id: req.valid.params.rid, collecte_service_id: cs.id }).first();
  if (!r) throw notFound('Réception introuvable.');
  res.json({ ...r, total: r.total === null ? null : Number(r.total), colonnes: collectes.colonnes((await db('collectes').where({ id: cs.collecte_id }).first()).objet, (await db('collectes').where({ id: cs.collecte_id }).first()).annee) });
});

router.post('/:id/services/:sid/rejeter', requirePerm('planification.consulter'), validate({ params: serviceParams, body: z.object({ motif: z.string().trim().min(5).max(5000) }) }), async (req, res) => {
  const { c, cs, service } = await serviceDe(req);
  if (!droits(req.ctx, c).decider) throw forbidden('Le rejet d’une contribution revient au Chef du Bureau organisateur.');
  if (!['RECU', 'CORRIGE'].includes(cs.statut)) throw badRequest('Seule une contribution reçue se rejette.');
  await db('collecte_services').where({ id: cs.id }).update({ statut: 'REJETE', motif_rejet: req.valid.body.motif, decide_par: req.ctx.userId, decide_at: db.fn.now(), updated_at: db.fn.now() });
  await addHistory('COLLECTE', c.id, req.ctx.userId, { action: 'REJET', ancien: cs.statut, nouveau: 'REJETE', commentaire: `${service.sigle} : ${req.valid.body.motif}` });
  await audit(req, { action: 'MODIFICATION', module: 'planification', entite: 'collecte', entiteId: c.id, message: `${service.sigle} rejeté` });
  res.json({ statut: 'REJETE' });
});

router.post('/:id/services/:sid/integrer', requirePerm('planification.consulter'), validate({ params: serviceParams }), async (req, res) => {
  const { c, cs, service } = await serviceDe(req);
  if (!droits(req.ctx, c).decider) throw forbidden('L’intégration d’une contribution revient au Chef du Bureau organisateur.');
  if (!['RECU', 'CORRIGE'].includes(cs.statut)) throw badRequest('Seule une contribution reçue s’intègre.');
  const rec = await db('collecte_receptions').where({ collecte_service_id: cs.id }).orderBy('version', 'desc').first();
  if (rec.erreurs) throw badRequest(`La dernière version reçue comporte ${rec.erreurs} erreur(s) : faites corriger le fichier par le service, ou rejetez-le avec un motif.`);
  let resultat;
  try {
    resultat = await db.transaction(async (trx) => {
      const r = await collectes.integrer(trx, c, service, rec, req.ctx);
      await trx('collecte_services').where({ id: cs.id }).update({ statut: 'INTEGRE', integration: JSON.stringify({ ...r, version: rec.version }), decide_par: req.ctx.userId, decide_at: trx.fn.now(), updated_at: trx.fn.now() });
      await addHistory('COLLECTE', c.id, req.ctx.userId, { action: 'INTEGRATION', ancien: cs.statut, nouveau: 'INTEGRE', commentaire: `${service.sigle} — version ${rec.version} : ${r.message}` }, trx);
      return r;
    });
  } catch (e) {
    if (e.metier) throw conflict(e.message);
    throw e;
  }
  await audit(req, { action: 'VALIDATION', module: 'planification', entite: 'collecte', entiteId: c.id, message: `${service.sigle} intégré : ${resultat.message}` });
  res.json({ statut: 'INTEGRE', integration: resultat });
});

// ─── Lettres d’envoi et de relance ──────────────────────────────────────────
router.post('/:id/lettres', requirePerm('planification.consulter'), validate({ params: idParam, body: z.object({
  type: z.enum(['ENVOI', 'RELANCE']), services: z.array(z.coerce.number().int().positive()).max(100).optional(),
}) }), async (req, res) => {
  const c = await charger(req.ctx, req.valid.params.id);
  if (!droits(req.ctx, c).lettres) throw forbidden('Les lettres de la campagne sont préparées par le Bureau organisateur, tant qu’elle n’est pas clôturée.');
  const { type } = req.valid.body;
  const liste = await services(c);
  let vises;
  if (type === 'ENVOI') {
    vises = req.valid.body.services ? liste.filter((s) => req.valid.body.services.includes(s.id)) : liste;
  } else {
    if (c.statut !== 'OUVERTE') throw badRequest('Une relance se prépare pendant que la campagne est ouverte.');
    const sansRetour = liste.filter((s) => ['ATTENDU', 'EN_RETARD'].includes(s.statut));
    vises = req.valid.body.services ? sansRetour.filter((s) => req.valid.body.services.includes(s.id))
      : sansRetour.some((s) => s.statut === 'EN_RETARD') ? sansRetour.filter((s) => s.statut === 'EN_RETARD') : sansRetour;
    if (!vises.length) throw badRequest('Aucun service sans retour à relancer.');
  }
  if (!vises.length) throw badRequest('Aucun service visé par la lettre.');
  const envoi = (await lettresDe(c)).filter((l) => l.type === 'ENVOI' && l.numero_officiel).pop();
  const titre = `${type === 'ENVOI' ? 'Lettre d’envoi' : 'Lettre de relance'} — ${c.reference} (${vises.length === 1 ? vises[0].sigle : `${vises.length} services`})`.slice(0, 300);
  const out = await db.transaction(async (trx) => {
    const d = await lettres.creerBrouillon(trx, req.ctx, { titre, contenu: lettres.contenu(type, presenter(c), vises, envoi) });
    const [l] = await trx('collecte_lettres').insert({ collecte_id: c.id, type, document_id: d.id, services: JSON.stringify(vises.map((s) => s.id)), created_by: req.ctx.userId }).returning('*');
    await addHistory('COLLECTE', c.id, req.ctx.userId, { action: type === 'ENVOI' ? 'ENVOI' : 'RELANCE', commentaire: `${titre} : brouillon ${d.reference} préparé dans la correspondance` }, trx);
    return { ...l, document: d };
  });
  await audit(req, { action: 'CREATION', module: 'documents', entite: 'document', entiteId: out.document.id, message: `${titre} (campagne ${c.reference})` });
  res.status(201).json({ id: out.id, type, document_id: out.document.id, reference: out.document.reference, services: vises.map((s) => s.sigle) });
});

// ─── Export consolidé ───────────────────────────────────────────────────────
router.get('/:id/export', requirePerm('planification.consulter'), requirePerm('exports.generer'), validate({ params: idParam }), async (req, res) => {
  const c = await charger(req.ctx, req.valid.params.id);
  const liste = await services(c);
  const LIB = { ATTENDU: 'Attendu', RECU: 'Reçu', REJETE: 'Rejeté', CORRIGE: 'Corrigé', INTEGRE: 'Intégré', EN_RETARD: 'En retard' };
  const date = (d) => (d ? new Date(d).toLocaleDateString('fr-FR', { timeZone: 'Africa/Kinshasa' }) : '');
  const r = resume(liste);
  const sousTitre = `${c.reference} — ${collectes.OBJETS[c.objet].libelle}, exercice ${c.annee} — échéance ${date(c.echeance)} — taux de retour ${r.retour} %, ${r.integres} intégré(s) sur ${r.total}`;
  const suivi = {
    name: 'Suivi des services', titre: `Suivi de la campagne « ${c.titre} »`, sousTitre,
    columns: [
      { header: 'Service', key: 'sigle', width: 12 }, { header: 'Libellé', key: 'libelle', width: 34 }, { header: 'Statut', width: 12, value: (s) => LIB[s.statut] || s.statut },
      { header: 'Dernière version', width: 10, value: (s) => (s.derniere ? s.derniere.version : null) }, { header: 'Reçu le', width: 12, value: (s) => date(s.derniere?.recu_at) },
      { header: 'Lignes', width: 9, value: (s) => (s.derniere ? s.derniere.lignes : null) }, { header: 'Erreurs', width: 9, value: (s) => (s.derniere ? s.derniere.erreurs : null) },
      { header: 'Alertes', width: 9, value: (s) => (s.derniere ? s.derniere.alertes : null) }, { header: 'Total (CDF)', width: 16, value: (s) => s.derniere?.total ?? null },
      { header: 'Jours de retard', width: 10, value: (s) => s.jours_retard || null }, { header: 'Relances', width: 9, value: (s) => s.relances || null },
      { header: 'Motif du rejet ou intégration', width: 40, value: (s) => (s.statut === 'REJETE' ? s.motif_rejet : s.integration?.message || '') },
    ],
    rows: liste,
  };
  const cols = collectes.colonnes(c.objet, c.annee).filter((x) => x.k !== 'numero' && !/^m\d+$/.test(x.k));
  const lignes = [];
  for (const s of liste.filter((x) => x.derniere)) {
    const rec = await db('collecte_receptions').where({ id: s.derniere.id }).first('donnees', 'version');
    for (const l of rec.donnees) lignes.push({ service: s.sigle, statut: LIB[s.statut], version: rec.version, ...l, mois: Array.isArray(l.mois) ? l.mois.join(', ') : undefined });
  }
  const donnees = {
    name: 'Lignes consolidées', titre: `${collectes.OBJETS[c.objet].libelle} — exercice ${c.annee}`, sousTitre: `Dernière version reçue de chaque service — ${c.reference}`,
    columns: [
      { header: 'Service', key: 'service', width: 12 }, { header: 'Statut', key: 'statut', width: 11 }, { header: 'Version', key: 'version', width: 8 },
      ...cols.map((x) => ({ header: x.h.replace(' *', ''), key: x.k, width: Math.max(10, Math.min(x.w || 16, 36)) })),
      ...(c.objet === 'PTBA' ? [{ header: 'Chronogramme (mois)', key: 'mois', width: 18 }] : []),
    ],
    rows: lignes,
  };
  await audit(req, { action: 'EXPORT', module: 'planification', entite: 'collecte', entiteId: c.id, message: 'Export consolidé de la campagne' });
  return sendWorkbook(res, `collecte-${c.objet.toLowerCase()}-${c.annee}-${c.reference.split('/').pop()}.xlsx`, [suivi, donnees]);
});

/** Consolidation : lignes de la dernière version reçue de chaque service. */
router.get('/:id/consolidation', requirePerm('planification.consulter'), validate({ params: idParam }), async (req, res) => {
  const c = await charger(req.ctx, req.valid.params.id);
  const liste = await services(c);
  const lignes = [];
  for (const s of liste.filter((x) => x.derniere)) {
    const r = await db('collecte_receptions').where({ id: s.derniere.id }).first('donnees', 'version');
    for (const l of r.donnees) lignes.push({ service: s.sigle, statut: s.statut, version: r.version, ...l });
  }
  res.json({ colonnes: collectes.colonnes(c.objet, c.annee), lignes });
});

module.exports = router;
module.exports.marquerRetards = marquerRetards;

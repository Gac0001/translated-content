'use strict';
/**
 * Fiches de projets PIP, au modèle du Ministère du Plan (classeur de six feuilles, importable et
 * exportable à l’identique).
 * Workflow : Brouillon → En vérification (Chef de Division, ou Directeur pour les structures
 * directement rattachées) → Vérifiée → Validée (Directeur) → Archivée ; retour « À corriger » possible.
 */
const express = require('express');
const multer = require('multer');
const { z } = require('zod');
const db = require('../../db/knex');
const validate = require('../../middleware/validate');
const { requirePerm } = require('../../middleware/auth');
const { audit } = require('../../services/audit');
const { notify } = require('../../services/notifications');
const { addHistory, getHistory } = require('../../services/history');
const { nextReference } = require('../../services/sequence');
const { loadAllNodes, ctxNode } = require('../../services/hierarchy');
const { scopePip, loadEntity } = require('../../services/access');
const pdf = require('../../services/pdf');
const { sendWorkbook } = require('../../services/excel');
const pipExcel = require('../../services/pipExcel');
const identite = require('../../services/identite');
const { SECTIONS, normalize, ficheVide } = require('./model');
const { badRequest, forbidden, notFound } = require('../../utils/errors');
const { DEP_NOM, ROLE_LIBELLES } = require('../../constants');

const router = express.Router();
const idParam = z.object({ id: z.coerce.number().int().positive() });
const STATUT_LIBELLES = { BROUILLON: 'Brouillon', EN_VERIFICATION: 'En vérification', A_CORRIGER: 'À corriger', VERIFIE: 'Vérifiée', VALIDE: 'Validée', ARCHIVE: 'Archivée' };

const PROVINCES = ['Kinshasa', 'Kongo-Central', 'Kwango', 'Kwilu', 'Mai-Ndombe', 'Équateur', 'Sud-Ubangi', 'Nord-Ubangi', 'Mongala', 'Tshuapa', 'Tshopo',
  'Bas-Uele', 'Haut-Uele', 'Ituri', 'Nord-Kivu', 'Sud-Kivu', 'Maniema', 'Haut-Katanga', 'Lualaba', 'Haut-Lomami', 'Tanganyika', 'Lomami', 'Kasaï',
  'Kasaï-Central', 'Kasaï-Oriental', 'Sankuru'];
const upload = multer({
  storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => (/\.xlsx$/i.test(file.originalname) ? cb(null, true) : cb(badRequest('Format attendu : classeur Excel (.xlsx) au modèle de fiche de projet du Ministère du Plan.'))),
});

/** Valeurs proposées par les rubriques de la fiche (référentiels et valeurs déjà employées). */
async function suggestions() {
  const [services, rattachements, deja] = await Promise.all([
    db('plan_services').where({ actif: true }).orderBy(['ordre', 'sigle']),
    db('plan_rattachements').where({ actif: true }).orderBy(['referentiel', 'niveau', 'ordre', 'libelle']),
    db.raw(`SELECT DISTINCT donnees->'identification'->>'secteur' AS secteur, donnees->'identification'->>'nature_investissement' AS nature FROM pip_projects`),
  ]);
  const libelles = Object.fromEntries(rattachements.map((r) => [r.id, r.libelle]));
  const out = {
    SERVICES: services.map((x) => `${x.libelle} (${x.sigle})`),
    PROVINCES,
    SECTEURS: [...new Set(['Gouvernance', 'Infrastructures', 'Numérique', ...deja.rows.map((r) => r.secteur).filter(Boolean)])],
    NATURES: [...new Set(['Immobilisation corporelle', 'Immobilisation incorporelle', ...deja.rows.map((r) => r.nature).filter(Boolean)])],
  };
  for (const r of rattachements) (out[`${r.referentiel}:${r.niveau}`] ||= []).push({ libelle: r.libelle, parent: r.parent_id ? libelles[r.parent_id] : null });
  return out;
}

router.get('/modele', async (req, res) => res.json({ sections: SECTIONS, vide: ficheVide(), suggestions: await suggestions() }));

function baseQuery() {
  return db('pip_projects as p')
    .join('users as ua', 'ua.id', 'p.auteur_user_id').leftJoin('agents as aa', 'aa.id', 'ua.agent_id')
    .leftJoin('users as uh', 'uh.id', 'p.detenteur_user_id').leftJoin('agents as ah', 'ah.id', 'uh.agent_id')
    .leftJoin('bureaux as b', 'b.id', 'p.bureau_id').leftJoin('divisions as d', 'd.id', 'p.division_id')
    .select('p.*', 'b.nom as bureau_nom', 'd.nom as division_nom',
      db.raw(`concat_ws(' ', aa.prenom, aa.nom) as auteur_nom`), db.raw(`concat_ws(' ', ah.prenom, ah.nom) as detenteur_nom`));
}

const listQuery = z.object({ statut: z.enum(Object.keys(STATUT_LIBELLES)).optional(), q: z.string().trim().max(100).optional() });

function listed(req) {
  const q = scopePip(baseQuery(), req.ctx).orderBy('p.updated_at', 'desc');
  if (req.valid.query.statut) q.where('p.statut', req.valid.query.statut);
  if (req.valid.query.q) q.where((w) => w.whereILike('p.intitule', `%${req.valid.query.q}%`).orWhereILike('p.code', `%${req.valid.query.q}%`));
  return q;
}

router.get('/', requirePerm('pip.consulter'), validate({ query: listQuery }), async (req, res) => {
  const rows = await listed(req).limit(500);
  res.json({ data: rows.map((r) => ({ ...r, donnees: undefined })) });
});

router.get('/export/xlsx', requirePerm('pip.consulter'), requirePerm('exports.generer'), validate({ query: listQuery }), async (req, res) => {
  const rows = await listed(req);
  await audit(req, { action: 'EXPORT', module: 'pip', message: 'Portefeuille PIP (XLSX)' });
  return sendWorkbook(res, 'portefeuille-PIP-DEP.xlsx', [{
    name: 'Portefeuille PIP', titre: 'Portefeuille des projets PIP',
    columns: [
      { header: 'Code', key: 'code', width: 18 }, { header: 'Intitulé', key: 'intitule', width: 44 }, { header: 'Secteur', key: 'secteur', width: 20 },
      { header: 'Coût total', key: 'cout_total', width: 16 }, { header: 'Devise', key: 'devise', width: 8 }, { header: 'Durée (mois)', key: 'duree_mois', width: 12 },
      { header: 'Démarrage', key: 'date_debut', width: 12 }, { header: 'Statut', value: (r) => STATUT_LIBELLES[r.statut], width: 14 },
      { header: 'Structure', value: (r) => r.bureau_nom || r.division_nom || 'Direction', width: 30 },
    ],
    rows,
  }]);
});

async function detail(ctx, id) {
  await loadEntity(ctx, 'PIP', id);
  const p = await baseQuery().where('p.id', id).first();
  const [historique, pieces, versions] = await Promise.all([
    getHistory('PIP', id),
    db('attachments').where({ entity_type: 'PIP', entity_id: id }).whereNull('deleted_at'),
    db('pip_versions').where({ pip_id: id }).orderBy('numero', 'desc').select('id', 'numero', 'created_at', 'created_by'),
  ]);
  const verif = p.verifie_par ? await db('users as u').leftJoin('agents as a', 'a.id', 'u.agent_id').where('u.id', p.verifie_par).first(db.raw(`concat_ws(' ', a.prenom, a.nom) as nom`)) : null;
  const valid = p.valide_par ? await db('users as u').leftJoin('agents as a', 'a.id', 'u.agent_id').where('u.id', p.valide_par).first(db.raw(`concat_ws(' ', a.prenom, a.nom) as nom`)) : null;
  const { missing, incoherences, synthese } = normalize(p.donnees);
  return {
    ...p, historique, pieces, versions, rubriquesManquantes: missing, incoherences, synthese,
    pageControle: {
      elaborePar: p.auteur_nom, elaboreLe: p.created_at, structure: p.bureau_nom || p.division_nom || DEP_NOM,
      verifiePar: verif ? verif.nom : null, verifieLe: p.verifie_at, validePar: valid ? valid.nom : null, valideLe: p.valide_at,
      completude: `${SECTIONS.reduce((n, s) => n + s.fields.filter((f) => f.required).length, 0) - missing.length} / ${SECTIONS.reduce((n, s) => n + s.fields.filter((f) => f.required).length, 0)} rubriques obligatoires renseignées`,
    },
  };
}

function actionsFor(ctx, p) {
  const auteur = p.auteur_user_id === ctx.userId;
  const detenteur = p.detenteur_user_id === ctx.userId;
  const ro = ctx.perimetre === 'SUPERVISION_GLOBALE';
  return {
    modifier: !ro && auteur && ['BROUILLON', 'A_CORRIGER'].includes(p.statut),
    soumettre: !ro && auteur && ['BROUILLON', 'A_CORRIGER'].includes(p.statut),
    verifier: !ro && detenteur && p.statut === 'EN_VERIFICATION' && ctx.can('pip.verifier'),
    retourner: !ro && detenteur && ['EN_VERIFICATION', 'VERIFIE'].includes(p.statut) && (ctx.can('pip.verifier') || ctx.can('pip.valider')),
    valider: !ro && detenteur && p.statut === 'VERIFIE' && ctx.can('pip.valider'),
    archiver: !ro && p.statut === 'VALIDE' && ctx.can('pip.archiver'),
  };
}

router.get('/:id', requirePerm('pip.consulter'), validate({ params: idParam }), async (req, res) => {
  const p = await detail(req.ctx, req.valid.params.id);
  res.json({ ...p, actions: actionsFor(req.ctx, p) });
});

const bodySchema = z.object({ donnees: z.record(z.string(), z.any()), importe: z.string().trim().max(200).optional() });

router.post('/', requirePerm('pip.rediger'), validate({ body: bodySchema }), async (req, res) => {
  if (req.ctx.perimetre === 'SUPERVISION_GLOBALE' || !ctxNode(req.ctx)) throw forbidden('Votre compte ne peut pas rédiger de fiche PIP.');
  const { donnees, coutTotal } = normalize(req.valid.body.donnees);
  const id = donnees.identification;
  if (!id.libelle || id.libelle.trim().length < 3) throw badRequest('Le libellé du projet est obligatoire.');
  const dep = await db('directions').where({ code: 'DEP' }).first();
  const row = await db.transaction(async (trx) => {
    const code = await nextReference('PIP', 'DEP/PIP', trx);
    const [p] = await trx('pip_projects').insert({
      code, intitule: id.libelle, secteur: id.secteur, donnees: JSON.stringify(donnees), cout_total: coutTotal, devise: 'CDF', modele: 'PLAN',
      duree_mois: donnees.calendrier.duree_mois, date_debut: donnees.calendrier.date_debut || null, auteur_user_id: req.ctx.userId, detenteur_user_id: req.ctx.userId,
      direction_id: dep.id, division_id: req.ctx.divisionId, bureau_id: req.ctx.bureauId,
    }).returning('*');
    await trx('pip_versions').insert({ pip_id: p.id, numero: 1, donnees: JSON.stringify(donnees), created_by: req.ctx.userId });
    await addHistory('PIP', p.id, req.ctx.userId, { action: 'CREATION', nouveau: 'BROUILLON', commentaire: req.valid.body.importe ? `Fiche importée du classeur « ${req.valid.body.importe} »` : null }, trx);
    return p;
  });
  await audit(req, { action: req.valid.body.importe ? 'IMPORT' : 'CREATION', module: 'pip', entite: 'pip', entiteId: row.id, apres: { code: row.code, intitule: row.intitule }, message: req.valid.body.importe || undefined });
  res.status(201).json(row);
});

router.put('/:id', requirePerm('pip.rediger'), validate({ params: idParam, body: bodySchema }), async (req, res) => {
  const p = await loadEntity(req.ctx, 'PIP', req.valid.params.id, 'write');
  if (!actionsFor(req.ctx, p).modifier) throw forbidden('Seul l’auteur peut modifier la fiche à l’état Brouillon ou À corriger.');
  const { donnees, coutTotal } = normalize(req.valid.body.donnees);
  const id = donnees.identification;
  const numero = p.version + 1;
  const u = await db.transaction(async (trx) => {
    const [r] = await trx('pip_projects').where({ id: p.id }).update({
      intitule: id.libelle || p.intitule, secteur: id.secteur, donnees: JSON.stringify(donnees), cout_total: coutTotal, devise: 'CDF', modele: 'PLAN',
      duree_mois: donnees.calendrier.duree_mois, date_debut: donnees.calendrier.date_debut || null, version: numero, updated_at: trx.fn.now(),
    }).returning('*');
    await trx('pip_versions').insert({ pip_id: p.id, numero, donnees: JSON.stringify(donnees), created_by: req.ctx.userId });
    await addHistory('PIP', p.id, req.ctx.userId, { action: 'NOUVELLE_VERSION', commentaire: `Version ${numero}` }, trx);
    return r;
  });
  await audit(req, { action: 'MODIFICATION', module: 'pip', entite: 'pip', entiteId: p.id, avant: { version: p.version }, apres: { version: numero } });
  res.json(u);
});

async function verificateurPour(p) {
  const all = await loadAllNodes();
  const cd = p.division_id ? all.find((n) => n.node && n.node.key === `DIV:${p.division_id}`) : null;
  const dir = all.find((n) => n.primaryRole === 'DIRECTEUR');
  return { verificateur: cd && cd.userId !== p.auteur_user_id ? cd : dir, directeur: dir };
}

async function move(req, p, patch, action, commentaire, notifyTo, titre) {
  const [u] = await db('pip_projects').where({ id: p.id }).update({ ...patch, updated_at: db.fn.now() }).returning('*');
  await addHistory('PIP', p.id, req.ctx.userId, { action, ancien: p.statut, nouveau: u.statut, commentaire });
  await audit(req, { action: ['VALIDATION', 'VERIFICATION'].includes(action) ? 'VALIDATION' : action === 'SOUMISSION' ? 'TRANSMISSION' : action === 'ARCHIVAGE' ? 'ARCHIVAGE' : 'MODIFICATION', module: 'pip', entite: 'pip', entiteId: p.id, avant: { statut: p.statut }, apres: { statut: u.statut }, message: action });
  if (notifyTo) await notify(notifyTo, { type: 'PIP', titre: `${titre} : ${p.intitule}`, message: commentaire || p.code, lien: `/pip/${p.id}`, expediteur: req.ctx.userId });
  return u;
}

router.post('/:id/soumettre', requirePerm('pip.rediger'), validate({ params: idParam }), async (req, res) => {
  const p = await loadEntity(req.ctx, 'PIP', req.valid.params.id, 'write');
  if (!actionsFor(req.ctx, p).soumettre) throw forbidden();
  const { missing, incoherences } = normalize(p.donnees);
  if (missing.length) throw badRequest(`Rubriques obligatoires à compléter : ${missing.slice(0, 8).join(' ; ')}${missing.length > 8 ? ` (et ${missing.length - 8} autre(s))` : ''}.`);
  const bloquantes = incoherences.filter((x) => x.bloquant);
  if (bloquantes.length) throw badRequest(`Incohérences à corriger avant la soumission : ${bloquantes.map((x) => x.message).join(' ')}`);
  const { verificateur, directeur } = await verificateurPour(p);
  if (req.ctx.primaryRole === 'DIRECTEUR' || (verificateur && verificateur.userId === req.ctx.userId)) {
    // Le vérificateur naturel est l’auteur : passage direct au Directeur
    if (!directeur) throw badRequest('Aucun Directeur actif.');
    return res.json(await move(req, p, { statut: 'VERIFIE', detenteur_user_id: directeur.userId, verifie_par: req.ctx.userId, verifie_at: db.fn.now() }, 'SOUMISSION', 'Soumise pour validation', directeur.userId, 'Fiche PIP à valider'));
  }
  if (!verificateur) throw badRequest('Aucun vérificateur disponible.');
  return res.json(await move(req, p, { statut: 'EN_VERIFICATION', detenteur_user_id: verificateur.userId }, 'SOUMISSION', `Soumise à ${verificateur.nomComplet} (${verificateur.roleLibelle}) pour vérification`, verificateur.userId, 'Fiche PIP à vérifier'));
});

router.post('/:id/verifier', requirePerm('pip.verifier'), validate({ params: idParam, body: z.object({ commentaire: z.string().trim().max(2000).optional() }) }), async (req, res) => {
  const p = await loadEntity(req.ctx, 'PIP', req.valid.params.id);
  if (!actionsFor(req.ctx, p).verifier) throw forbidden();
  const { directeur } = await verificateurPour(p);
  if (req.ctx.primaryRole === 'DIRECTEUR') {
    return res.json(await move(req, p, { statut: 'VERIFIE', verifie_par: req.ctx.userId, verifie_at: db.fn.now() }, 'VERIFICATION', req.valid.body.commentaire || 'Fiche vérifiée', p.auteur_user_id, 'Fiche PIP vérifiée'));
  }
  return res.json(await move(req, p, { statut: 'VERIFIE', detenteur_user_id: directeur.userId, verifie_par: req.ctx.userId, verifie_at: db.fn.now() }, 'VERIFICATION', req.valid.body.commentaire || 'Fiche vérifiée et transmise au Directeur', [directeur.userId, p.auteur_user_id], 'Fiche PIP vérifiée'));
});

router.post('/:id/retourner', requirePerm('pip.verifier', 'pip.valider'), validate({ params: idParam, body: z.object({ commentaire: z.string().trim().min(3).max(5000) }) }), async (req, res) => {
  const p = await loadEntity(req.ctx, 'PIP', req.valid.params.id);
  if (!actionsFor(req.ctx, p).retourner) throw forbidden();
  res.json(await move(req, p, { statut: 'A_CORRIGER', detenteur_user_id: p.auteur_user_id }, 'RETOUR_CORRECTION', req.valid.body.commentaire, p.auteur_user_id, 'Fiche PIP à corriger'));
});

router.post('/:id/valider', requirePerm('pip.valider'), validate({ params: idParam, body: z.object({ commentaire: z.string().trim().max(2000).optional() }) }), async (req, res) => {
  const p = await loadEntity(req.ctx, 'PIP', req.valid.params.id);
  if (!actionsFor(req.ctx, p).valider) throw forbidden('Validation réservée au Directeur.');
  res.json(await move(req, p, { statut: 'VALIDE', valide_par: req.ctx.userId, valide_at: db.fn.now() }, 'VALIDATION', req.valid.body.commentaire || 'Fiche PIP validée', p.auteur_user_id, 'Fiche PIP validée'));
});

router.post('/:id/archiver', requirePerm('pip.archiver'), validate({ params: idParam }), async (req, res) => {
  const p = await loadEntity(req.ctx, 'PIP', req.valid.params.id);
  if (!actionsFor(req.ctx, p).archiver) throw forbidden();
  res.json(await move(req, p, { statut: 'ARCHIVE', archived_at: db.fn.now() }, 'ARCHIVAGE', 'Fiche archivée', null));
});

function fieldText(f, v) {
  if (f.type === 'list') return (v || []).map((x) => `• ${x}`).join('\n');
  if (f.type === 'date') return pdf.fmtDate(v);
  if (f.type === 'number' && v !== null && v !== undefined) return Number(v).toLocaleString('fr-FR');
  return v;
}

/** Libellés des colonnes « Année n » avec les années réelles de la fiche. */
function colonnesAnnees(f, s, sy) {
  const base = s.key === 'financier' && f.key === 'recurrents' ? (sy.anneeFin ? sy.anneeFin + 1 : null) : sy.anneeDebut;
  return f.columns.map((c) => {
    const m = c.key.match(/^annee(\d)$/);
    return { header: m && base ? String(base + Number(m[1]) - 1) : c.label, key: c.key, width: c.key === f.columns[0].key ? 3 : 1, align: c.type === 'number' ? 'right' : undefined,
      value: c.type === 'number' ? (r) => (r[c.key] === null || r[c.key] === undefined ? '' : Number(r[c.key]).toLocaleString('fr-FR')) : c.type === 'date' ? (r) => pdf.fmtDate(r[c.key]) : undefined };
  });
}

router.get('/:id/export/:format', requirePerm('exports.generer'), validate({ params: z.object({ id: z.coerce.number().int(), format: z.enum(['pdf', 'xlsx']) }) }), async (req, res) => {
  const p = await detail(req.ctx, req.valid.params.id);
  await audit(req, { action: 'EXPORT', module: 'pip', entite: 'pip', entiteId: p.id, message: req.valid.params.format.toUpperCase() });
  const fname = p.code.replace(/\//g, '-');
  if (req.valid.params.format === 'xlsx') {
    // Classeur au modèle du Ministère du Plan (six feuilles), à transmettre tel quel
    const buf = await pipExcel.exporter(p.donnees, identite.courante());
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${fname}.xlsx"`);
    return res.send(Buffer.from(buf));
  }
  const sy = p.synthese;
  const { doc, finish } = pdf.createPdf(res, { filename: `${fname}.pdf`, titre: 'FICHE DE PROJET — PROGRAMME D’INVESTISSEMENTS PUBLICS (PIP)', sousTitre: p.intitule, reference: p.code });
  pdf.keyValues(doc, [['Code', p.code], ['Étape', p.donnees.identification?.etape], ['Coût du projet', `${Number(sy.coutTotal).toLocaleString('fr-FR')} CDF`],
    ['Plan de financement', `${Number(sy.financementTotal).toLocaleString('fr-FR')} CDF`], ['Statut', STATUT_LIBELLES[p.statut]], ['Version', p.version]]);
  for (const s of SECTIONS) {
    pdf.ensureSpace(doc, 50);
    doc.font('Helvetica-Bold').fontSize(11.5).fillColor(pdf.BLUE).text(`${s.numero}. ${s.label.toUpperCase()}`).fillColor('#000').moveDown(0.3);
    for (const f of s.fields) {
      const v = p.donnees[s.key]?.[f.key];
      if (f.type === 'table') {
        if (!v || !v.length) continue;
        doc.font('Helvetica-Bold').fontSize(9.5).text(f.label).moveDown(0.2);
        pdf.table(doc, colonnesAnnees(f, s, sy), v);
      } else if (v !== null && v !== undefined && v !== '' && !(Array.isArray(v) && !v.length)) pdf.section(doc, f.label, fieldText(f, v));
    }
  }
  doc.addPage();
  doc.font('Helvetica-Bold').fontSize(12).fillColor(pdf.BLUE).text('PAGE DE CONTRÔLE', { align: 'center' }).fillColor('#000').moveDown(0.6);
  const pc = p.pageControle;
  pdf.keyValues(doc, [
    ['Structure', pc.structure], ['Élaborée par', pc.elaborePar], ['Date d’élaboration', pdf.fmtDateTime(pc.elaboreLe)],
    ['Vérifiée par', pc.verifiePar], ['Date de vérification', pdf.fmtDateTime(pc.verifieLe)],
    ['Validée par', pc.validePar ? `${pc.validePar} (Directeur)` : null], ['Date de validation', pdf.fmtDateTime(pc.valideLe)],
    ['Complétude', pc.completude],
  ]);
  const annees = [0, 1, 2, 3].map((i) => (sy.anneeDebut ? String(sy.anneeDebut + i) : `Année ${i + 1}`));
  pdf.table(doc, [{ header: 'Totaux par année (CDF)', key: 'l', width: 2.5 }, ...annees.map((a, i) => ({ header: i === 3 ? `${a} / autres` : a, key: `a${i}`, width: 1.3, align: 'right' })), { header: 'Total', key: 't', width: 1.4, align: 'right' }], [
    { l: 'Répartition des coûts', ...Object.fromEntries(sy.coutsParAnnee.map((x, i) => [`a${i}`, x.toLocaleString('fr-FR')])), t: sy.coutTotal.toLocaleString('fr-FR') },
    { l: 'Plan de financement', ...Object.fromEntries(sy.financementParAnnee.map((x, i) => [`a${i}`, x.toLocaleString('fr-FR')])), t: sy.financementTotal.toLocaleString('fr-FR') },
  ]);
  if (p.rubriquesManquantes.length || p.incoherences.length) {
    pdf.section(doc, 'Points à corriger', [...p.rubriquesManquantes.map((m) => `• Rubrique manquante : ${m}`), ...p.incoherences.map((x) => `• ${x.bloquant ? 'Incohérence' : 'À vérifier'} : ${x.message}`)].join('\n'));
  }
  pdf.table(doc, [
    { header: 'Date', value: (h) => pdf.fmtDateTime(h.created_at), width: 2 }, { header: 'Intervenant', value: (h) => h.auteur || h.username, width: 2 },
    { header: 'Étape', key: 'action', width: 2 }, { header: 'Statut', value: (h) => STATUT_LIBELLES[h.nouveau_statut] || '', width: 1.5 }, { header: 'Observations', key: 'commentaire', width: 4 },
  ], p.historique);
  pdf.signatureBlock(doc, [{ libelle: 'Élaborée par', nom: pc.elaborePar }, { libelle: 'Vérifiée par', nom: pc.verifiePar || '' }, { libelle: `Le ${ROLE_LIBELLES.DIRECTEUR}`, nom: pc.validePar || '' }]);
  return finish();
});

/** Lecture d’un classeur au modèle du Ministère du Plan : la fiche est renvoyée pour relecture, sans être enregistrée. */
router.post('/import/analyser', requirePerm('pip.rediger'), (req, res, next) => upload.single('fichier')(req, res, async (err) => {
  if (err) return next(err);
  try {
    if (!req.file) throw badRequest('Aucun fichier transmis.');
    let r;
    try { r = await pipExcel.analyser(req.file.buffer); } catch { throw badRequest('Classeur illisible : vérifiez qu’il s’agit d’un fichier Excel (.xlsx).'); }
    if (!r.donnees.identification.libelle) throw badRequest('Aucun libellé de projet n’a été trouvé : le classeur ne semble pas suivre le modèle de fiche de projet du Ministère du Plan.');
    await audit(req, { action: 'IMPORT_ANALYSE', module: 'pip', message: `${req.file.originalname} : ${r.missing.length} rubrique(s) manquante(s), ${r.incoherences.length} incohérence(s)` });
    return res.json({ fichier: req.file.originalname, ...r });
  } catch (e) { return next(e); }
}));

router.get('/:id/versions/:numero', requirePerm('pip.consulter'), validate({ params: z.object({ id: z.coerce.number().int(), numero: z.coerce.number().int() }) }), async (req, res) => {
  await loadEntity(req.ctx, 'PIP', req.valid.params.id);
  const v = await db('pip_versions').where({ pip_id: req.valid.params.id, numero: req.valid.params.numero }).first();
  if (!v) throw notFound('Version introuvable.');
  res.json(v);
});

module.exports = router;

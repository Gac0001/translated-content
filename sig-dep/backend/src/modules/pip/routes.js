'use strict';
/**
 * Fiches de projets PIP.
 * Workflow : Brouillon → En vérification (Chef de Division, ou Directeur pour les structures
 * directement rattachées) → Vérifiée → Validée (Directeur) → Archivée ; retour « À corriger » possible.
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
const { loadAllNodes, ctxNode } = require('../../services/hierarchy');
const { scopePip, loadEntity } = require('../../services/access');
const pdf = require('../../services/pdf');
const { sendWorkbook } = require('../../services/excel');
const { SECTIONS, normalize } = require('./model');
const { badRequest, forbidden, notFound } = require('../../utils/errors');
const { DEP_NOM, ROLE_LIBELLES } = require('../../constants');

const router = express.Router();
const idParam = z.object({ id: z.coerce.number().int().positive() });
const STATUT_LIBELLES = { BROUILLON: 'Brouillon', EN_VERIFICATION: 'En vérification', A_CORRIGER: 'À corriger', VERIFIE: 'Vérifiée', VALIDE: 'Validée', ARCHIVE: 'Archivée' };

router.get('/modele', (req, res) => res.json({ sections: SECTIONS }));

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
  const { missing } = normalize(p.donnees);
  return {
    ...p, historique, pieces, versions, rubriquesManquantes: missing,
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

const bodySchema = z.object({ donnees: z.record(z.string(), z.any()) });

router.post('/', requirePerm('pip.rediger'), validate({ body: bodySchema }), async (req, res) => {
  if (req.ctx.perimetre === 'SUPERVISION_GLOBALE' || !ctxNode(req.ctx)) throw forbidden('Votre compte ne peut pas rédiger de fiche PIP.');
  const { donnees, coutTotal } = normalize(req.valid.body.donnees);
  const id = donnees.identification;
  if (!id.intitule || id.intitule.trim().length < 3) throw badRequest('L’intitulé du projet est obligatoire.');
  const dep = await db('directions').where({ code: 'DEP' }).first();
  const row = await db.transaction(async (trx) => {
    const code = await nextReference('PIP', 'DEP/PIP', trx);
    const [p] = await trx('pip_projects').insert({
      code, intitule: id.intitule, secteur: id.secteur, donnees: JSON.stringify(donnees), cout_total: coutTotal, devise: donnees.cout.devise || 'USD',
      duree_mois: id.duree_mois, date_debut: id.date_demarrage || null, auteur_user_id: req.ctx.userId, detenteur_user_id: req.ctx.userId,
      direction_id: dep.id, division_id: req.ctx.divisionId, bureau_id: req.ctx.bureauId,
    }).returning('*');
    await trx('pip_versions').insert({ pip_id: p.id, numero: 1, donnees: JSON.stringify(donnees), created_by: req.ctx.userId });
    await addHistory('PIP', p.id, req.ctx.userId, { action: 'CREATION', nouveau: 'BROUILLON' }, trx);
    return p;
  });
  await audit(req, { action: 'CREATION', module: 'pip', entite: 'pip', entiteId: row.id, apres: { code: row.code, intitule: row.intitule } });
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
      intitule: id.intitule || p.intitule, secteur: id.secteur, donnees: JSON.stringify(donnees), cout_total: coutTotal, devise: donnees.cout.devise || 'USD',
      duree_mois: id.duree_mois, date_debut: id.date_demarrage || null, version: numero, updated_at: trx.fn.now(),
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
  const { missing } = normalize(p.donnees);
  if (missing.length) throw badRequest(`Rubriques obligatoires à compléter : ${missing.slice(0, 8).join(' ; ')}${missing.length > 8 ? ` (et ${missing.length - 8} autre(s))` : ''}.`);
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

router.get('/:id/export/:format', requirePerm('exports.generer'), validate({ params: z.object({ id: z.coerce.number().int(), format: z.enum(['pdf', 'xlsx']) }) }), async (req, res) => {
  const p = await detail(req.ctx, req.valid.params.id);
  await audit(req, { action: 'EXPORT', module: 'pip', entite: 'pip', entiteId: p.id, message: req.valid.params.format.toUpperCase() });
  const fname = p.code.replace(/\//g, '-');
  if (req.valid.params.format === 'xlsx') {
    const sheets = [{
      name: 'Fiche', titre: `FICHE DE PROJET PIP — ${p.intitule}`, sousTitre: p.code,
      columns: [{ header: 'Section', key: 's', width: 30 }, { header: 'Rubrique', key: 'f', width: 40 }, { header: 'Contenu', key: 'v', width: 90 }],
      rows: SECTIONS.flatMap((s) => s.fields.filter((f) => f.type !== 'table').map((f) => ({ s: `${s.numero}. ${s.label}`, f: f.label, v: fieldText(f, p.donnees[s.key]?.[f.key]) }))),
    }];
    for (const s of SECTIONS) for (const f of s.fields.filter((x) => x.type === 'table')) {
      sheets.push({ name: `${s.numero}-${f.label}`.slice(0, 31).replace(/[\\/?*[\]:]/g, ' '), titre: `${s.numero}. ${s.label}`, sousTitre: `${p.code} — ${f.label}`, columns: f.columns.map((c) => ({ header: c.label, key: c.key, width: 20 })), rows: p.donnees[s.key]?.[f.key] || [] });
    }
    return sendWorkbook(res, `${fname}.xlsx`, sheets);
  }
  const { doc, finish } = pdf.createPdf(res, { filename: `${fname}.pdf`, titre: 'FICHE DE PROJET — PROGRAMME D’INVESTISSEMENTS PUBLICS (PIP)', sousTitre: p.intitule, reference: p.code });
  pdf.keyValues(doc, [['Code', p.code], ['Coût total', `${Number(p.cout_total).toLocaleString('fr-FR')} ${p.devise}`], ['Statut', STATUT_LIBELLES[p.statut]], ['Version', p.version]]);
  for (const s of SECTIONS) {
    pdf.ensureSpace(doc, 50);
    doc.font('Helvetica-Bold').fontSize(11.5).fillColor(pdf.BLUE).text(`${s.numero}. ${s.label.toUpperCase()}`).fillColor('#000').moveDown(0.3);
    for (const f of s.fields) {
      const v = p.donnees[s.key]?.[f.key];
      if (f.type === 'table') {
        doc.font('Helvetica-Bold').fontSize(9.5).text(f.label).moveDown(0.2);
        pdf.table(doc, f.columns.map((c) => ({ header: c.label, key: c.key, width: 1 })), v || []);
      } else pdf.section(doc, f.label, fieldText(f, v));
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
  pdf.table(doc, [
    { header: 'Date', value: (h) => pdf.fmtDateTime(h.created_at), width: 2 }, { header: 'Intervenant', value: (h) => h.auteur || h.username, width: 2 },
    { header: 'Étape', key: 'action', width: 2 }, { header: 'Statut', value: (h) => STATUT_LIBELLES[h.nouveau_statut] || '', width: 1.5 }, { header: 'Observations', key: 'commentaire', width: 4 },
  ], p.historique);
  pdf.signatureBlock(doc, [{ libelle: 'Élaborée par', nom: pc.elaborePar }, { libelle: 'Vérifiée par', nom: pc.verifiePar || '' }, { libelle: `Le ${ROLE_LIBELLES.DIRECTEUR}`, nom: pc.validePar || '' }]);
  return finish();
});

router.get('/:id/versions/:numero', requirePerm('pip.consulter'), validate({ params: z.object({ id: z.coerce.number().int(), numero: z.coerce.number().int() }) }), async (req, res) => {
  await loadEntity(req.ctx, 'PIP', req.valid.params.id);
  const v = await db('pip_versions').where({ pip_id: req.valid.params.id, numero: req.valid.params.numero }).first();
  if (!v) throw notFound('Version introuvable.');
  res.json(v);
});

module.exports = router;

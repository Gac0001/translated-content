'use strict';
/** Pièces jointes : téléversement et téléchargement contrôlés par le périmètre de l’élément parent. */
const express = require('express');
const fs = require('fs');
const { z } = require('zod');
const db = require('../../db/knex');
const validate = require('../../middleware/validate');
const { audit } = require('../../services/audit');
const { loadEntity } = require('../../services/access');
const { makeUpload, sha256File, safePath, removeQuiet } = require('../../services/files');
const { notFound, badRequest, forbidden } = require('../../utils/errors');

const router = express.Router();
const upload = makeUpload();
const TYPES = ['COURRIER', 'INSTRUCTION', 'TASK', 'DOCUMENT', 'PIP', 'ACTE', 'DEMANDE_INFO', 'REUNION', 'PTBA', 'REPONSE_SECT', 'PLAN_DOCUMENT'];
const entityParams = z.object({ type: z.enum(TYPES), id: z.coerce.number().int().positive() });

// Déclarée avant « /:type/:id », qui l’intercepterait sinon (« fichier » n’est pas un type d’élément).
router.get('/fichier/:id', validate({ params: z.object({ id: z.coerce.number().int().positive() }) }), async (req, res) => {
  const a = await db('attachments').where({ id: req.valid.params.id }).whereNull('deleted_at').first();
  if (!a) throw notFound('Pièce jointe introuvable.');
  await loadEntity(req.ctx, a.entity_type, a.entity_id);
  const p = safePath(a.stored_name);
  if (!fs.existsSync(p)) throw notFound('Fichier absent du stockage.');
  await audit(req, { action: req.ctx.accesSupport ? 'ACCES_SUPPORT' : 'TELECHARGEMENT', module: 'pieces_jointes', entite: 'attachment', entiteId: a.id, message: req.ctx.accesSupport ? `${a.original_name} — accès de support n° ${req.ctx.accesSupport.id} (${a.entity_type} n° ${a.entity_id})` : a.original_name });
  res.setHeader('Content-Type', a.mime_type);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(a.original_name)}`);
  fs.createReadStream(p).pipe(res);
});

router.get('/:type/:id', validate({ params: entityParams }), async (req, res) => {
  await loadEntity(req.ctx, req.valid.params.type, req.valid.params.id);
  if (req.ctx.accesSupport) await audit(req, { action: 'ACCES_SUPPORT', module: 'pieces_jointes', entite: req.valid.params.type.toLowerCase(), entiteId: req.valid.params.id, message: `Consultation de la liste des pièces — accès de support n° ${req.ctx.accesSupport.id}` });
  const rows = await db('attachments as a').leftJoin('users as u', 'u.id', 'a.uploaded_by')
    .where({ entity_type: req.valid.params.type, entity_id: req.valid.params.id }).whereNull('a.deleted_at')
    .select('a.id', 'a.original_name', 'a.mime_type', 'a.size_bytes', 'a.categorie', 'a.created_at', 'a.uploaded_by', 'u.username').orderBy('a.created_at');
  res.json({ data: rows });
});

router.post('/:type/:id', validate({ params: entityParams }), async (req, res, next) => {
  try {
    await loadEntity(req.ctx, req.valid.params.type, req.valid.params.id, 'write');
  } catch (e) { return next(e); }
  return upload.array('fichiers', 10)(req, res, async (err) => {
    if (err) return next(err);
    try {
      if (!req.files || !req.files.length) throw badRequest('Aucun fichier transmis.');
      // Preuve d’exécution : déposée par l’exécutant d’une tâche ou d’une instruction
      const categorie = req.query.categorie === 'PREUVE' ? 'PREUVE' : null;
      if (categorie && !['TASK', 'INSTRUCTION'].includes(req.valid.params.type)) throw badRequest('Une preuve d’exécution se joint à une tâche ou à une instruction.');
      const rows = [];
      for (const f of req.files) {
        const [row] = await db('attachments').insert({
          entity_type: req.valid.params.type, entity_id: req.valid.params.id,
          original_name: Buffer.from(f.originalname, 'latin1').toString('utf8').slice(0, 255),
          stored_name: f.filename, mime_type: f.mimetype, size_bytes: f.size, sha256: await sha256File(f.path), uploaded_by: req.ctx.userId, categorie,
        }).returning(['id', 'original_name', 'mime_type', 'size_bytes', 'categorie', 'created_at']);
        rows.push(row);
      }
      await audit(req, { action: 'CREATION', module: 'pieces_jointes', entite: req.valid.params.type.toLowerCase(), entiteId: req.valid.params.id, apres: rows.map((r) => r.original_name) });
      return res.status(201).json({ data: rows });
    } catch (e) {
      for (const f of req.files || []) removeQuiet(f.filename);
      return next(e);
    }
  });
});

router.delete('/fichier/:id', validate({ params: z.object({ id: z.coerce.number().int().positive() }) }), async (req, res) => {
  const a = await db('attachments').where({ id: req.valid.params.id }).whereNull('deleted_at').first();
  if (!a) throw notFound('Pièce jointe introuvable.');
  await loadEntity(req.ctx, a.entity_type, a.entity_id, 'write');
  if (a.uploaded_by !== req.ctx.userId) throw forbidden('Seul l’auteur du dépôt peut retirer cette pièce jointe.');
  // Retrait logique : le fichier est conservé pour la traçabilité
  await db('attachments').where({ id: a.id }).update({ deleted_at: db.fn.now(), deleted_by: req.ctx.userId });
  await audit(req, { action: 'SUPPRESSION', module: 'pieces_jointes', entite: 'attachment', entiteId: a.id, avant: { nom: a.original_name } });
  res.json({ message: 'Pièce jointe retirée.' });
});

module.exports = router;

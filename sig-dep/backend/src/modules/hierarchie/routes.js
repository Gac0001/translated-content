'use strict';
/** Contacts hiérarchiques directs (pour les formulaires de transmission). */
const express = require('express');
const { z } = require('zod');
const validate = require('../../middleware/validate');
const { directContacts, ctxNode } = require('../../services/hierarchy');

const router = express.Router();

router.get('/contacts', validate({ query: z.object({ sens: z.enum(['DESCENDANT', 'ASCENDANT']).optional() }) }), async (req, res) => {
  res.json({ noeud: ctxNode(req.ctx), data: await directContacts(req.ctx, req.valid.query.sens) });
});

module.exports = router;

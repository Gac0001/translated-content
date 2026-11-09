'use strict';
/**
 * Vérification publique des cartes de service (sans authentification) :
 *  - par le QR code de la carte (jeton aléatoire, aucune donnée personnelle dans le code) ;
 *  - par le matricule du titulaire (si le modèle de carte l’autorise).
 * Réponse limitée à la photo, au nom complet, au grade, à la fonction, à l’affectation et à l’état
 * de la carte. Chaque vérification est journalisée ; le nombre de requêtes est limité.
 */
const express = require('express');
const rateLimit = require('express-rate-limit');
const { z } = require('zod');
const config = require('../../config/env');
const validate = require('../../middleware/validate');
const cartes = require('../../services/cartes');
const { forbidden } = require('../../utils/errors');

const router = express.Router();

const limiteur = rateLimit({
  windowMs: 10 * 60000,
  limit: () => Number(process.env.VERIFICATION_CARTES_MAX || 30),
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: () => config.isTest && !process.env.VERIFICATION_CARTES_MAX,
  handler: (req, res) => res.status(429).json({ error: { code: 'TROP_DE_VERIFICATIONS', message: 'Trop de vérifications depuis cette adresse. Réessayez dans quelques minutes.' } }),
});

router.get('/verifier', limiteur, validate({ query: z.object({
  jeton: z.string().trim().regex(/^[A-Za-z0-9_-]{16,40}$/, 'code de carte invalide').optional(),
  matricule: z.string().trim().min(3, 'matricule trop court').max(40).optional(),
}).refine((q) => !!q.jeton !== !!q.matricule, 'Indiquez soit le code de la carte, soit le matricule.') }), async (req, res) => {
  const { jeton, matricule } = req.valid.query;
  if (matricule) {
    const m = await cartes.modeleActif();
    if (m && !m.verification_matricule) throw forbidden('La vérification par matricule n’est pas ouverte : scannez le QR code de la carte.', 'VERIFICATION_MATRICULE_FERMEE');
  }
  res.setHeader('Cache-Control', 'no-store');
  res.json(await cartes.verificationPublique({ jeton, matricule }, { ip: req.ip, userAgent: req.headers['user-agent'] }));
});

module.exports = router;

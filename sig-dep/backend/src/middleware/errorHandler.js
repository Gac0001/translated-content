'use strict';
const { ZodError } = require('zod');
const multer = require('multer');
const { AppError } = require('../utils/errors');
const config = require('../config/env');
const erreurs = require('../services/erreurs');

function zodMessage(err) {
  return err.issues.map((i) => {
    const champ = i.path.join('.') || 'donnée';
    return `${champ} : ${i.message}`;
  });
}

// eslint-disable-next-line no-unused-vars
module.exports = function errorHandler(err, req, res, next) {
  if (err instanceof AppError) {
    return res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
  }
  if (err instanceof ZodError) {
    const details = zodMessage(err);
    return res.status(400).json({ error: { code: 'VALIDATION', message: `Données invalides : ${details.join(' ; ')}`, details } });
  }
  if (err instanceof multer.MulterError) {
    const message = err.code === 'LIMIT_FILE_SIZE'
      ? `Fichier trop volumineux (maximum ${Math.round(config.maxUploadBytes / 1048576)} Mo).`
      : `Erreur de téléversement : ${err.message}`;
    return res.status(400).json({ error: { code: 'FICHIER_INVALIDE', message } });
  }
  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: { code: 'JSON_INVALIDE', message: 'Le corps de la requête n’est pas un JSON valide.' } });
  }
  // Erreurs PostgreSQL
  if (err && typeof err.code === 'string' && /^[0-9A-Z]{5}$/.test(err.code)) {
    const msg = String(err.message || '');
    const custom = msg.match(/(SECRETARIAT_DIVISION_PERMISSION|PRESENCE_LOCKED|APPEND_ONLY): (.*)$/m);
    if (custom) {
      return res.status(custom[1] === 'SECRETARIAT_DIVISION_PERMISSION' ? 403 : 409)
        .json({ error: { code: custom[1], message: custom[2] } });
    }
    const map = {
      23505: [409, 'DOUBLON', 'Cette valeur existe déjà (doublon).'],
      23503: [409, 'REFERENCE', 'Opération impossible : l’élément est référencé ou la référence est invalide.'],
      23514: [400, 'CONTRAINTE', 'Opération refusée par une règle d’intégrité de l’organisation.'],
      23502: [400, 'CHAMP_REQUIS', 'Un champ obligatoire est manquant.'],
      '22P02': [400, 'FORMAT', 'Format de donnée invalide.'],
    };
    const m = map[err.code];
    if (m) return res.status(m[0]).json({ error: { code: m[1], message: m[2], details: config.isProd ? undefined : err.detail || err.constraint } });
  }
  if (!config.isTest) console.error('[ERREUR]', err);
  erreurs.enregistrer(err, req); // journal technique (sans attendre)
  return res.status(500).json({ error: { code: 'ERREUR_INTERNE', message: 'Une erreur interne est survenue. Veuillez réessayer ou contacter l’administrateur.' } });
};

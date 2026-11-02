'use strict';
/**
 * Stockage sécurisé des pièces jointes : fichiers enregistrés hors de toute racine publique,
 * sous un nom aléatoire, avec contrôle du type et de la taille, empreinte SHA-256.
 * Le téléchargement passe toujours par une route authentifiée vérifiant le périmètre.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const config = require('../config/env');
const { badRequest } = require('../utils/errors');

const ALLOWED = {
  'application/pdf': '.pdf',
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'application/msword': '.doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.ms-excel': '.xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  'application/vnd.ms-powerpoint': '.ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
  'text/plain': '.txt',
  'text/csv': '.csv',
  'application/zip': '.zip',
};
const IMAGES = ['image/jpeg', 'image/png', 'image/webp'];

fs.mkdirSync(config.uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, config.uploadDir),
  filename: (req, file, cb) => cb(null, `${crypto.randomUUID()}${ALLOWED[file.mimetype] || '.bin'}`),
});

function makeUpload({ imagesOnly = false } = {}) {
  return multer({
    storage,
    limits: { fileSize: config.maxUploadBytes, files: 10 },
    fileFilter: (req, file, cb) => {
      const ok = imagesOnly ? IMAGES.includes(file.mimetype) : !!ALLOWED[file.mimetype];
      if (!ok) return cb(badRequest(imagesOnly ? 'Format d’image non autorisé (JPEG, PNG ou WebP).' : `Type de fichier non autorisé : ${file.mimetype}.`));
      return cb(null, true);
    },
  });
}

function sha256File(p) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    fs.createReadStream(p).on('data', (d) => h.update(d)).on('end', () => resolve(h.digest('hex'))).on('error', reject);
  });
}

function safePath(storedName) {
  const p = path.resolve(config.uploadDir, path.basename(storedName));
  if (!p.startsWith(path.resolve(config.uploadDir))) throw badRequest('Chemin invalide.');
  return p;
}

function removeQuiet(storedName) {
  try { fs.unlinkSync(safePath(storedName)); } catch (e) { /* ignore */ }
}

module.exports = { makeUpload, sha256File, safePath, removeQuiet, ALLOWED, IMAGES };

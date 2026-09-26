'use strict';
const crypto = require('crypto');
const { z } = require('zod');

const passwordSchema = z.string()
  .min(8, 'au moins 8 caractères')
  .max(128, '128 caractères au maximum')
  .regex(/[A-Za-z]/, 'doit contenir au moins une lettre')
  .regex(/[0-9]/, 'doit contenir au moins un chiffre')
  .regex(/[^A-Za-z0-9]/, 'doit contenir au moins un caractère spécial');

/** Mot de passe temporaire lisible (lettres, chiffres, caractère spécial). */
function temporaryPassword() {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz';
  const digits = '23456789';
  let p = '';
  for (let i = 0; i < 6; i++) p += letters[crypto.randomInt(letters.length)];
  for (let i = 0; i < 3; i++) p += digits[crypto.randomInt(digits.length)];
  return `${p}@`;
}

module.exports = { passwordSchema, temporaryPassword };

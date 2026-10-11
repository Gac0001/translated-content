'use strict';
/**
 * Double authentification par application (TOTP, RFC 6238 : Google / Microsoft Authenticator…)
 * et codes de secours à usage unique.
 * Le secret TOTP est chiffré en base (AES-256-GCM) ; les codes de secours sont hachés.
 */
const crypto = require('crypto');
const { authenticator } = require('otplib');
const QRCode = require('qrcode');
const db = require('../db/knex');
const config = require('../config/env');

authenticator.options = { window: 1 }; // tolère ±30 s de décalage d’horloge

const ISSUER = 'SIG-DEP (DEP)';
const cle = () => crypto.createHash('sha256').update(process.env.TOTP_ENC_KEY || `${config.jwt.accessSecret}:totp`).digest();

function chiffrer(texte) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', cle(), iv);
  const enc = Buffer.concat([c.update(texte, 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), enc].map((b) => b.toString('base64')).join('.');
}

function dechiffrer(v) {
  const [iv, tag, enc] = String(v).split('.').map((x) => Buffer.from(x, 'base64'));
  const d = crypto.createDecipheriv('aes-256-gcm', cle(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString('utf8');
}

const sha256 = (v) => crypto.createHash('sha256').update(v).digest('hex');
const normaliserCode = (c) => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

/** Prépare un nouveau secret (non actif tant qu’un code n’a pas été confirmé). */
async function preparer(user) {
  const secret = authenticator.generateSecret(20);
  await db('users').where({ id: user.id }).update({ totp_secret: chiffrer(secret) });
  const otpauth = authenticator.keyuri(user.username, ISSUER, secret);
  return { secret, otpauth, qr: await QRCode.toDataURL(otpauth, { margin: 1, width: 220 }) };
}

function verifierTotp(user, code) {
  if (!user.totp_secret) return false;
  const c = String(code || '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(c)) return false;
  try { return authenticator.check(c, dechiffrer(user.totp_secret)); } catch (e) { return false; }
}

/** Génère 10 nouveaux codes de secours (les anciens sont invalidés). */
async function genererCodesSecours(userId, trx = db) {
  const alpha = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const codes = Array.from({ length: 10 }, () => {
    let s = ''; for (let i = 0; i < 8; i++) s += alpha[crypto.randomInt(alpha.length)];
    return `${s.slice(0, 4)}-${s.slice(4)}`;
  });
  await trx('codes_secours').where({ user_id: userId }).del();
  await trx('codes_secours').insert(codes.map((c) => ({ user_id: userId, code_hash: sha256(normaliserCode(c)) })));
  return codes;
}

/** Consomme un code de secours ; renvoie le nombre de codes restants, ou null s’il est invalide. */
async function utiliserCodeSecours(userId, code) {
  const n = normaliserCode(code);
  if (n.length !== 8) return null;
  const row = await db('codes_secours').where({ user_id: userId, code_hash: sha256(n) }).whereNull('utilise_at').first();
  if (!row) return null;
  await db('codes_secours').where({ id: row.id }).update({ utilise_at: db.fn.now() });
  return Number((await db('codes_secours').where({ user_id: userId }).whereNull('utilise_at').count('* as n').first()).n);
}

/** Vérifie un second facteur : code de l’application ou code de secours. */
async function verifierSecondFacteur(user, code) {
  if (verifierTotp(user, code)) return { ok: true, methode: 'TOTP' };
  const restants = await utiliserCodeSecours(user.id, code);
  if (restants !== null) return { ok: true, methode: 'CODE_SECOURS', restants };
  return { ok: false };
}

module.exports = { preparer, verifierTotp, genererCodesSecours, utiliserCodeSecours, verifierSecondFacteur, chiffrer, dechiffrer, sha256 };

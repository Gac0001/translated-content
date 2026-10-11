'use strict';
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const { z } = require('zod');
const db = require('../db/knex');
const { politique } = require('../services/politique');
const { AppError } = require('./errors');

/** Contrôle de forme : la politique (longueur, complexité, historique) est vérifiée par `verifierPolitique`. */
const passwordSchema = z.string().min(1, 'mot de passe requis').max(128, '128 caractères au maximum');

// Mots de passe trop courants ou propres au contexte (comparaison sans casse ni chiffres finaux).
const COURANTS = [
  'password', 'motdepasse', 'azerty', 'qwerty', 'admin', 'administrateur', 'administrator', 'bonjour', 'soleil', 'welcome',
  'letmein', 'iloveyou', 'abc123', 'sigdep', 'sig-dep', 'dep', 'demo', 'congo', 'kinshasa', 'rdc', 'drc', 'direction',
  'secretariat', 'planification', 'economie', 'numerique', 'changeme', 'test', 'utilisateur', 'user', 'root',
];

function trop_courant(pwd, username) {
  const base = pwd.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z]/g, '');
  if (base.length < 4) return true; // presque uniquement des chiffres ou symboles
  if (COURANTS.includes(base)) return true;
  if (/^(.)\1+$/.test(base) || /^(abc|qwe|aze)/.test(base) && base.length <= 6) return true;
  if (username && base.includes(username.toLowerCase().replace(/[^a-z]/g, '')) && username.replace(/[^a-z]/gi, '').length >= 3) return true;
  return false;
}

/** Règles en vigueur, lisibles par l’utilisateur. */
async function reglesLisibles() {
  const p = await politique();
  return [
    `au moins ${p.mdp_longueur_min} caractères`,
    p.mdp_exiger_majuscule && 'une majuscule', p.mdp_exiger_minuscule && 'une minuscule',
    p.mdp_exiger_chiffre && 'un chiffre', p.mdp_exiger_special && 'un caractère spécial',
    p.mdp_historique > 0 && `différent des ${p.mdp_historique} derniers`,
    'ni courant, ni dérivé du nom d’utilisateur',
  ].filter(Boolean);
}

/** Vérifie un nouveau mot de passe contre la politique ; lève une erreur 400 explicite sinon. */
async function verifierPolitique(pwd, user) {
  const p = await politique();
  const erreurs = [];
  if (pwd.length < p.mdp_longueur_min) erreurs.push(`au moins ${p.mdp_longueur_min} caractères`);
  if (p.mdp_exiger_majuscule && !/[A-Z]/.test(pwd)) erreurs.push('au moins une majuscule');
  if (p.mdp_exiger_minuscule && !/[a-z]/.test(pwd)) erreurs.push('au moins une minuscule');
  if (p.mdp_exiger_chiffre && !/[0-9]/.test(pwd)) erreurs.push('au moins un chiffre');
  if (p.mdp_exiger_special && !/[^A-Za-z0-9]/.test(pwd)) erreurs.push('au moins un caractère spécial');
  if (trop_courant(pwd, user && user.username)) erreurs.push('ne doit être ni courant ni dérivé du nom d’utilisateur');
  if (erreurs.length) throw new AppError(400, 'MOT_DE_PASSE_NON_CONFORME', `Mot de passe non conforme : ${erreurs.join(', ')}.`);
  if (user && p.mdp_historique > 0) {
    const anciens = await db('historique_mots_de_passe').where({ user_id: user.id }).orderBy('id', 'desc').limit(p.mdp_historique).pluck('password_hash');
    if (user.password_hash && !anciens.includes(user.password_hash)) anciens.unshift(user.password_hash);
    for (const h of anciens.slice(0, Math.max(p.mdp_historique, 1))) {
      if (await bcrypt.compare(pwd, h)) throw new AppError(400, 'MOT_DE_PASSE_DEJA_UTILISE', `Ce mot de passe a déjà été utilisé : choisissez-en un différent des ${p.mdp_historique} derniers.`);
    }
  }
}

/** Enregistre le nouveau mot de passe dans l’historique (conservation limitée). */
async function historiser(userId, hash, trx = db) {
  await trx('historique_mots_de_passe').insert({ user_id: userId, password_hash: hash });
  const garder = await trx('historique_mots_de_passe').where({ user_id: userId }).orderBy('id', 'desc').limit(24).pluck('id');
  await trx('historique_mots_de_passe').where({ user_id: userId }).whereNotIn('id', garder).del();
}

/** Mot de passe temporaire lisible (majuscules, minuscules, chiffres, caractère spécial). */
function temporaryPassword() {
  const up = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; const low = 'abcdefghijkmnpqrstuvwxyz'; const digits = '23456789';
  let p = up[crypto.randomInt(up.length)];
  for (let i = 0; i < 6; i++) p += low[crypto.randomInt(low.length)];
  for (let i = 0; i < 4; i++) p += digits[crypto.randomInt(digits.length)];
  return `${p}@`;
}

module.exports = { passwordSchema, temporaryPassword, verifierPolitique, historiser, reglesLisibles };

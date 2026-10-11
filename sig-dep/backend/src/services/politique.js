'use strict';
/**
 * Politique de sécurité configurable (table parametres) : mots de passe, verrouillage,
 * sessions, comptes inactifs. Lecture mise en cache quelques secondes.
 */
const db = require('../db/knex');

const DEFAUTS = {
  mdp_longueur_min: 10, mdp_exiger_majuscule: true, mdp_exiger_minuscule: true, mdp_exiger_chiffre: true, mdp_exiger_special: true,
  mdp_historique: 5, mdp_expiration_jours: 0, verrouillage_tentatives: 5, verrouillage_minutes: 15,
  session_duree_jours: 7, session_inactivite_minutes: 30, inactivite_compte_jours: 90, inactivite_desactivation_auto: false,
  alerte_echecs_seuil: 10, regles_securite_version: 1,
  disque_seuil_attention: 15, disque_seuil_critique: 5, erreurs_conservation_jours: 90,
  sauvegarde_auto: true, sauvegarde_heure: '01:00', retention_quotidienne: 7, retention_hebdomadaire: 4, retention_mensuelle: 12,
  retention_ponctuelle_jours: 90, test_restauration_auto: true, test_restauration_jour: 0,
};

/** Bornes acceptées pour chaque paramètre numérique (garde-fous contre une politique affaiblie). */
const BORNES = {
  mdp_longueur_min: [8, 64], mdp_historique: [0, 24], mdp_expiration_jours: [0, 365], verrouillage_tentatives: [3, 10],
  verrouillage_minutes: [5, 1440], session_duree_jours: [1, 30], session_inactivite_minutes: [5, 240],
  inactivite_compte_jours: [30, 730], alerte_echecs_seuil: [3, 100], regles_securite_version: [1, 1000],
  disque_seuil_attention: [5, 50], disque_seuil_critique: [1, 30], erreurs_conservation_jours: [30, 365],
  retention_quotidienne: [3, 60], retention_hebdomadaire: [0, 52], retention_mensuelle: [0, 120], retention_ponctuelle_jours: [7, 3650],
  test_restauration_jour: [0, 6],
};

let cache = null; let cacheAt = 0;

function convertir(cle, v) {
  if (typeof DEFAUTS[cle] === 'boolean') return v === 'true' || v === true;
  if (typeof DEFAUTS[cle] === 'number') { const n = Number(v); return Number.isFinite(n) ? n : DEFAUTS[cle]; }
  return v;
}

async function politique(trx = db) {
  if (cache && Date.now() - cacheAt < 5000 && trx === db) return cache;
  const rows = await trx('parametres').whereIn('cle', Object.keys(DEFAUTS));
  const p = { ...DEFAUTS };
  for (const r of rows) p[r.cle] = convertir(r.cle, r.valeur);
  if (trx === db) { cache = p; cacheAt = Date.now(); }
  return p;
}

function invalider() { cache = null; }

module.exports = { politique, invalider, DEFAUTS, BORNES, convertir };

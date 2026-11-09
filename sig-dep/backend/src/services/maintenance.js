'use strict';
/**
 * Mode maintenance : seuls les Admins Système accèdent à l’application ; les autres
 * utilisateurs reçoivent une réponse 503 avec le message et la fin prévue.
 * L’état est en base (paramètres) ; une opération en cours (restauration) peut l’imposer en mémoire.
 */
const db = require('../db/knex');

let cache = null; let cacheAt = 0;
let force = null; // { message, fin } imposé pendant une opération critique

async function etat() {
  if (force) return { active: true, message: force.message, fin: force.fin, operation: true };
  if (cache && Date.now() - cacheAt < 3000) return cache;
  try {
    const rows = await db('parametres').whereIn('cle', ['maintenance_active', 'maintenance_message', 'maintenance_fin']);
    const p = Object.fromEntries(rows.map((r) => [r.cle, r.valeur]));
    cache = { active: p.maintenance_active === 'true', message: p.maintenance_message || '', fin: p.maintenance_fin || '' };
  } catch (e) {
    cache = { active: false, message: '', fin: '' };
  }
  cacheAt = Date.now();
  return cache;
}

async function definir({ active, message = '', fin = '' }, userId = null) {
  for (const [cle, valeur] of [['maintenance_active', String(!!active)], ['maintenance_message', message || ''], ['maintenance_fin', fin || '']]) {
    await db('parametres').where({ cle }).update({ valeur, updated_at: db.fn.now(), updated_by: userId });
  }
  cache = null;
  return etat();
}

function imposer(message, fin = '') { force = { message, fin }; cache = null; }
function lever() { force = null; cache = null; }
const operationEnCours = () => !!force;

module.exports = { etat, definir, imposer, lever, operationEnCours };

'use strict';
/** Références administratives séquentielles par année : ex. DEP/INS/2026/0007. */
const db = require('../db/knex');

async function nextReference(cle, prefix, trx = db, date = new Date()) {
  const annee = date.getFullYear();
  const r = await trx.raw(
    `INSERT INTO sequences (cle, annee, valeur) VALUES (?, ?, 1)
     ON CONFLICT (cle, annee) DO UPDATE SET valeur = sequences.valeur + 1 RETURNING valeur`,
    [cle, annee],
  );
  const n = r.rows[0].valeur;
  return `${prefix}/${annee}/${String(n).padStart(4, '0')}`;
}

module.exports = { nextReference };

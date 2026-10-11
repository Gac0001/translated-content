'use strict';
const knex = require('knex');
const { types } = require('pg');
const knexfile = require('../../knexfile');
const config = require('../config/env');

// Les colonnes DATE sont renvoyées telles quelles (AAAA-MM-JJ) pour éviter tout décalage de fuseau horaire.
types.setTypeParser(1082, (v) => v);
// Les montants NUMERIC sont renvoyés en nombre.
types.setTypeParser(1700, (v) => (v === null ? null : Number(v)));

const db = knex(knexfile[config.env] || knexfile.development);
module.exports = db;

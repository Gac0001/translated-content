'use strict';
// Express 5 transmet nativement les rejets de promesses ; ce wrapper reste utile pour la lisibilité.
module.exports = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

'use strict';
/**
 * Validation Zod des entrées (body, query, params). Les valeurs validées
 * remplacent les valeurs brutes dans req.valid.{body,query,params}.
 */
module.exports = (schemas) => (req, res, next) => {
  req.valid = req.valid || {};
  for (const key of ['params', 'query', 'body']) {
    if (schemas[key]) req.valid[key] = schemas[key].parse(req[key] ?? {});
  }
  next();
};

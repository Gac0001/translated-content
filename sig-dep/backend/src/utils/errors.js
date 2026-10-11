'use strict';

class AppError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

module.exports = {
  AppError,
  badRequest: (message, details) => new AppError(400, 'REQUETE_INVALIDE', message, details),
  unauthorized: (message = 'Authentification requise.', code = 'NON_AUTHENTIFIE') => new AppError(401, code, message),
  forbidden: (message = 'Vous n’êtes pas autorisé à effectuer cette opération.', code = 'ACCES_REFUSE') => new AppError(403, code, message),
  notFound: (message = 'Élément introuvable.') => new AppError(404, 'INTROUVABLE', message),
  conflict: (message, code = 'CONFLIT') => new AppError(409, code, message),
};

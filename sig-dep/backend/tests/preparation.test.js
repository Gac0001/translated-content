'use strict';
/**
 * Contrôle de préparation à la mise en production : constats sans secret, points bloquants détectés,
 * consultation réservée à la supervision du système.
 */
const bcrypt = require('bcrypt');
const { db, login, loginAdmin, api } = require('./helpers');
const { verifier, MOT_DE_PASSE_ADMIN_INITIAL } = require('../src/services/preparation');

const statut = (r, cle) => r.controles.find((c) => c.cle === cle)?.statut;

describe('Contrôle de préparation à la mise en production', () => {
  test('hors production : non prêt, environnement signalé comme bloquant', async () => {
    const r = await verifier();
    expect(r.pret).toBe(false);
    expect(statut(r, 'environnement')).toBe('BLOQUANT');
    expect(statut(r, 'connexion')).toBe('OK');
    expect(statut(r, 'migrations')).toBe('OK');
    expect(r.totaux.BLOQUANT).toBe(r.controles.filter((c) => c.statut === 'BLOQUANT').length);
    // Chaque point non conforme dit quoi faire ; aucun secret n’est renvoyé.
    expect(r.controles.filter((c) => ['ATTENTION', 'BLOQUANT'].includes(c.statut)).every((c) => c.conseil)).toBe(true);
    expect(JSON.stringify(r)).not.toContain(require('../src/config/env').jwt.accessSecret);
  });

  test('secret des jetons d’exemple ou trop court : bloquant', async () => {
    const config = require('../src/config/env');
    const avant = config.jwt.accessSecret;
    try {
      for (const faible of ['remplacer-par-un-secret-long-et-aleatoire-acces', 'court']) {
        config.jwt.accessSecret = faible;
        expect(statut(await verifier(), 'secret_jwt')).toBe('BLOQUANT');
      }
      config.jwt.accessSecret = 'a'.repeat(96);
      expect(statut(await verifier(), 'secret_jwt')).toBe('OK');
    } finally {
      config.jwt.accessSecret = avant;
    }
  });

  test('le mot de passe initial publié de l’Admin est bloquant', async () => {
    await loginAdmin();
    const admin = await db('users').where({ username: 'admin' }).first();
    try {
      await db('users').where({ id: admin.id }).update({ password_hash: await bcrypt.hash(MOT_DE_PASSE_ADMIN_INITIAL, 4) });
      expect(statut(await verifier(), 'admin')).toBe('BLOQUANT');
    } finally {
      await db('users').where({ id: admin.id }).update({ password_hash: admin.password_hash });
    }
    expect(statut(await verifier(), 'admin')).not.toBe('BLOQUANT');
  });

  test('consultable par l’Admin (page Santé), refusé aux autres rôles', async () => {
    const admin = api(await loginAdmin());
    const r = await admin.get('/supervision/preparation');
    expect(r.status).toBe(200);
    expect(r.body.groupes.sauvegardes).toBe('Sauvegardes');
    expect((await api(await login('directeur')).get('/supervision/preparation')).status).toBe(403);
  });
});

'use strict';
/**
 * Service unique : l’API sert l’interface construite (FRONTEND_DIR) — pages de l’application renvoyées
 * vers index.html, fichiers versionnés en cache long, API inchangée, politique de sécurité adaptée au HTTP
 * du réseau local, adresse IP non falsifiable sans proxy.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const request = require('supertest');

describe('Service unique (interface servie par l’API)', () => {
  let app; let dist;
  const avant = { ...process.env };
  beforeAll(() => {
    dist = fs.mkdtempSync(path.join(os.tmpdir(), 'sigdep-dist-'));
    fs.mkdirSync(path.join(dist, 'assets'));
    fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html><title>SIG-DEP</title><div id="root"></div>');
    fs.writeFileSync(path.join(dist, 'assets', 'index-abc123.js'), 'console.log(1)');
    Object.assign(process.env, { FRONTEND_DIR: dist, TRUST_PROXY: '0', APP_URL: 'http://192.168.1.10:4000' });
    jest.isolateModules(() => { app = require('../src/app'); });
  });
  afterAll(() => { process.env = avant; fs.rmSync(dist, { recursive: true, force: true }); });

  test('pages de l’application → index.html, jamais mis en cache', async () => {
    for (const url of ['/', '/connexion', '/reunions/12', '/planification/ptba/3?onglet=execution']) {
      const r = await request(app).get(url);
      expect(r.status).toBe(200);
      expect(r.text).toContain('<div id="root">');
      expect(r.headers['cache-control']).toBe('no-cache');
    }
  });

  test('fichiers versionnés en cache long ; fichier absent → 404 (pas la page d’accueil)', async () => {
    const r = await request(app).get('/assets/index-abc123.js');
    expect(r.status).toBe(200);
    expect(r.headers['cache-control']).toMatch(/max-age=31536000.*immutable/);
    expect((await request(app).get('/assets/absent.js')).status).toBe(404);
  });

  test('l’API répond toujours en JSON', async () => {
    expect((await request(app).get('/api/health')).body.statut).toBe('ok');
    const r = await request(app).get('/api/inexistant');
    expect(r.status).toBe(404);
    expect(r.body.error.code).toBe('INTROUVABLE');
  });

  test('sécurité : pas de « upgrade-insecure-requests » en HTTP local, aperçus blob autorisés, proxy non cru', async () => {
    const csp = (await request(app).get('/')).headers['content-security-policy'];
    expect(csp).not.toContain('upgrade-insecure-requests');
    expect(csp).toMatch(/img-src 'self' data: blob:/);
    expect(app.get('trust proxy')).toBe(false);
  });
});

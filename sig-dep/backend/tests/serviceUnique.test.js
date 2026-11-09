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
    fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html><html><head><title>SIG-DEP</title></head><body><div id="root"></div></body></html>');
    fs.writeFileSync(path.join(dist, 'assets', 'index-abc123.js'), 'console.log(1)');
    Object.assign(process.env, { FRONTEND_DIR: dist, TRUST_PROXY: '0', APP_URL: 'http://192.168.1.10:4000', PUBLIC_URL: 'https://sig-dep.exemple.cd', DEMO_MODE: 'false' });
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

  test('référencement : seules la connexion et la vérification des cartes sont indexables', async () => {
    const connexion = await request(app).get('/connexion');
    expect(connexion.headers['x-robots-tag']).toBeUndefined();
    expect(connexion.text).toContain('<link rel="canonical" href="https://sig-dep.exemple.cd/connexion" />');
    expect(connexion.text).not.toContain('noindex');
    expect((await request(app).get('/verification/')).text).toContain('href="https://sig-dep.exemple.cd/verification"');
    // Pages internes et vérification d’une carte précise (données personnelles) : jamais indexées
    for (const url of ['/', '/reunions/12', '/verification/c/abcdefghijklmnop', '/maintenance']) {
      const r = await request(app).get(url);
      expect(r.headers['x-robots-tag']).toBe('noindex, nofollow');
      expect(r.text).toContain('<meta name="robots" content="noindex, nofollow" />');
      expect(r.text).not.toContain('canonical');
    }
    const robots = await request(app).get('/robots.txt');
    expect(robots.headers['content-type']).toMatch(/text\/plain/);
    expect(robots.text).toMatch(/Allow: \/connexion\$\nAllow: \/verification\$/);
    expect(robots.text).toContain('Disallow: /\n');
    expect(robots.text).toContain('Sitemap: https://sig-dep.exemple.cd/sitemap.xml');
    const plan = await request(app).get('/sitemap.xml');
    expect(plan.headers['content-type']).toMatch(/xml/);
    expect(plan.text.match(/<loc>/g)).toHaveLength(2);
    expect(plan.text).toContain('<loc>https://sig-dep.exemple.cd/verification</loc>');
  });

  test('référencement : un environnement de démonstration n’est jamais indexé', async () => {
    let demo;
    process.env.DEMO_MODE = 'true';
    jest.isolateModules(() => { demo = require('../src/app'); });
    process.env.DEMO_MODE = 'false';
    expect((await request(demo).get('/robots.txt')).text).toBe('User-agent: *\nDisallow: /\n');
    expect((await request(demo).get('/sitemap.xml')).text).not.toContain('<loc>');
    const r = await request(demo).get('/connexion');
    expect(r.headers['x-robots-tag']).toBe('noindex, nofollow');
    expect(r.text).not.toContain('canonical');
  });
});

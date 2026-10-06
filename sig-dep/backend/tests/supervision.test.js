'use strict';
/**
 * Lot 2 — Supervision : tableau de bord Admin, centre de santé, journal technique,
 * registre des sauvegardes, rapports mensuels de sécurité, alertes critiques au Directeur.
 */
const config = require('../src/config/env');
const errorHandler = require('../src/middleware/errorHandler');
const { invalider } = require('../src/services/politique');
const sante = require('../src/services/sante');
const { creerSauvegarde, etatSauvegardes } = require('../src/services/sauvegarde');
const rapports = require('../src/services/rapportSecurite');
const { db, login, loginAdmin, api, userId } = require('./helpers');

const attendre = (ms) => new Promise((r) => setTimeout(r, ms));

describe('Supervision du système', () => {
  let admin;
  beforeAll(async () => { admin = api(await loginAdmin()); });

  test('tableau de bord Admin : indicateurs du cahier des charges', async () => {
    const d = (await admin.get('/dashboard')).body.admin;
    expect(d.comptes).toEqual(expect.objectContaining({ total: expect.any(Number), actifs: expect.any(Number), desactives: expect.any(Number), verrouilles: expect.any(Number), inactifs: expect.any(Number) }));
    expect(d.securite).toEqual(expect.objectContaining({ sessionsActives: expect.any(Number), echecsConnexion24h: expect.any(Number), alertes: expect.objectContaining({ CRITIQUE: expect.any(Number) }) }));
    expect(d.systeme.version.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(d.systeme.disque.pourcentLibre).toBeGreaterThan(0);
    expect(d.sauvegardes).toHaveProperty('echecs30j');
    expect(d.erreurs).toHaveProperty('ouvertes');
    expect(Array.isArray(d.operationsSensibles)).toBe(true);
    expect((await api(await login('directeur')).get('/dashboard')).body.admin).toBeUndefined();
  });

  test('centre de santé : contrôle de chaque composant, historique, accès réservé', async () => {
    const r = await admin.post('/supervision/sante/verifier');
    expect(r.status).toBe(200);
    expect(Object.keys(r.body.composants).sort()).toEqual(['api', 'courriels', 'documents', 'postgresql', 'sauvegarde', 'stockage']);
    expect(r.body.composants.postgresql.statut).toBe('OK');
    expect(r.body.composants.documents.statut).toBe('OK');
    expect(r.body.composants.courriels.statut).toBe(config.mail.enabled ? expect.any(String) : 'INACTIF');
    const g = await admin.get('/supervision/sante');
    expect(g.body.dernier.global).toBe(r.body.global);
    expect(g.body.historique.length).toBeGreaterThanOrEqual(1);
    expect((await api(await login('directeur')).get('/supervision/sante')).status).toBe(403);
  });

  test('panne puis rétablissement : alertes, et le Directeur est informé des incidents critiques', async () => {
    await sante.controler('MANUEL'); // état de référence
    // Seuil critique d’espace disque volontairement irréaliste (99 % libres exigés)
    await db('parametres').where({ cle: 'disque_seuil_critique' }).update({ valeur: '99.9' });
    invalider();
    const panne = await sante.controler('MANUEL');
    expect(panne.composants.stockage.statut).toBe('PANNE');
    expect(panne.global).toBe('PANNE');
    const alerte = await db('alertes_securite').where({ type: 'SANTE_PANNE' }).orderBy('id', 'desc').first();
    expect(alerte).toMatchObject({ gravite: 'CRITIQUE', titre: 'Stockage en panne' });
    const dir = await userId('directeur');
    expect(await db('notifications').where({ user_id: dir, type: 'SECURITE' }).whereILike('titre', '%Stockage en panne%').first()).toBeTruthy();
    await db('parametres').where({ cle: 'disque_seuil_critique' }).update({ valeur: '5' });
    invalider();
    const ok = await sante.controler('MANUEL');
    expect(ok.composants.stockage.statut).not.toBe('PANNE');
    expect(await db('alertes_securite').where({ type: 'SANTE_RETABLI' }).whereILike('titre', 'Stockage%').first()).toBeTruthy();
  });

  test('journal technique : erreurs 500 regroupées, résolution', async () => {
    const res = { status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
    const req = (n) => ({ method: 'GET', originalUrl: `/api/essai/${n}/detail?x=1`, ip: '10.0.0.9', ctx: null });
    errorHandler(new Error('Panne simulée n° 41'), req(12), res, () => {});
    expect(res.code).toBe(500);
    expect(res.body.error.message).not.toMatch(/Panne simulée/); // aucun détail technique pour l’utilisateur
    errorHandler(new Error('Panne simulée n° 42'), req(13), res, () => {});
    await attendre(300);
    const l = await admin.get('/supervision/erreurs');
    const e = l.body.data.find((x) => x.route === '/api/essai/:id/detail');
    expect(e).toMatchObject({ methode: 'GET', occurrences: 2 });
    expect((await admin.get(`/supervision/erreurs/${e.id}`)).body.pile).toMatch(/Panne simulée/);
    expect((await api(await login('directeur')).get('/supervision/erreurs')).status).toBe(403);
    expect((await admin.post(`/supervision/erreurs/${e.id}/resoudre`, { commentaire: 'Corrigé' })).status).toBe(200);
    expect((await admin.post(`/supervision/erreurs/${e.id}/resoudre`, {})).status).toBe(400);
    // Une nouvelle occurrence ouvre un nouveau groupe
    errorHandler(new Error('Panne simulée n° 43'), req(14), res, () => {});
    await attendre(300);
    expect(await db('erreurs_techniques').where({ route: '/api/essai/:id/detail' }).count('* as n').first()).toEqual({ n: '2' });
  });

  test('registre des sauvegardes : un échec est enregistré et signalé', async () => {
    const chemin = config.pgDumpPath;
    config.pgDumpPath = '/chemin/inexistant/pg_dump';
    try {
      await expect(creerSauvegarde('', { origine: 'MANUELLE', user: { id: null, username: 'test' } })).rejects.toThrow(/pg_dump est introuvable/);
    } finally { config.pgDumpPath = chemin; }
    const s = await etatSauvegardes();
    expect(s.echecs30j).toBeGreaterThanOrEqual(1);
    expect(s.derniereTentative.statut).toBe('ECHEC');
    expect(await db('alertes_securite').where({ type: 'SAUVEGARDE_ECHEC' }).first()).toBeTruthy();
    const h = await admin.get('/systeme/sauvegardes');
    expect(h.body.historique[0]).toMatchObject({ statut: 'ECHEC', origine: 'MANUELLE' });
  });
});

describe('Rapports mensuels de sécurité', () => {
  let admin;
  beforeAll(async () => { admin = api(await loginAdmin()); });

  test('génération à la demande, consultation par le Directeur, PDF tracé', async () => {
    const now = new Date();
    const courant = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    expect((await admin.post('/supervision/rapports', { periode: '2099-01' })).status).toBe(400);
    expect((await admin.post('/supervision/rapports', { periode: '2026-13' })).status).toBe(400);
    const r = await admin.post('/supervision/rapports', { periode: courant });
    expect(r.status).toBe(201);
    expect(r.body.donnees.connexions.reussies).toBeGreaterThan(0);
    expect(r.body.donnees.integriteAudit.integre).toBe(true);
    const dirToken = await login('directeur');
    const dir = api(dirToken);
    const liste = await dir.get('/supervision/rapports');
    expect(liste.status).toBe(200);
    expect(liste.body.peutGenerer).toBe(false);
    expect(liste.body.data.find((x) => x.periode === courant)).toBeTruthy();
    expect((await dir.post('/supervision/rapports', { periode: courant })).status).toBe(403);
    const p = await dir.get(`/supervision/rapports/${courant}/pdf`);
    expect(p.status).toBe(200);
    expect(p.headers['content-type']).toMatch(/pdf/);
    expect(await db('notifications').where({ user_id: await userId('directeur'), lien: '/rapports-securite' }).first()).toBeTruthy();
    expect(await db('audit_logs').where({ action: 'EXPORT', entite: 'rapport', entite_id: courant }).first()).toBeTruthy();
    expect((await api(await login('ag.eap1')).get('/supervision/rapports')).status).toBe(403);
  });

  test('génération automatique du mois écoulé, une seule fois', async () => {
    const periode = rapports.moisPrecedent();
    await db('rapports_securite').where({ periode }).del();
    const d = await rapports.genererMoisEcoule();
    expect(d.periode).toBe(periode);
    expect(await rapports.genererMoisEcoule()).toBeNull();
    const row = await db('rapports_securite').where({ periode }).first();
    expect(row.genere_par).toBeNull();
    expect(row.genere_par_username).toBe('système');
  });
});

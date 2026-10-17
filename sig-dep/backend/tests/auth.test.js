'use strict';
const { app, db, request, login, api, userId, DEMO } = require('./helpers');

function cookieOf(res) {
  const c = (res.headers['set-cookie'] || []).find((x) => x.startsWith('sigdep_rt='));
  return c ? c.split(';')[0] : null;
}

describe('Authentification', () => {
  test('compte Admin initial : changement de mot de passe obligatoire', async () => {
    let res = await request(app).post('/api/auth/login').send({ username: 'admin', password: 'dep@2026' });
    if (res.status !== 200) return; // déjà modifié par un autre fichier de test
    expect(res.body.user.mustChangePassword).toBe(true);
    expect(res.headers['set-cookie'].join(';')).toMatch(/HttpOnly/);
    const token = res.body.accessToken;
    res = await request(app).get('/api/dashboard').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CHANGEMENT_MDP_REQUIS');
    res = await request(app).post('/api/auth/change-password').set('Authorization', `Bearer ${token}`).send({ currentPassword: 'dep@2026', newPassword: 'faible' });
    expect(res.status).toBe(400);
    res = await request(app).post('/api/auth/change-password').set('Authorization', `Bearer ${token}`).send({ currentPassword: 'dep@2026', newPassword: 'Admin@Sig2026!' });
    expect(res.status).toBe(200);
    expect(res.body.user.mustChangePassword).toBe(false);
    // L’ancien jeton est révoqué (token_version incrémenté)
    res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(401);
  });

  test('mot de passe incorrect : message compréhensible et historique', async () => {
    const res = await request(app).post('/api/auth/login').send({ username: 'directeur', password: 'mauvais' });
    expect(res.status).toBe(401);
    expect(res.body.error.message).toMatch(/incorrect/);
    const h = await db('login_history').where({ username: 'directeur', succes: false }).first();
    expect(h).toBeTruthy();
    await db('users').where({ username: 'directeur' }).update({ failed_attempts: 0 });
  });

  test('verrouillage après plusieurs échecs, puis déverrouillage automatique', async () => {
    for (let i = 0; i < 4; i++) await request(app).post('/api/auth/login').send({ username: 'ag.prg2', password: 'x' });
    let res = await request(app).post('/api/auth/login').send({ username: 'ag.prg2', password: 'x' });
    expect(res.status).toBe(423);
    res = await request(app).post('/api/auth/login').send({ username: 'ag.prg2', password: DEMO });
    expect(res.status).toBe(423);
    expect((await db('users').where({ username: 'ag.prg2' }).first()).statut).toBe('VERROUILLE');
    await db('users').where({ username: 'ag.prg2' }).update({ locked_until: db.raw(`now() - interval '1 minute'`) });
    res = await request(app).post('/api/auth/login').send({ username: 'ag.prg2', password: DEMO });
    expect(res.status).toBe(200);
    const audit = await db('audit_logs').where({ action: 'VERROUILLAGE' }).first();
    expect(audit).toBeTruthy();
  });

  test('refresh token : rotation et détection de réutilisation', async () => {
    const res = await request(app).post('/api/auth/login').send({ username: 'cb.eap', password: DEMO });
    const c1 = cookieOf(res);
    const r1 = await request(app).post('/api/auth/refresh').set('Cookie', c1);
    expect(r1.status).toBe(200);
    const c2 = cookieOf(r1);
    expect(c2).not.toBe(c1);
    // Réutilisation de l’ancien jeton : refusée, famille révoquée
    const r2 = await request(app).post('/api/auth/refresh').set('Cookie', c1);
    expect(r2.status).toBe(401);
    const r3 = await request(app).post('/api/auth/refresh').set('Cookie', c2);
    expect(r3.status).toBe(401);
  });

  test('déconnexion : le refresh token est révoqué', async () => {
    const res = await request(app).post('/api/auth/login').send({ username: 'cb.doi', password: DEMO });
    const c = cookieOf(res);
    await request(app).post('/api/auth/logout').set('Cookie', c);
    expect((await request(app).post('/api/auth/refresh').set('Cookie', c)).status).toBe(401);
  });

  test('compte désactivé : connexion refusée et sessions révoquées', async () => {
    const dir = api(await login('directeur'));
    const uid = await userId('ag.doi2');
    const token = await login('ag.doi2');
    expect((await dir.post(`/users/${uid}/desactiver`, { motif: 'Test' })).status).toBe(200);
    expect((await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`)).status).toBe(401);
    expect((await request(app).post('/api/auth/login').send({ username: 'ag.doi2', password: DEMO })).status).toBe(401);
    expect((await dir.post(`/users/${uid}/activer`)).status).toBe(200);
  });

  test('jeton absent ou invalide', async () => {
    expect((await request(app).get('/api/dashboard')).status).toBe(401);
    expect((await request(app).get('/api/dashboard').set('Authorization', 'Bearer abc')).status).toBe(401);
  });
});

'use strict';
const request = require('supertest');
const app = require('../src/app');
const db = require('../src/db/knex');

const DEMO = 'Demo@2026';
const ADMIN_NEW = 'Admin@Sig2026!';

async function login(username, password = DEMO) {
  const res = await request(app).post('/api/auth/login').send({ username, password });
  if (res.status !== 200) throw new Error(`Connexion impossible pour ${username} : ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.accessToken;
}

/** Connexion Admin quel que soit l’ordre d’exécution des tests (mot de passe initial ou modifié). */
async function loginAdmin() {
  let res = await request(app).post('/api/auth/login').send({ username: 'admin', password: 'dep@2026' });
  if (res.status === 200 && res.body.user.mustChangePassword) {
    const r2 = await request(app).post('/api/auth/change-password').set('Authorization', `Bearer ${res.body.accessToken}`).send({ currentPassword: 'dep@2026', newPassword: ADMIN_NEW });
    return r2.body.accessToken;
  }
  if (res.status !== 200) res = await request(app).post('/api/auth/login').send({ username: 'admin', password: ADMIN_NEW });
  return res.body.accessToken;
}

function api(token) {
  const wrap = (m) => (url, body) => {
    const r = request(app)[m](`/api${url}`).set('Authorization', `Bearer ${token}`);
    return body !== undefined ? r.send(body) : r;
  };
  return { get: wrap('get'), post: wrap('post'), put: wrap('put'), del: wrap('delete') };
}

async function userId(username) { return (await db('users').where({ username }).first()).id; }

module.exports = { app, db, request, login, loginAdmin, api, userId, DEMO, ADMIN_NEW };

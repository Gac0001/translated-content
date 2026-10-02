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

// Image PNG 1×1 et PDF minimal pour les pièces jointes de l’enrôlement.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const PDF = Buffer.from('%PDF-1.4\n%commission de test\n%%EOF\n');
let igapSeq = 0;

/** Enrôle un agent (création de son compte) avec des informations complémentaires valides par défaut. */
async function enroler(token, agentId, fields = {}) {
  const { photo = true, commission = true, ...rest } = fields;
  const data = {
    sexe: 'F', date_naissance: '1985-03-10', date_mise_en_service: '2010-01-04',
    numero_carte_igap: `IGAP-T${process.pid}-${++igapSeq}`, identite_confirmee: 'true', affectation_confirmee: 'true', ...rest,
  };
  if (data.fonction_id === undefined) {
    const ag = await db('agents').where({ id: agentId }).first();
    const f = ag && ag.grade_id ? await db('fonctions').where({ grade_id: ag.grade_id }).first() : null;
    if (f) data.fonction_id = f.id;
  }
  const r = request(app).post(`/api/enrolement/agents/${agentId}`).set('Authorization', `Bearer ${token}`);
  for (const [k, v] of Object.entries(data)) if (v !== undefined && v !== null) r.field(k, String(v));
  if (photo) r.attach('photo', PNG, { filename: 'photo.png', contentType: 'image/png' });
  if (commission) r.attach('commission', PDF, { filename: 'commission.pdf', contentType: 'application/pdf' });
  return r;
}

async function userId(username) { return (await db('users').where({ username }).first()).id; }

module.exports = { app, db, request, login, loginAdmin, api, userId, enroler, PNG, PDF, DEMO, ADMIN_NEW };

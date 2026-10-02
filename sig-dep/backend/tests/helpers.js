'use strict';
const request = require('supertest');
const app = require('../src/app');
const db = require('../src/db/knex');
const { authenticator } = require('otplib');
const { dechiffrer } = require('../src/services/deuxFacteurs');

const DEMO = 'Demo@2026';
const ADMIN_NEW = 'Kivu#Systeme2026';

async function login(username, password = DEMO) {
  const res = await request(app).post('/api/auth/login').send({ username, password });
  if (res.status !== 200) throw new Error(`Connexion impossible pour ${username} : ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.accessToken;
}

/** Code TOTP courant d’un compte (secret déchiffré depuis la base). */
async function codeTotp(username) {
  const u = await db('users').where({ username }).first();
  return authenticator.generate(dechiffrer(u.totp_secret));
}

/** Connexion complète (mot de passe puis second facteur si actif). Renvoie la réponse finale. */
async function connexion(username, password) {
  let res = await request(app).post('/api/auth/login').send({ username, password });
  if (res.status === 200 && res.body.deuxFacteurs) {
    res = await request(app).post('/api/auth/login/deux-facteurs').send({ defi: res.body.defi, code: await codeTotp(username) });
  }
  return res;
}

/** Termine les étapes de première connexion de l’Admin Système (2FA, récupération, règles). */
async function configurerSecurite(token) {
  const a = api(token);
  let me = (await a.get('/auth/me')).body.user;
  if (me.exigences.includes('DEUX_FACTEURS')) {
    const p = await a.post('/auth/2fa/preparer');
    await a.post('/auth/2fa/activer', { code: authenticator.generate(p.body.secret.replace(/\s/g, '')) });
  }
  if (me.exigences.includes('EMAIL_RECUPERATION')) {
    const r = await a.post('/auth/email-recuperation', { email: 'admin.systeme@example.cd', motDePasse: ADMIN_NEW });
    if (r.body.verificationEnvoyee) {
      // Messagerie active (tests e-mail) : le code est lu dans la file d’envoi.
      const m = await db('email_outbox').where({ to_email: 'admin.systeme@example.cd' }).orderBy('id', 'desc').first();
      await a.post('/auth/email-recuperation/verifier', { code: m.text_body.match(/Code de vérification : (\d{6})/)[1] });
    }
  }
  me = (await a.get('/auth/me')).body.user;
  if (me.exigences.includes('REGLES')) await a.post('/auth/regles/accepter', { version: (await a.get('/auth/regles')).body.version });
}

/** Connexion Admin quel que soit l’ordre d’exécution des tests (première connexion ou non). */
async function loginAdmin() {
  let res = await connexion('admin', 'dep@2026');
  if (res.status === 200 && res.body.user.mustChangePassword) {
    const r2 = await request(app).post('/api/auth/change-password').set('Authorization', `Bearer ${res.body.accessToken}`).send({ currentPassword: 'dep@2026', newPassword: ADMIN_NEW });
    await configurerSecurite(r2.body.accessToken);
  } else if (res.status === 200) {
    await configurerSecurite(res.body.accessToken);
  }
  res = await connexion('admin', ADMIN_NEW);
  if (res.status !== 200) throw new Error(`Connexion Admin impossible : ${res.status} ${JSON.stringify(res.body)}`);
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

module.exports = { app, db, request, login, loginAdmin, connexion, codeTotp, configurerSecurite, api, userId, enroler, PNG, PDF, DEMO, ADMIN_NEW };

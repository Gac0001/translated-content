'use strict';
/**
 * Lot 7 — Cartes de service : modèle versionné, spécimen de signature, circuit de délivrance,
 * impression PDF, remise et accusé de réception, suivi, vérification publique (QR code, matricule).
 */
const { db, request, app, login, loginAdmin, api, userId, PNG, DEMO, ADMIN_NEW } = require('./helpers');
const { aujourdhui } = require('../src/services/interims');
const { ajouterAnnees } = require('../src/services/cartes');
const { codeBarresCarte } = require('../src/services/cartePdf');
const { encoder } = require('../src/utils/code128');

const agentDe = async (username) => (await db('users').where({ username }).first('agent_id')).agent_id;
const binaire = (r) => r.buffer(true).parse((res, cb) => { const d = []; res.on('data', (c) => d.push(c)); res.on('end', () => cb(null, Buffer.concat(d))); });
const verifier = (q) => request(app).get('/api/public/cartes/verifier').query(q);

async function deposerPhoto(token, agentId) {
  return request(app).post(`/api/agents/${agentId}/photo`).set('Authorization', `Bearer ${token}`).attach('photo', PNG, { filename: 'photo.png', contentType: 'image/png' });
}

describe('Cartes de service', () => {
  let secTok; let sec; let dir; let dirTok; let admin; let agent1; let agent2; let carte1;
  beforeAll(async () => {
    secTok = await login('cb.secretariat'); sec = api(secTok);
    dirTok = await login('directeur'); dir = api(dirTok);
    admin = api(await loginAdmin());
    agent1 = await agentDe('ag.str1'); agent2 = await agentDe('ag.str2');
    await db('agents').whereIn('id', [agent1, agent2]).update({ photo_path: null });
  });

  test('modèle versionné : configuré par l’Admin, validité de 5 ans', async () => {
    const m = (await admin.get('/cartes/modele')).body.actif;
    expect(m).toMatchObject({ version: 3, validite_annees: 5, site_web: 'www.numerique.cd', titre_verso: 'LAISSEZ PASSER', verification_matricule: true, adresse: '45, Avenue Lubefu, Quartier Royal, Kinshasa-Gombe' });
    expect(m.intitule).toEqual(['MINISTÈRE DE L’ÉCONOMIE NUMÉRIQUE', 'SECRÉTARIAT GÉNÉRAL', 'DIRECTION D’ÉTUDES ET PLANIFICATION']);
    const corps = { ...m, adresse: 'Kinshasa/Gombe — République Démocratique du Congo', site_web: 'www.numerique.gouv.cd' };
    for (const k of ['id', 'version', 'actif', 'armoirie_path', 'created_by', 'created_at', 'auteur']) delete corps[k];
    expect((await dir.put('/cartes/modele', corps)).status).toBe(403);
    expect((await admin.put('/cartes/modele', { ...corps, couleur_bandeau: 'bleu' })).status).toBe(400);
    const v2 = await admin.put('/cartes/modele', corps);
    expect(v2.status).toBe(200);
    expect(v2.body).toMatchObject({ version: 4, actif: true, adresse: corps.adresse });
    const arm = await request(app).post('/api/cartes/modele/armoirie').set('Authorization', `Bearer ${await loginAdmin()}`).attach('armoirie', PNG, { filename: 'armoirie.png', contentType: 'image/png' });
    expect(arm.status).toBe(200);
    expect(arm.body).toMatchObject({ version: 5, adresse: corps.adresse, armoirie_path: expect.stringMatching(/\.png$/) });
    expect((await db('modeles_carte').where({ actif: true })).length).toBe(1);
  });

  test('préparation : dossier contrôlé (photo), puis vérification par le Secrétariat', async () => {
    expect((await api(await login('ag.str1')).post('/cartes', { agent_id: agent1 })).status).toBe(403);
    const r = await sec.post('/cartes', { agent_id: agent1 });
    expect(r.status).toBe(201);
    expect(r.body.statut).toBe('A_COMPLETER');
    carte1 = r.body.id;
    expect((await sec.post('/cartes', { agent_id: agent1 })).status).toBe(409); // une seule en préparation
    let d = (await sec.get(`/cartes/${carte1}`)).body;
    expect(d.anomalies).toContain('Photo absente.');
    expect((await sec.post(`/cartes/${carte1}/verifier`)).status).toBe(400);
    expect((await deposerPhoto(secTok, agent1)).status).toBe(200);
    d = (await sec.get(`/cartes/${carte1}`)).body;
    expect(d).toMatchObject({ statut: 'BROUILLON', anomalies: [] });
    expect(d.dossier).toMatchObject({ grade: expect.any(String), fonction: expect.any(String), affectation: expect.stringMatching(/Bureau Stratégies/) });
    // Aperçu recto-verso marqué « spécimen »
    const ap = await binaire(sec.get(`/cartes/${carte1}/apercu`));
    expect(ap.status).toBe(200);
    expect(ap.headers['content-type']).toMatch(/pdf/);
    expect(ap.body.slice(0, 4).toString()).toBe('%PDF');
    const v = await sec.post(`/cartes/${carte1}/verifier`);
    expect(v.body.statut).toBe('VERIFIEE');
    expect(await db('notifications').where({ user_id: await userId('directeur'), type: 'CARTE' }).first()).toBeTruthy();
  });

  test('validation par le Directeur : numéro, QR, renseignements figés, 5 ans', async () => {
    expect((await sec.post(`/cartes/${carte1}/valider`)).status).toBe(403);
    expect((await dir.post(`/cartes/${carte1}/retourner`, {})).status).toBe(400);
    expect((await dir.post(`/cartes/${carte1}/retourner`, { commentaire: 'Photo à refaire sur fond clair' })).body.statut).toBe('BROUILLON');
    await sec.post(`/cartes/${carte1}/verifier`);
    const v = await dir.post(`/cartes/${carte1}/valider`);
    expect(v.status).toBe(200);
    expect(v.body).toMatchObject({ statut: 'VALIDEE', numero: expect.stringMatching(/^DEP\/CS\/\d{4}\/\d{4}$/), date_delivrance: aujourdhui() });
    expect(v.body.date_expiration).toBe(ajouterAnnees(aujourdhui(), 5));
    const c = await db('cartes_service').where({ id: carte1 }).first();
    expect(c.jeton).toMatch(/^\d{20}$/);
    // Le code à barres porte le même code de vérification que le QR code (Code 128 C : 10 caractères)
    expect(codeBarresCarte(c)).toBe(c.jeton);
    const modules = encoder(c.jeton);
    expect(modules.reduce((x, m) => x + m, 0)).toBe(12 * 11 + 13); // départ, 10 paires de chiffres, contrôle, arrêt
    expect((await verifier({ jeton: c.jeton })).body.verdict).toBe('VALIDE');
    expect(c.photo).toMatch(/^carte-/); // photo figée, distincte de celle du dossier
    expect(c.donnees).toMatchObject({ matricule: expect.any(String), nomComplet: expect.any(String) });
    // Intangible en base
    await expect(db('cartes_service').where({ id: carte1 }).update({ donnees: JSON.stringify({ nom: 'X' }) })).rejects.toThrow(/CARTE_INTANGIBLE/);
    // Le jeton n’est jamais renvoyé par l’API ; l’adresse de vérification l’est au registre.
    const d = (await dir.get(`/cartes/${carte1}`)).body;
    expect(d.jeton).toBeUndefined();
    expect(d.urlVerification).toMatch(/\/verification\/c\/\d{20}$/);
  });

  test('spécimen de signature, impression, planche, remise et accusé de réception', async () => {
    const depot = (mdp) => request(app).post('/api/cartes/specimen').set('Authorization', `Bearer ${dirTok}`)
      .field('motDePasse', mdp).field('signataire', 'Christine LUKUSA').field('qualite', 'Le Directeur')
      .attach('signature', PNG, { filename: 'signature.png', contentType: 'image/png' });
    expect((await depot('faux')).status).toBe(400);
    expect((await depot(DEMO)).status).toBe(201);
    expect((await sec.get('/cartes/specimen')).status).toBe(403); // le spécimen n’appartient qu’au Directeur
    // Impression à l’unité
    const pdf = await binaire(sec.get(`/cartes/${carte1}/pdf`));
    expect(pdf.status).toBe(200);
    expect(pdf.body.slice(0, 4).toString()).toBe('%PDF');
    let c = await db('cartes_service').where({ id: carte1 }).first();
    expect(c).toMatchObject({ statut: 'IMPRIMEE', nb_impressions: 1 });
    expect(c.specimen_id).toBeTruthy();
    // Seconde carte, puis planche A4
    await deposerPhoto(secTok, agent2);
    const c2 = (await sec.post('/cartes', { agent_id: agent2 })).body;
    await sec.post(`/cartes/${c2.id}/verifier`);
    await dir.post(`/cartes/${c2.id}/valider`);
    const planche = await binaire(sec.post('/cartes/planche').send({ ids: [carte1, c2.id] }));
    expect(planche.status).toBe(200);
    expect((await db('cartes_service').where({ id: carte1 }).first()).nb_impressions).toBe(2);
    // Une carte non validée ne s’imprime pas
    const c3 = (await sec.post('/cartes', { agent_id: await agentDe('ag.coi1') })).body;
    expect((await sec.get(`/cartes/${c3.id}/pdf`)).status).toBe(400);
    await dir.post(`/cartes/${c3.id}/annuler`, { motif: 'Préparée par erreur' });
    // Remise puis accusé de réception par le titulaire
    expect((await sec.post(`/cartes/${carte1}/remettre`)).body.statut).toBe('REMISE');
    const titulaire = api(await login('ag.str1'));
    expect((await titulaire.get('/cartes/mienne')).body.data[0]).toMatchObject({ id: carte1, statut: 'REMISE' });
    expect((await titulaire.post('/cartes/mienne/accuser')).status).toBe(200);
    expect((await db('cartes_service').where({ id: carte1 }).first()).accuse_at).not.toBeNull();
    expect((await titulaire.get('/cartes')).status).toBe(403); // pas d’accès au registre
  });

  test('vérification publique par QR code et par matricule', async () => {
    const c = await db('cartes_service').where({ id: carte1 }).first();
    const qr = await verifier({ jeton: c.jeton });
    expect(qr.status).toBe(200);
    expect(qr.body).toMatchObject({ verdict: 'VALIDE', valide: true, carte: { numero: c.numero, dateExpiration: c.date_expiration } });
    expect(qr.body.titulaire).toMatchObject({ nomComplet: c.donnees.nomComplet, grade: c.donnees.grade, fonction: c.donnees.fonction, affectation: c.donnees.affectation });
    expect(qr.body.titulaire.photo).toMatch(/^data:image\/png;base64,/);
    // Aucun autre renseignement personnel
    expect(Object.keys(qr.body.titulaire).sort()).toEqual(['affectation', 'fonction', 'grade', 'nomComplet', 'photo']);
    expect(JSON.stringify(qr.body)).not.toMatch(/telephone|email|date_naissance|adresse/);
    // Par matricule, quelle que soit la ponctuation saisie
    const mat = c.donnees.matricule;
    const parMatricule = await verifier({ matricule: ` ${mat.split('').join('.')} ` });
    expect(parMatricule.body).toMatchObject({ verdict: 'VALIDE', carte: { numero: c.numero } });
    expect((await verifier({ matricule: 'INCONNU-999' })).body).toEqual({ verdict: 'INCONNUE', libelle: expect.any(String) });
    expect((await verifier({ jeton: 'xx' })).status).toBe(400);
    expect((await verifier({ jeton: c.jeton, matricule: mat })).status).toBe(400);
    expect((await verifier({})).status).toBe(400);
    expect(await db('verifications_carte').where({ carte_id: carte1, mode: 'QR', resultat: 'VALIDE' }).first()).toBeTruthy();
    expect((await dir.get('/cartes/verifications')).body.data.length).toBeGreaterThan(0);
  });

  test('anti-énumération : alerte et limitation de débit ; vérification par matricule désactivable', async () => {
    for (let i = 0; i < 10; i++) await verifier({ matricule: `ABSENT-${i}` }); // eslint-disable-line no-await-in-loop
    expect(await db('alertes_securite').where({ type: 'VERIFICATION_CARTES' }).first()).toBeTruthy();
    process.env.VERIFICATION_CARTES_MAX = '2';
    try {
      const statuts = [];
      for (let i = 0; i < 4; i++) statuts.push((await verifier({ matricule: 'LIMITE-1' })).status); // eslint-disable-line no-await-in-loop
      expect(statuts).toContain(429);
    } finally { delete process.env.VERIFICATION_CARTES_MAX; }
    await db('modeles_carte').where({ actif: true }).update({ verification_matricule: false });
    try {
      expect((await verifier({ matricule: '123456' })).body.error.code).toBe('VERIFICATION_MATRICULE_FERMEE');
    } finally { await db('modeles_carte').where({ actif: true }).update({ verification_matricule: true }); }
  });

  test('suivi : suspension, perte déclarée par le titulaire, remplacement, renouvellement', async () => {
    const jeton1 = (await db('cartes_service').where({ id: carte1 }).first()).jeton;
    expect((await sec.post(`/cartes/${carte1}/suspendre`, { motif: 'Enquête administrative' })).status).toBe(403);
    expect((await dir.post(`/cartes/${carte1}/suspendre`, { motif: 'Enquête administrative' })).body.statut).toBe('SUSPENDUE');
    expect((await verifier({ jeton: jeton1 })).body).toMatchObject({ verdict: 'SUSPENDUE', valide: false });
    expect((await dir.post(`/cartes/${carte1}/reactiver`)).body.statut).toBe('REMISE');
    // Perte déclarée par le titulaire
    const titulaire = api(await login('ag.str1'));
    expect((await titulaire.post(`/cartes/${carte1}/perdue`, { motif: 'Perdue lors d’une mission' })).body.statut).toBe('PERDUE');
    expect((await verifier({ jeton: jeton1 })).body.verdict).toBe('PERDUE');
    // Remplacement
    const r = await sec.post('/cartes', { agent_id: agent1, motif_emission: 'REMPLACEMENT' });
    expect(r.status).toBe(201);
    // Renouvellement de la carte en circulation de l’agent 2
    const c2 = await db('cartes_service').where({ agent_id: agent2, statut: 'IMPRIMEE' }).first();
    expect((await sec.post('/cartes', { agent_id: agent2 })).status).toBe(409);
    const ren = (await sec.post('/cartes', { agent_id: agent2, motif_emission: 'RENOUVELLEMENT' })).body;
    await sec.post(`/cartes/${ren.id}/verifier`);
    expect((await dir.post(`/cartes/${ren.id}/valider`)).status).toBe(200);
    expect((await db('cartes_service').where({ id: c2.id }).first()).statut).toBe('REMPLACEE');
    expect((await verifier({ jeton: c2.jeton })).body.verdict).toBe('REMPLACEE');
    // Le matricule renvoie la carte en circulation (la nouvelle)
    const mat = (await db('agents').where({ id: agent2 }).first()).matricule;
    expect((await verifier({ matricule: mat })).body.carte.numero).toBe((await db('cartes_service').where({ id: ren.id }).first()).numero);
  });

  test('expiration et titulaire qui n’est plus en fonction', async () => {
    const c = await db('cartes_service').where({ agent_id: agent2 }).whereIn('statut', ['VALIDEE', 'IMPRIMEE', 'REMISE']).first();
    await db('agents').where({ id: agent2 }).update({ statut: 'RETRAITE' });
    expect((await verifier({ jeton: c.jeton })).body.verdict).toBe('NON_EN_FONCTION');
    await db('agents').where({ id: agent2 }).update({ statut: 'ACTIF' });
    await db.raw('ALTER TABLE cartes_service DISABLE TRIGGER trg_cartes_intangibles');
    try {
      await db('cartes_service').where({ id: c.id }).update({ date_expiration: '2020-01-01' });
    } finally { await db.raw('ALTER TABLE cartes_service ENABLE TRIGGER trg_cartes_intangibles'); }
    expect((await verifier({ jeton: c.jeton })).body.verdict).toBe('EXPIREE');
    await require('../src/services/jobs').expirerCartes();
    expect((await db('cartes_service').where({ id: c.id }).first()).statut).toBe('EXPIREE');
  });

  test('le Directeur valide lui-même sa propre carte de service', async () => {
    const agentDir = await agentDe('directeur');
    await db('cartes_service').where({ agent_id: agentDir }).del();
    expect((await deposerPhoto(secTok, agentDir)).status).toBe(200);
    const r = await sec.post('/cartes', { agent_id: agentDir });
    expect(r.status).toBe(201);
    expect((await sec.post(`/cartes/${r.body.id}/verifier`)).body.statut).toBe('VERIFIEE');
    const v = await dir.post(`/cartes/${r.body.id}/valider`);
    expect(v.status).toBe(200);
    expect(v.body).toMatchObject({ statut: 'VALIDEE', valide_par: await userId('directeur') });
  });

  test('accès : l’Admin configure le modèle mais ne prépare ni ne valide de carte', async () => {
    expect((await admin.get('/cartes')).status).toBe(403);
    expect((await admin.post('/cartes', { agent_id: agent1 })).status).toBe(403);
    expect((await admin.get('/cartes/modele')).status).toBe(200);
    expect(ADMIN_NEW).toBeTruthy();
  });
});

'use strict';
/**
 * Documents officiels (1.33.0) : identité du Ministère versionnée (en-tête, pied de page, sceau,
 * format des références), numéro officiel des correspondances attribué à la signature, mise en page
 * en lettre et termes de référence.
 */
const JSZip = require('jszip');
const { db, login, loginAdmin, avecConfirmation, api, userId, PNG } = require('./helpers');
const identite = require('../src/services/identite');

const binaire = (r) => r.buffer(true).parse((res, cb) => { const d = []; res.on('data', (c) => d.push(c)); res.on('end', () => cb(null, Buffer.concat(d))); });
const texteDocx = async (buf) => (await JSZip.loadAsync(buf)).file('word/document.xml').async('string');
const fichiersDocx = async (buf) => Object.keys((await JSZip.loadAsync(buf)).files);

/** Circuit complet Agent → Chef de Bureau → Chef de Division → Directeur. */
async function signer(doc, { ag, cb, cd, dir }) {
  expect((await ag.post(`/documents/${doc.id}/transmettre`, {})).status).toBe(200);
  expect((await cb.post(`/documents/${doc.id}/transmettre`, {})).status).toBe(200);
  expect((await cd.post(`/documents/${doc.id}/viser`, {})).status).toBe(200);
  expect((await cd.post(`/documents/${doc.id}/transmettre`, {})).status).toBe(200);
  const v = await dir.post(`/documents/${doc.id}/valider`, {});
  expect(v.status).toBe(200);
  return v.body;
}

describe('Identité du Ministère', () => {
  let admin; let dir; let agent;
  beforeAll(async () => { admin = api(await loginAdmin()); dir = api(await login('directeur')); agent = api(await login('ag.sev1')); });

  const nouvelle = (extra = {}) => ({
    date_application: '2099-01-01', ministere: 'MINISTERE DE L’ECONOMIE NUMERIQUE', sigle: 'MIN-ECN2',
    secretariat_general: 'Secrétariat Général au Numérique', direction: 'Direction Etudes et Planification',
    secretaire_general_titre: 'Le Secrétaire Général', adresse: '1, Avenue de l’Essai, Kinshasa - Gombe',
    courriel: 'essai@example.cd', site_web: 'www.example.cd', qr_contenu: 'https://www.example.cd',
    format_reference: 'N° {seq}/{sigle}/SGN/DEP/{signataire}/{redacteur}/{annee}',
    format_reference_sg: 'N° {seq}/{sigle}/SG/{signataire}/DEP/{redacteur}/{annee}',
    motif: 'Essai d’une nouvelle identité (arrêté fictif).', ...extra,
  });

  test('consultation réservée à l’Admin et au Directeur ; version initiale MIN-ECN', async () => {
    const r = await admin.get('/systeme/identite');
    expect(r.status).toBe(200);
    expect(r.body.courante).toMatchObject({ version: 1, sigle: 'MIN-ECN', aSceau: false });
    expect(r.body.courante.sceau).toBeUndefined();
    expect((await dir.get('/systeme/identite')).status).toBe(200);
    expect((await agent.get('/systeme/identite')).status).toBe(403);
    const apercu = await binaire(dir.get('/systeme/identite/apercu.pdf?variante=SG'));
    expect(apercu.status).toBe(200);
    expect(apercu.body.subarray(0, 5).toString()).toBe('%PDF-');
    // Polices de l’en-tête incorporées (Cooper Hewitt et Great Vibes)
    const brut = apercu.body.toString('latin1');
    expect(brut).toMatch(/GreatVibes/);
    expect(new Set(brut.match(/\/BaseFont \/[A-Z]{6}\+/g)).size).toBeGreaterThanOrEqual(3);
  });

  test('nouvelle version : contrôles, confirmation du Directeur, ajout seul', async () => {
    expect((await admin.post('/systeme/identite', nouvelle({ format_reference: 'N° {seq}/DEP' }))).status).toBe(400);
    expect((await admin.post('/systeme/identite', nouvelle({ motif: 'court' }))).status).toBe(400);
    expect((await admin.post('/systeme/identite', nouvelle({ sceau_base64: Buffer.from('pas une image').toString('base64') }))).status).toBe(400);
    expect((await dir.post('/systeme/identite', nouvelle())).status).toBe(403);
    const corps = nouvelle({ sceau_base64: `data:image/png;base64,${PNG.toString('base64')}` });
    const a = await admin.post('/systeme/identite', corps);
    expect(a.status).toBe(202);
    expect(a.body.demande).toMatchObject({ type: 'IDENTITE', statut: 'EN_ATTENTE' });
    expect((await admin.get('/systeme/identite')).body.versions).toHaveLength(1);
    const r = await avecConfirmation(admin, 'post', '/systeme/identite', corps);
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ version: 2, sigle: 'MIN-ECN2', aSceau: true });
    const liste = (await admin.get('/systeme/identite')).body;
    expect(liste.versions.map((v) => v.version)).toEqual([2, 1]);
    // Applicable en 2099 seulement : la version 1 reste en vigueur aujourd’hui.
    expect(liste.courante.version).toBe(1);
    expect(identite.courante(new Date('2099-06-01')).version).toBe(2);
    const sceau = await binaire(admin.get('/systeme/identite/2/sceau'));
    expect(sceau.headers['content-type']).toMatch(/image\/png/);
    expect(Buffer.compare(sceau.body, PNG)).toBe(0);
    expect((await admin.get('/systeme/identite/1/sceau')).status).toBe(404);
    await expect(db('identite_versions').where({ version: 2 }).update({ sigle: 'X' })).rejects.toThrow(/APPEND_ONLY/);
    expect(await db('audit_logs').where({ action: 'IDENTITE_MINISTERE' }).first()).toBeTruthy();
    expect(await db('notifications').where({ user_id: await userId('directeur'), lien: '/systeme/identite' }).first()).toBeTruthy();
  });

  test('format des références et initiales', () => {
    const v = identite.courante();
    expect(identite.initiales('Jean-Paul ILUNGA MUTOMBO')).toBe('JPIM');
    expect(identite.reference(v, { seq: 12, signataire: 'JI', redacteur: 'PT', annee: 2026 })).toBe('N° 012/MIN-ECN/SGN/DEP/JI/PT/2026');
    expect(identite.reference(v, { seq: 3, signataire: 'AL', redacteur: 'PT', annee: 2026, variante: 'SG' })).toBe('N° 003/MIN-ECN/SG/AL/DEP/PT/2026');
    expect(identite.reference(v, { annee: 2026 })).toBe('N° …/MIN-ECN/SGN/DEP/…/…/2026');
  });
});

describe('Correspondance : numéro officiel à la signature', () => {
  let u;
  beforeAll(async () => {
    u = { ag: api(await login('ag.sev1')), cb: api(await login('cb.sev')), cd: api(await login('cd.ps')), dir: api(await login('directeur')) };
  });

  test('note explicative : valeurs par défaut, projet « N° … », numéro unique et croissant', async () => {
    const types = (await u.ag.get('/documents/types')).body.data;
    const note = types.find((t) => t.code === 'NOTE_EXPLICATIVE');
    expect(note.correspondance).toBe(true);
    expect(types.map((t) => t.code)).toContain('TERMES_REFERENCE');
    const creer = (titre, contenu) => u.ag.post('/documents', { type_document: 'NOTE_EXPLICATIVE', titre, contenu });
    const n1 = (await creer('Note sur la politique sectorielle', { concerne: 'Élaboration de la politique sectorielle', corps: 'Premier paragraphe.\n\nSecond paragraphe.', signataire_nom: 'Albert TSHIBOLA LUKUSA', copies: ['Cabinet du Ministre'] })).body;
    expect(n1.contenu).toMatchObject({ signataire: 'Secrétaire Général', formule_appel: 'Excellence Monsieur le Ministre,' });
    const projet = await u.ag.get(`/documents/${n1.id}`);
    expect(projet.body.reference_officielle).toMatch(/^N° …\/MIN-ECN\/SG\/…\/DEP\/…\/\d{4}$/);
    const s1 = await signer(n1, u);
    expect(s1.numero_officiel).toMatch(/^N° \d{3}\/MIN-ECN\/SG\/ATL\/DEP\/[A-Z]+\/\d{4}$/);
    expect(s1.identite_version_id).toBeTruthy();
    // Lettre de transmission signée par le Directeur : variante de la Direction, numéro suivant.
    const l = (await u.ag.post('/documents', { type_document: 'LETTRE_TRANSMISSION', titre: 'Transmission du rapport', contenu: { destinataire: 'Monsieur le Directeur des Archives', objet: 'Transmission du rapport trimestriel', corps: 'J’ai l’honneur de vous transmettre le rapport.' } })).body;
    const s2 = await signer(l, u);
    expect(s2.numero_officiel).toMatch(/^N° \d{3}\/MIN-ECN\/SGN\/DEP\/[A-Z]+\/[A-Z]+\/\d{4}$/);
    const seq = (n) => Number(n.match(/^N° (\d+)/)[1]);
    expect(seq(s2.numero_officiel)).toBe(seq(s1.numero_officiel) + 1);
    expect(await db('historiques').where({ entity_id: l.id, entity_type: 'DOCUMENT', action: 'VALIDATION' }).first().then((h) => h.commentaire)).toContain(s2.numero_officiel);
    // Le numéro ne change plus ; il est rendu dans les exports
    expect((await u.dir.get(`/documents/${l.id}`)).body.reference_officielle).toBe(s2.numero_officiel);
    const pdf = await binaire(u.dir.get(`/documents/${n1.id}/export/pdf`));
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-disposition']).toMatch(/\.pdf/);
    expect(pdf.body.toString('latin1')).toMatch(/GreatVibes/);
    const docx = await binaire(u.dir.get(`/documents/${l.id}/export/docx`));
    expect(docx.status).toBe(200);
    const xml = await texteDocx(docx.body);
    expect(xml).toContain('Transmission du rapport trimestriel');
    expect(xml).toContain(s2.numero_officiel.replace('N° ', ''));
    expect((await fichiersDocx(docx.body)).some((f) => /fonts\//.test(f))).toBe(true);
    expect((await u.dir.get(`/documents/${l.id}/export/xlsx`)).status).toBe(200);
  });

  test('un document ordinaire ne reçoit pas de numéro officiel', async () => {
    const r = (await u.ag.post('/documents', { type_document: 'RAPPORT', titre: 'Rapport de test', contenu: { periode: 'Octobre 2026', introduction: 'I', activites_realisees: 'A', recommandations: ['R'], conclusion: 'C' } })).body;
    const s = await signer(r, u);
    expect(s.numero_officiel).toBeNull();
  });

  test('termes de référence : phases et export Word avec en-tête officiel', async () => {
    const t = await u.ag.post('/documents', { type_document: 'TERMES_REFERENCE', titre: 'TDR de l’atelier de validation', contenu: {
      contexte: 'Contexte de l’atelier.', objectif_general: 'Valider le document.', objectifs_specifiques: ['Présenter', 'Amender'],
      phases: [{ phase: 'Préparation', objectifs: 'Organiser', activites: 'Invitations', livrables: 'Liste des participants' }],
    } });
    expect(t.status).toBe(201);
    expect(t.body.contenu.lieu).toBe('Kinshasa');
    const docx = await binaire(u.ag.get(`/documents/${t.body.id}/export/docx`));
    expect(docx.status).toBe(200);
    const zip = await JSZip.loadAsync(docx.body);
    const entetes = await Promise.all(Object.keys(zip.files).filter((f) => /word\/(header|footer)\d*\.xml$/.test(f)).map((f) => zip.file(f).async('string')));
    expect(entetes.join('')).toContain('Direction Etudes et Planification');
    expect(entetes.join('')).toContain('Avenue Lubefu');
    expect(await texteDocx(docx.body)).toContain('Préparation');
  });
});


describe('Formulaire par étapes des documents de service', () => {
  test('chaque modèle a ses étapes, sans rubrique oubliée ; identité pour l’aperçu de la correspondance', async () => {
    const r = (await api(await login('ag.sev1')).get('/documents/types')).body;
    for (const t of r.data) {
      const cles = t.etapes.flatMap((e) => e.cles);
      expect(cles.sort()).toEqual(t.sections.map((s) => s.key).sort());
    }
    const note = r.data.find((t) => t.code === 'NOTE_EXPLICATIVE');
    expect(note.etapes.map((e) => e.label)).toEqual(['Destinataire et objet', 'Corps de la note', 'Signature et copies']);
    expect(r.identite).toMatchObject({ direction: 'Direction Etudes et Planification', reference_dep: expect.stringMatching(/^N° …\/MIN-ECN\/SGN\/DEP\//), reference_sg: expect.stringMatching(/\/SG\//) });
  });
});

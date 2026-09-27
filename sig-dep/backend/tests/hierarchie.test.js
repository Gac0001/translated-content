'use strict';
/** Chaîne hiérarchique, instructions, tâches et périmètres de données. */
const { db, login, loginAdmin, api, userId } = require('./helpers');

describe('Instructions et chaîne hiérarchique', () => {
  test('le Secrétaire Général ne peut adresser d’instruction qu’au Directeur', async () => {
    const sg = api(await login('sg'));
    for (const u of ['cd.edi', 'cb.eap', 'ag.eap1', 'cb.secretariat']) {
      const r = await sg.post('/instructions', { destinataire_user_id: await userId(u), objet: 'Test', contenu: 'Test' });
      expect(r.status).toBe(403);
      expect(r.body.error.message).toMatch(/Directeur/);
    }
  });

  test('cycle complet SG → Directeur → Chef de Division → Chef de Bureau, avec compte rendu', async () => {
    const sg = api(await login('sg'));
    const dir = api(await login('directeur'));
    const cd = api(await login('cd.edi'));
    const cb = api(await login('cb.eap'));
    const i1 = await sg.post('/instructions', { destinataire_user_id: await userId('directeur'), objet: 'Rapport annuel', contenu: 'Produire le rapport annuel', priorite: 'HAUTE', echeance: '2099-12-31' });
    expect(i1.status).toBe(201);
    expect(i1.body.statut).toBe('TRANSMISE');
    expect((await dir.post(`/instructions/${i1.body.id}/accuser-reception`)).body.statut).toBe('RECUE');
    const i2 = await dir.post('/instructions', { destinataire_user_id: await userId('cd.edi'), objet: 'Contribution', contenu: 'Contribution de la Division', parent_id: i1.body.id });
    expect(i2.status).toBe(201);
    const i3 = await cd.post('/instructions', { destinataire_user_id: await userId('cb.eap'), objet: 'Données sectorielles', contenu: 'Collecter les données' });
    expect(i3.status).toBe(201);
    // Le Chef de Bureau ne peut pas instruire son supérieur
    const bad = await cb.post('/instructions', { destinataire_user_id: await userId('cd.edi'), objet: 'x', contenu: 'x' });
    expect(bad.status).toBe(403);
    expect((await cb.post(`/instructions/${i3.body.id}/avancement`, { avancement: 50 })).body.avancement).toBe(50);
    expect((await cb.post(`/instructions/${i3.body.id}/rendre-compte`, { reponse: 'Données collectées' })).body.statut).toBe('EXECUTEE');
    // Seul l’émetteur valide
    expect((await dir.post(`/instructions/${i3.body.id}/valider`, {})).status).toBe(403);
    expect((await cd.post(`/instructions/${i3.body.id}/retourner`, { observations: 'Compléter' })).body.statut).toBe('A_CORRIGER');
    await cb.post(`/instructions/${i3.body.id}/rendre-compte`, { reponse: 'Données complétées' });
    expect((await cd.post(`/instructions/${i3.body.id}/valider`, {})).body.statut).toBe('VALIDEE');
    expect((await cd.post(`/instructions/${i3.body.id}/cloturer`)).body.statut).toBe('CLOTUREE');
    // Remontée au SG
    await dir.post(`/instructions/${i1.body.id}/rendre-compte`, { reponse: 'Rapport transmis' });
    const d = await sg.get(`/instructions/${i1.body.id}`);
    expect(d.body.statut).toBe('EXECUTEE');
    expect(d.body.reponse).toBe('Rapport transmis');
    expect(d.body.historique.length).toBeGreaterThanOrEqual(3);
    expect(d.body.historique.every((h) => h.created_at)).toBe(true);
  });

  test('un Chef de Division ne peut instruire un Chef de Bureau d’une autre Division', async () => {
    const r = await api(await login('cd.edi')).post('/instructions', { destinataire_user_id: await userId('cb.str'), objet: 'Hors division', contenu: 'Contenu de test' });
    expect(r.status).toBe(403);
  });

  test('un Agent ne peut pas émettre d’instruction', async () => {
    const r = await api(await login('ag.eap1')).post('/instructions', { destinataire_user_id: await userId('cb.eap'), objet: 'x', contenu: 'x' });
    expect(r.status).toBe(403);
  });

  test('l’Admin n’a aucune place dans la chaîne administrative', async () => {
    const admin = api(await loginAdmin());
    expect((await admin.get('/instructions')).status).toBe(403);
    expect((await admin.get('/documents')).status).toBe(403);
    expect((await admin.get('/presences')).status).toBe(403);
    expect((await admin.get('/courriers')).status).toBe(403);
  });
});

describe('Tâches', () => {
  test('le Chef de Bureau attribue uniquement aux Agents de son Bureau', async () => {
    const cb = api(await login('cb.eap'));
    expect((await cb.post('/taches', { agent_user_id: await userId('ag.doi1'), titre: 'Hors bureau' })).status).toBe(403);
    const t = await cb.post('/taches', { agent_user_id: await userId('ag.eap1'), titre: 'Analyse des données', echeance: '2099-01-31' });
    expect(t.status).toBe(201);
    const ag = api(await login('ag.eap1'));
    const other = api(await login('ag.eap2'));
    expect((await other.post(`/taches/${t.body.id}/avancement`, { avancement: 30 })).status).toBe(403);
    expect((await ag.post(`/taches/${t.body.id}/accuser-reception`)).body.statut).toBe('RECUE');
    expect((await ag.post(`/taches/${t.body.id}/avancement`, { avancement: 60 })).body.statut).toBe('EN_COURS');
    expect((await ag.post(`/taches/${t.body.id}/rendre-compte`, { rapport_execution: 'Analyse terminée' })).body.statut).toBe('EXECUTEE');
    expect((await ag.post(`/taches/${t.body.id}/valider`, {})).status).toBe(403);
    expect((await cb.post(`/taches/${t.body.id}/valider`, {})).body.statut).toBe('VALIDEE');
    const notif = await db('notifications').where({ user_id: await userId('ag.eap1'), type: 'TACHE' }).first();
    expect(notif).toBeTruthy();
  });

  test('passage automatique « En retard » et notification', async () => {
    const cb = api(await login('cb.prg'));
    const t = await cb.post('/taches', { agent_user_id: await userId('ag.prg1'), titre: 'Tâche échue' });
    await db('tasks').where({ id: t.body.id }).update({ echeance: '2020-01-01' });
    const jobs = require('../src/services/jobs');
    await jobs.markOverdue();
    expect((await db('tasks').where({ id: t.body.id }).first()).statut).toBe('EN_RETARD');
    expect(await db('notifications').where({ type: 'RETARD' }).first()).toBeTruthy();
  });
});

describe('Périmètres de données', () => {
  test('un Agent ne consulte ni la liste du personnel ni la fiche d’un autre Agent', async () => {
    const ag = api(await login('ag.str1'));
    expect((await ag.get('/agents')).status).toBe(403);
    const other = (await db('users').where({ username: 'ag.str2' }).first()).agent_id;
    expect((await ag.get(`/agents/${other}`)).status).toBe(403);
    expect((await ag.get('/agents/moi')).status).toBe(200);
  });

  test('un Chef de Bureau ne voit que les Agents de son Bureau', async () => {
    const res = await api(await login('cb.coi')).get('/agents');
    const bureau = await db('bureaux').where({ code: 'BUR-COI' }).first();
    expect(res.body.data.length).toBeGreaterThan(0);
    expect(res.body.data.every((a) => a.bureau_id === bureau.id)).toBe(true);
  });

  test('un Chef de Division ne voit que les instructions de sa Division', async () => {
    const cdp = api(await login('cd.sci'));
    const list = await cdp.get('/instructions');
    const div = await db('divisions').where({ code: 'DIV-SCI' }).first();
    const me = await userId('cd.sci');
    expect(list.body.data.every((i) => i.division_id === div.id || i.emetteur_user_id === me || i.destinataire_user_id === me)).toBe(true);
  });

  test('le Secrétaire Général consulte en lecture seule', async () => {
    const sg = api(await login('sg'));
    expect((await sg.get('/presences')).status).toBe(200);
    expect((await sg.post('/courriers', { sens: 'ENTRANT', expediteur: 'X', destinataire: 'Y', objet: 'Objet', date_courrier: '2026-09-01' })).status).toBe(403);
    expect((await sg.post('/documents', { type_document: 'RAPPORT', titre: 'Test' })).status).toBe(403);
    expect((await sg.get('/enrolement/candidats')).status).toBe(403);
    expect((await sg.post('/liste-declarative/valider', {})).status).toBe(403);
  });
});

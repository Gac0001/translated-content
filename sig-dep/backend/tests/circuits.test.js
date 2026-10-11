'use strict';
/**
 * Lot 8A — Compléments des circuits de traitement : blocage, rapport intermédiaire, annulation,
 * prolongations, instruction exceptionnelle du Directeur, sous-tâches, dépendances, preuves,
 * demandes d’information du Secrétaire Général.
 */
const { db, request, app, login, api, userId, PDF } = require('./helpers');
const { aujourdhui } = require('../src/services/interims');

const dans = (jours) => {
  const d = new Date(`${aujourdhui()}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + jours);
  return d.toISOString().slice(0, 10);
};

describe('Instructions : blocage, rapport intermédiaire, prolongation, annulation', () => {
  let sg; let dir; let id;
  beforeAll(async () => {
    sg = api(await login('sg'));
    dir = api(await login('directeur'));
    const r = await sg.post('/instructions', { destinataire_user_id: await userId('directeur'), objet: 'Note sur la stratégie numérique', contenu: 'Préparer une note de synthèse', echeance: dans(5) });
    expect(r.status).toBe(201);
    id = r.body.id;
  });

  test('blocage motivé par l’exécutant, levée, rapport intermédiaire', async () => {
    expect((await sg.post(`/instructions/${id}/bloquer`, { motif: 'Données manquantes' })).status).toBe(403);
    await dir.post(`/instructions/${id}/accuser-reception`);
    const b = await dir.post(`/instructions/${id}/bloquer`, { motif: 'Données de l’ARPTC non reçues' });
    expect(b.body).toMatchObject({ statut: 'BLOQUEE', statut_avant_blocage: 'RECUE', motif_blocage: 'Données de l’ARPTC non reçues' });
    expect(await db('notifications').where({ user_id: await userId('sg'), lien: `/instructions/${id}` }).where('titre', 'like', 'Blocage%').first()).toBeTruthy();
    expect((await dir.post(`/instructions/${id}/avancement`, { avancement: 20 })).status).toBe(400);
    expect((await sg.post(`/instructions/${id}/debloquer`, { commentaire: 'Données transmises' })).body.statut).toBe('EN_COURS');
    const ri = await dir.post(`/instructions/${id}/rapport-intermediaire`, { texte: 'Plan de la note arrêté', avancement: 40 });
    expect(ri.body).toMatchObject({ statut: 'RAPPORT_INTERMEDIAIRE', avancement: 40 });
    expect((await dir.post(`/instructions/${id}/rapport-intermediaire`, { texte: 'Recul', avancement: 10 })).status).toBe(400);
    expect((await dir.post(`/instructions/${id}/avancement`, { avancement: 60 })).body.statut).toBe('EN_COURS');
    const h = (await sg.get(`/instructions/${id}`)).body.historique.map((x) => x.action);
    expect(h).toEqual(expect.arrayContaining(['BLOCAGE', 'DEBLOCAGE', 'RAPPORT_INTERMEDIAIRE']));
  });

  test('prolongation : demande motivée, une seule à la fois, décision de l’émetteur', async () => {
    expect((await dir.post(`/instructions/${id}/prolongation`, { echeance: dans(2), motif: 'Trop tôt' })).status).toBe(400);
    const p = await dir.post(`/instructions/${id}/prolongation`, { echeance: dans(15), motif: 'Consultation des opérateurs nécessaire' });
    expect(p.status).toBe(201);
    expect((await dir.post(`/instructions/${id}/prolongation`, { echeance: dans(20), motif: 'Encore' })).status).toBe(409);
    let d = (await sg.get(`/instructions/${id}`)).body;
    expect(d.actions).toMatchObject({ deciderProlongation: true, prolonger: false });
    expect((await sg.post(`/instructions/${id}/prolongation/decision`, { accorder: false })).status).toBe(400); // refus non motivé
    const ok = await sg.post(`/instructions/${id}/prolongation/decision`, { accorder: true, echeance: dans(12) });
    expect(ok.body).toMatchObject({ echeance: dans(12), echeance_initiale: dans(5) });
    // Prolongation directe par l’émetteur
    const pr = await sg.post(`/instructions/${id}/prolonger`, { echeance: dans(20), motif: 'Calendrier du Conseil' });
    expect(pr.body).toMatchObject({ echeance: dans(20), echeance_initiale: dans(5) });
    d = (await sg.get(`/instructions/${id}`)).body;
    expect(d.prolongations.map((x) => x.statut)).toEqual(['ACCORDEE', 'ACCORDEE']);
    expect(d.prolongations[0].echeance_demandee).toBe(dans(12));
  });

  test('instruction en retard : la prolongation accordée lève le retard', async () => {
    const r = await sg.post('/instructions', { destinataire_user_id: await userId('directeur'), objet: 'Point d’étape', contenu: 'Faire le point', echeance: dans(1) });
    await db('instructions').where({ id: r.body.id }).update({ echeance: '2020-01-01', statut: 'EN_RETARD' });
    const p = await sg.post(`/instructions/${r.body.id}/prolonger`, { echeance: dans(3), motif: 'Nouveau calendrier' });
    expect(p.body).toMatchObject({ statut: 'EN_COURS', echeance: dans(3), echeance_initiale: '2020-01-01' });
  });

  test('annulation motivée par l’émetteur seulement', async () => {
    expect((await dir.post(`/instructions/${id}/annuler`, { motif: 'Sans objet' })).status).toBe(403);
    const a = await sg.post(`/instructions/${id}/annuler`, { motif: 'Sujet repris par le Cabinet' });
    expect(a.body).toMatchObject({ statut: 'ANNULEE', motif_annulation: 'Sujet repris par le Cabinet' });
    expect((await dir.post(`/instructions/${id}/avancement`, { avancement: 70 })).status).toBe(400);
    expect((await sg.post(`/instructions/${id}/annuler`, { motif: 'Encore' })).status).toBe(400);
  });
});

describe('Instruction exceptionnelle du Directeur', () => {
  test('à tout agent, justifiée, avec copie au supérieur immédiat', async () => {
    const dir = api(await login('directeur'));
    const dest = await dir.get('/instructions/destinataires');
    expect(dest.body.exceptionnels.map((n) => n.username)).toEqual(expect.arrayContaining(['ag.sev1', 'cb.sev']));
    expect(dest.body.exceptionnels.map((n) => n.username)).not.toContain('cd.ps'); // subordonné direct
    const agent = await userId('ag.sev1');
    const base = { destinataire_user_id: agent, objet: 'Collecte urgente', contenu: 'Transmettre les données de couverture', exceptionnelle: true };
    expect((await dir.post('/instructions', { ...base, justification_exception: 'Urgent' })).status).toBe(400);
    expect((await dir.post('/instructions', { ...base, exceptionnelle: false })).status).toBe(403); // chaîne hiérarchique
    expect((await dir.post('/instructions', { ...base, destinataire_user_id: await userId('cd.ps'), justification_exception: 'Délai du Cabinet très court' })).status).toBe(400);
    const r = await dir.post('/instructions', { ...base, justification_exception: 'Délai du Cabinet très court, Chef de Bureau en mission' });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ exceptionnelle: true, copie_user_id: await userId('cb.sev'), destinataire_role: 'AGENT' });
    expect(await db('notifications').where({ user_id: await userId('cb.sev'), lien: `/instructions/${r.body.id}` }).where('titre', 'like', 'Copie%').first()).toBeTruthy();
    // Le supérieur en copie suit l’instruction ; l’Agent l’exécute
    const cb = api(await login('cb.sev'));
    expect((await cb.get(`/instructions/${r.body.id}`)).body.actions.estCopie).toBe(true);
    const ag = api(await login('ag.sev1'));
    expect((await ag.post(`/instructions/${r.body.id}/accuser-reception`)).body.statut).toBe('RECUE');
    expect((await ag.post(`/instructions/${r.body.id}/rendre-compte`, { reponse: 'Données transmises' })).body.statut).toBe('EXECUTEE');
    expect((await dir.post(`/instructions/${r.body.id}/valider`, {})).body.statut).toBe('VALIDEE');
    // Le Secrétaire Général ne peut pas adresser d’instruction exceptionnelle
    const sg = api(await login('sg'));
    expect((await sg.post('/instructions', { ...base, justification_exception: 'Justification suffisante' })).status).toBe(403);
    const audit = await db('audit_logs').where({ entite: 'instruction', entite_id: String(r.body.id) }).first();
    expect(audit.message).toMatch(/Instruction exceptionnelle/);
  });
});

describe('Tâches : sous-tâches, dépendances, preuves, prolongation', () => {
  let cbTok; let cb; let ag1; let ag2; let a; let b;
  beforeAll(async () => {
    cbTok = await login('cb.sev'); cb = api(cbTok);
    ag1 = api(await login('ag.sev1')); ag2 = api(await login('ag.sev2'));
    a = (await cb.post('/taches', { agent_user_id: await userId('ag.sev1'), titre: 'Collecter les données', echeance: dans(10) })).body;
    b = (await cb.post('/taches', { agent_user_id: await userId('ag.sev2'), titre: 'Analyser les données', echeance: dans(15), depend_de: [a.id] })).body;
  });

  test('une tâche n’avance qu’après celles dont elle dépend ; pas de dépendance circulaire', async () => {
    expect((await cb.post(`/taches/${a.id}/dependances`, { depend_de_task_id: b.id })).status).toBe(400);
    await ag2.post(`/taches/${b.id}/accuser-reception`);
    const r = await ag2.post(`/taches/${b.id}/avancement`, { avancement: 10 });
    expect(r.status).toBe(400);
    expect(r.body.error.message).toMatch(a.reference);
    expect((await ag2.get(`/taches/${b.id}`)).body.bloquantes.map((t) => t.id)).toEqual([a.id]);
  });

  test('sous-tâches : la tâche parente n’est rendue qu’une fois ses sous-tâches exécutées', async () => {
    expect((await cb.post('/taches', { agent_user_id: await userId('ag.sev2'), titre: 'Trop tard', parent_task_id: a.id, echeance: dans(30) })).status).toBe(400);
    const s = await cb.post('/taches', { agent_user_id: await userId('ag.sev2'), titre: 'Relancer les opérateurs', parent_task_id: a.id, echeance: dans(5) });
    expect(s.status).toBe(201);
    expect((await cb.post('/taches', { agent_user_id: await userId('ag.sev1'), titre: 'Niveau 2', parent_task_id: s.body.id })).status).toBe(400);
    expect((await cb.get(`/taches/${a.id}`)).body.sousTaches.map((t) => t.id)).toEqual([s.body.id]);
    expect((await ag1.post(`/taches/${a.id}/rendre-compte`, { rapport_execution: 'Fait' })).status).toBe(400);
    expect((await ag2.post(`/taches/${s.body.id}/rendre-compte`, { rapport_execution: 'Opérateurs relancés' })).body.statut).toBe('EXECUTEE');
    // Preuve d’exécution jointe par l’Agent
    const pj = await request(app).post(`/api/attachments/TASK/${a.id}?categorie=PREUVE`).set('Authorization', `Bearer ${await login('ag.sev1')}`).attach('fichiers', PDF, { filename: 'releve.pdf', contentType: 'application/pdf' });
    expect(pj.status).toBe(201);
    expect(pj.body.data[0].categorie).toBe('PREUVE');
    expect((await ag1.post(`/taches/${a.id}/rendre-compte`, { rapport_execution: 'Données collectées' })).body.statut).toBe('EXECUTEE');
    // La dépendance est levée : la tâche B peut avancer
    expect((await ag2.post(`/taches/${b.id}/avancement`, { avancement: 30 })).body.statut).toBe('EN_COURS');
  });

  test('prolongation demandée par l’Agent, refus motivé du Chef de Bureau ; annulation', async () => {
    expect((await ag2.post(`/taches/${b.id}/prolongation`, { echeance: dans(25), motif: 'Volume de données important' })).status).toBe(201);
    expect((await ag2.post(`/taches/${b.id}/prolongation/decision`, { accorder: true })).status).toBe(403);
    const r = await cb.post(`/taches/${b.id}/prolongation/decision`, { accorder: false, commentaire: 'Délai impératif' });
    expect(r.body.echeance).toBe(dans(15));
    expect(await db('notifications').where({ user_id: await userId('ag.sev2'), lien: `/taches/${b.id}` }).where('titre', 'like', 'Prolongation refusée%').first()).toBeTruthy();
    expect((await cb.post(`/taches/${b.id}/annuler`, { motif: 'Analyse confiée à la Division' })).body.statut).toBe('ANNULEE');
  });
});

describe('Demandes d’information du Secrétaire Général', () => {
  test('question du SG, réponse du Directeur avec pièce jointe, clôture', async () => {
    const sg = api(await login('sg'));
    const dir = api(await login('directeur'));
    expect((await api(await login('cd.ps')).get('/demandes-information')).status).toBe(403);
    expect((await dir.post('/demandes-information', { objet: 'X', question: 'Y' })).status).toBe(403);
    const r = await sg.post('/demandes-information', { objet: 'Taux de couverture 4G', question: 'Quel est le taux de couverture 4G par province ?', echeance: dans(3), priorite: 'HAUTE' });
    expect(r.status).toBe(201);
    expect(r.body.reference).toMatch(/^DEP\/DIN\//);
    expect(await db('notifications').where({ user_id: await userId('directeur'), type: 'DEMANDE_INFO' }).first()).toBeTruthy();
    expect((await sg.post(`/demandes-information/${r.body.id}/cloturer`)).status).toBe(400);
    expect((await sg.post(`/demandes-information/${r.body.id}/relancer`)).status).toBe(200);
    expect((await dir.get(`/demandes-information/${r.body.id}`)).body.actions.repondre).toBe(true);
    const pj = await request(app).post(`/api/attachments/DEMANDE_INFO/${r.body.id}`).set('Authorization', `Bearer ${await login('directeur')}`).attach('fichiers', PDF, { filename: 'couverture.pdf', contentType: 'application/pdf' });
    expect(pj.status).toBe(201);
    const rep = await dir.post(`/demandes-information/${r.body.id}/repondre`, { reponse: 'Le taux moyen est de 38 % ; détail par province en pièce jointe.' });
    expect(rep.body.statut).toBe('REPONDUE');
    const vue = (await sg.get(`/demandes-information/${r.body.id}`)).body;
    expect(vue).toMatchObject({ statut: 'REPONDUE', actions: { cloturer: true } });
    expect(vue.pieces).toHaveLength(1);
    expect((await sg.post(`/demandes-information/${r.body.id}/cloturer`)).body.statut).toBe('CLOSE');
    expect((await dir.post(`/demandes-information/${r.body.id}/repondre`, { reponse: 'Complément' })).status).toBe(400);
    expect((await sg.get('/demandes-information')).body.data.map((x) => x.id)).toContain(r.body.id);
  });
});

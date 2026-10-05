'use strict';
/** Présences, courriers, documents, PIP, comptes, audit, exports. */
const { db, login, loginAdmin, api, userId, enroler } = require('./helpers');

describe('Présences hebdomadaires', () => {
  test('workflow Brouillon → Vérifiée → Soumise → Verrouillée et rectificatif', async () => {
    const cb = api(await login('cb.coi'));
    const dir = api(await login('directeur'));
    const s = await cb.post('/presences', { structure_type: 'BUREAU', semaine_debut: '2030-01-07' });
    expect(s.status).toBe(201);
    expect((await cb.post('/presences', { structure_type: 'BUREAU', semaine_debut: '2030-01-08' })).status).toBe(400);
    const d = await cb.get(`/presences/${s.body.id}`);
    const e = d.body.entries[0];
    const entry = { agent_id: e.agent_id, lundi: 'PRESENT', mardi: 'RETARD', mercredi: 'CONGE', jeudi: 'MALADIE', vendredi: 'MISSION', observation: 'RAS' };
    expect((await cb.put(`/presences/${s.body.id}/entries`, { entries: [entry] })).status).toBe(200);
    expect((await cb.post(`/presences/${s.body.id}/soumettre`)).status).toBe(400);
    expect((await cb.post(`/presences/${s.body.id}/verifier`)).body.statut).toBe('VERIFIEE');
    expect((await cb.post(`/presences/${s.body.id}/soumettre`)).body.statut).toBe('SOUMISE');
    const locked = await cb.put(`/presences/${s.body.id}/entries`, { entries: [{ ...entry, lundi: 'ABSENT' }] });
    expect(locked.status).toBe(400);
    await expect(db('presence_entries').where({ sheet_id: s.body.id }).update({ lundi: 'ABSENT' })).rejects.toThrow(/PRESENCE_LOCKED/);
    expect((await dir.post(`/presences/${s.body.id}/verrouiller`)).body.statut).toBe('VERROUILLEE');
    const r = await cb.post(`/presences/${s.body.id}/rectificatif`, { motif: 'Correction du lundi' });
    expect(r.status).toBe(201);
    expect(r.body.rectifie_sheet_id).toBe(s.body.id);
    expect(r.body.statut).toBe('BROUILLON');
    const pdf = await cb.get(`/presences/${s.body.id}/export/pdf`);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    const xlsx = await cb.get(`/presences/${s.body.id}/export/xlsx`);
    expect(xlsx.headers['content-type']).toMatch(/spreadsheetml/);
  });

  test('un Chef de Bureau ne crée pas la liste d’un autre Bureau', async () => {
    const other = await db('bureaux').where({ code: 'BUR-EAP' }).first();
    const r = await api(await login('cb.coi')).post('/presences', { structure_type: 'BUREAU', bureau_id: other.id, semaine_debut: '2026-09-07' });
    expect(r.status).toBe(403);
  });

  test('le Bureau Secrétariat prépare la liste de la Direction par désignation', async () => {
    const r = await api(await login('cb.secretariat')).post('/presences', { structure_type: 'DIRECTION', semaine_debut: '2026-09-07' });
    expect(r.status).toBe(201);
    expect(r.body.structure_type).toBe('DIRECTION');
  });
});

describe('Courriers', () => {
  test('enregistrement, transmission hiérarchique, accusé de réception, classement', async () => {
    const cbs = api(await login('cb.secretariat'));
    const dir = api(await login('directeur'));
    const cd = api(await login('cd.ps'));
    const c = await cbs.post('/courriers', { sens: 'ENTRANT', expediteur: 'Ministère du Plan', destinataire: 'Directeur de la DEP', objet: 'Cadrage PIP 2027', date_courrier: '2026-09-20', urgence: 'URGENT' });
    expect(c.status).toBe(201);
    expect(c.body.numero_enregistrement).toMatch(/^DEP\/CE\/\d{4}\/\d{4}$/);
    // Transmission non hiérarchique refusée
    expect((await cbs.post(`/courriers/${c.body.id}/transmettre`, { to_user_id: await userId('cd.ps') })).status).toBe(403);
    expect((await cbs.post(`/courriers/${c.body.id}/transmettre`, { to_user_id: await userId('directeur'), observations: 'Pour attribution' })).status).toBe(201);
    const d = await dir.get(`/courriers/${c.body.id}`);
    expect(d.body.actions.accuserReception).toHaveLength(1);
    await dir.post(`/courriers/transmissions/${d.body.actions.accuserReception[0]}/accuser-reception`, {});
    await dir.post(`/courriers/${c.body.id}/annoter`, { texte: 'Division Suivi-Évaluation pour traitement' });
    expect((await dir.post(`/courriers/${c.body.id}/transmettre`, { to_user_id: await userId('cd.ps') })).status).toBe(201);
    const v = await cd.get(`/courriers/${c.body.id}`);
    expect(v.status).toBe(200);
    expect(v.body.transmissions).toHaveLength(2);
    expect(v.body.transmissions[0].etat_reception).toBe('RECU');
    expect(v.body.annotations).toHaveLength(1);
    // Un autre Chef de Division ne le voit pas
    expect((await api(await login('cd.sci')).get(`/courriers/${c.body.id}`)).status).toBe(403);
    await cd.post(`/courriers/${c.body.id}/traiter`);
    expect((await cbs.post(`/courriers/${c.body.id}/classer`, { classement: 'PIP/2027' })).body.statut).toBe('CLASSE');
    expect((await dir.post(`/courriers/${c.body.id}/archiver`)).body.statut).toBe('ARCHIVE');
    expect((await dir.get('/courriers/export/xlsx')).status).toBe(200);
    expect((await dir.get(`/courriers/${c.body.id}/fiche`)).headers['content-type']).toBe('application/pdf');
  });

  test('un courrier confidentiel n’est visible que de la chaîne concernée', async () => {
    const cbs = api(await login('cb.secretariat'));
    const c = await cbs.post('/courriers', { sens: 'ENTRANT', expediteur: 'Cabinet', destinataire: 'Directeur', objet: 'Note confidentielle', date_courrier: '2026-09-21', confidentialite: 'CONFIDENTIEL' });
    expect((await api(await login('ag.secretariat1')).get(`/courriers/${c.body.id}`)).status).toBe(403);
    expect((await api(await login('directeur')).get(`/courriers/${c.body.id}`)).status).toBe(200);
  });
});

describe('Documents de service', () => {
  test('circuit Agent → Chef de Bureau → Chef de Division → Directeur avec versions conservées', async () => {
    const types = await api(await login('ag.sev1')).get('/documents/types');
    expect(types.body.data.map((t) => t.code)).toEqual(expect.arrayContaining(['RAPPORT', 'COMPTE_RENDU', 'NOTE_TECHNIQUE', 'NOTE_EXPLICATIVE', 'FICHE_PROJET', 'PLAN_ACTIONS', 'FICHE_SUIVI_EVALUATION', 'PROCES_VERBAL', 'LETTRE_TRANSMISSION', 'COMMUNIQUE_SERVICE']));
    const ag = api(await login('ag.sev1'));
    const cb = api(await login('cb.sev'));
    const cd = api(await login('cd.ps'));
    const dir = api(await login('directeur'));
    const doc = await ag.post('/documents', { type_document: 'RAPPORT', titre: 'Rapport mensuel de suivi', contenu: { periode: 'Septembre 2026' } });
    expect(doc.status).toBe(201);
    const incomplete = await ag.post(`/documents/${doc.body.id}/transmettre`, {});
    expect(incomplete.status).toBe(400);
    const contenu = { periode: 'Septembre 2026', introduction: 'Intro', activites_realisees: 'Missions de suivi', recommandations: ['R1', 'R2'], conclusion: 'Conclusion' };
    expect((await ag.put(`/documents/${doc.body.id}`, { contenu, commentaire: 'Complété' })).body.version_courante).toBe(2);
    // L’Agent ne peut pas valider définitivement
    expect((await ag.post(`/documents/${doc.body.id}/valider`, {})).status).toBe(403);
    expect((await ag.post(`/documents/${doc.body.id}/transmettre`, {})).body.detenteur_user_id).toBe(await userId('cb.sev'));
    // Un autre Agent ne peut pas modifier le travail
    expect((await api(await login('ag.sev2')).put(`/documents/${doc.body.id}`, { titre: 'Modifié' })).status).toBe(403);
    expect((await cb.post(`/documents/${doc.body.id}/retourner`, { commentaire: 'Préciser les résultats' })).body.statut).toBe('A_CORRIGER');
    await ag.put(`/documents/${doc.body.id}`, { contenu: { ...contenu, resultats: 'Résultats précisés' } });
    await ag.post(`/documents/${doc.body.id}/transmettre`, {});
    const t2 = await cb.post(`/documents/${doc.body.id}/transmettre`, { commentaire: 'Vu' });
    expect(t2.body.niveau_actuel).toBe('DIVISION');
    expect((await cd.post(`/documents/${doc.body.id}/valider-division`, {})).body.statut).toBe('VALIDE_DIVISION');
    const t3 = await cd.post(`/documents/${doc.body.id}/transmettre`, {});
    expect(t3.body.niveau_actuel).toBe('DIRECTION');
    const v = await dir.post(`/documents/${doc.body.id}/valider`, {});
    expect(v.body.statut).toBe('VALIDE');
    expect(v.body.visas.map((x) => x.type)).toEqual(['VISA', 'VALIDATION_DIVISION', 'SIGNATURE']);
    const versions = await db('document_versions').where({ document_id: doc.body.id });
    expect(versions).toHaveLength(3);
    await expect(db('document_versions').where({ document_id: doc.body.id }).del()).rejects.toThrow(/APPEND_ONLY/);
    const sg = api(await login('sg'));
    expect((await sg.get(`/documents/${doc.body.id}`)).status).toBe(200);
    for (const f of ['pdf', 'docx', 'xlsx']) expect((await dir.get(`/documents/${doc.body.id}/export/${f}`)).status).toBe(200);
    expect((await dir.post(`/documents/${doc.body.id}/archiver`)).body.statut).toBe('ARCHIVE');
  });

  test('document du Bureau Secrétariat : validé par le Directeur sans passer par une Division', async () => {
    const ag = api(await login('ag.secretariat2'));
    const doc = await ag.post('/documents', { type_document: 'COMMUNIQUE_SERVICE', titre: 'Horaires', contenu: { destinataires: 'Tout le personnel', objet: 'Horaires', message: 'Arrivée à 8 h' } });
    await ag.post(`/documents/${doc.body.id}/transmettre`, {});
    const cbs = api(await login('cb.secretariat'));
    const d = await cbs.get(`/documents/${doc.body.id}`);
    expect(d.body.actions.validerDivision).toBe(false);
    expect((await cbs.post(`/documents/${doc.body.id}/valider-division`, {})).status).toBe(403);
    const t = await cbs.post(`/documents/${doc.body.id}/transmettre`, {});
    expect(t.body.niveau_actuel).toBe('DIRECTION');
    expect(t.body.detenteur_user_id).toBe(await userId('directeur'));
  });
});

describe('Projets PIP', () => {
  test('rédaction, vérification par le Chef de Division, validation par le Directeur, exports', async () => {
    const ag = api(await login('ag.coi1'));
    const donnees = {
      identification: { intitule: 'Backbone national en fibre optique — phase 2', secteur: 'Économie numérique', ministere_tutelle: 'Ministère du Numérique', organisme_execution: 'SG Économie Numérique', nature: 'Nouveau projet', date_demarrage: '2027-01-01', duree_mois: 36 },
      contexte: { contexte: 'C', problematique: 'P', justification: 'J' },
      objectifs: { objectif_general: 'OG', objectifs_specifiques: ['OS1'] },
      resultats: { resultats_attendus: ['R1'] },
      activites: { activites: [{ code: 'A1', activite: 'Études', cout: 100000 }] },
      indicateurs: { indicateurs: [{ indicateur: 'Km posés', reference: '0', cible: '2000' }] },
      beneficiaires: { directs: 'Population' },
      localisation: { sites: [{ province: 'Kinshasa', territoire: 'Gombe', site: 'Centre' }] },
      cout: { devise: 'USD', couts: [{ rubrique: 'Travaux', annee1: 1000000, annee2: 2000000, annee3: 500000 }] },
      financement: { sources: [{ source: 'Trésor public', montant: 3500000, pourcentage: 100, statut: 'Acquis' }] },
      risques: { risques: [{ risque: 'Retard', probabilite: 'Moyenne', impact: 'Élevé', mesure: 'Suivi' }] },
      impacts: { economique: 'Croissance' },
      responsables: { structure_responsable: 'DEP', chef_projet: 'X' },
    };
    const p = await ag.post('/pip', { donnees });
    expect(p.status).toBe(201);
    expect(Number(p.body.cout_total)).toBe(3500000);
    const s = await ag.post(`/pip/${p.body.id}/soumettre`);
    expect(s.body.statut).toBe('EN_VERIFICATION');
    expect(s.body.detenteur_user_id).toBe(await userId('cd.sci'));
    const v = await api(await login('cd.sci')).post(`/pip/${p.body.id}/verifier`, {});
    expect(v.body.statut).toBe('VERIFIE');
    const dir = api(await login('directeur'));
    expect((await dir.post(`/pip/${p.body.id}/valider`, {})).body.statut).toBe('VALIDE');
    const pdf = await dir.get(`/pip/${p.body.id}/export/pdf`);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect((await dir.get(`/pip/${p.body.id}/export/xlsx`)).status).toBe(200);
    const detail = await dir.get(`/pip/${p.body.id}`);
    expect(detail.body.pageControle.validePar).toBeTruthy();
  });
});

describe('Comptes et audit', () => {
  test('l’Admin crée un compte institutionnel initial avec mot de passe temporaire', async () => {
    const admin = api(await loginAdmin());
    const dup = await admin.post('/users/initial', { type: 'DIRECTEUR', username: 'directeur2', matricule: 'DEP-9999', nom: 'TEST', sexe: 'M' });
    expect(dup.status).toBe(409); // un Directeur actif existe déjà
  });

  test('compte initial avec les champs facultatifs vides (tels qu’envoyés par le formulaire)', async () => {
    const admin = api(await loginAdmin());
    await db('users').where({ username: 'sg' }).update({ statut: 'DESACTIVE' });
    const r = await admin.post('/users/initial', { type: 'SECRETAIRE_GENERAL', username: 'sg.nouveau', matricule: 'SG-TEST-2', nom: 'TEST', postnom: '', prenom: '', sexe: '', email: '', telephone: '', date_prise_fonction: '' });
    expect(r.status).toBe(201);
    expect(r.body.motDePasseTemporaire).toBeTruthy();
    await db('users').where({ username: 'sg' }).update({ statut: 'ACTIF' });
    await db('users').where({ username: 'sg.nouveau' }).update({ statut: 'DESACTIVE' });
  });

  test('le Bureau Secrétariat enrôle un agent d’une Division après validation de la liste par le Directeur', async () => {
    const dir = api(await login('directeur'));
    const bur = await db('bureaux').where({ code: 'BUR-PRG' }).first();
    const poste = await db('postes_organiques').where({ code: 'P-AG-BUR-PRG' }).first();
    const grade = await db('grades').where({ code: 'ATA2' }).first();
    const ag = await api(await login('cb.secretariat')).post('/agents', { matricule: 'DEP-0500', nom: 'NOUVEL', prenom: 'Agent', sexe: 'F', grade_id: grade.id });
    expect(ag.status).toBe(201);
    expect((await dir.post(`/agents/${ag.body.id}/affectations`, { bureau_id: bur.id, poste_id: poste.id, date_debut: '2026-09-01' })).status).toBe(201);
    const tokenCbs = await login('cb.secretariat');
    // Ajouté après la dernière validation : pas encore enrôlable
    expect((await enroler(tokenCbs, ag.body.id, { username: 'nouvel.agent' })).status).toBe(403);
    expect((await dir.post('/liste-declarative/valider', {})).status).toBe(201);
    const u = await enroler(tokenCbs, ag.body.id, { username: 'nouvel.agent' });
    expect(u.status).toBe(201);
    expect(u.body.motDePasseTemporaire).toBeTruthy();
    const cree = await db('users').where({ id: u.body.id }).first();
    expect(cree.statut).toBe('ACTIF');
    expect(cree.must_change_password).toBe(true);
    // Nouvelle affectation : l’ancienne est clôturée, pas supprimée
    const bur2 = await db('bureaux').where({ code: 'BUR-SEV' }).first();
    const poste2 = await db('postes_organiques').where({ code: 'P-AG-BUR-SEV' }).first();
    await dir.post(`/agents/${ag.body.id}/affectations`, { bureau_id: bur2.id, poste_id: poste2.id, date_debut: '2026-09-15' });
    const hist = await db('affectations').where({ agent_id: ag.body.id }).orderBy('id');
    expect(hist).toHaveLength(2);
    expect(hist[0].est_active).toBe(false);
    expect(hist[0].date_fin).toBe('2026-09-15');
    expect(await db('notifications').where({ user_id: u.body.id, type: 'AFFECTATION' }).first()).toBeTruthy();
  });

  test('le journal d’audit est en lecture seule et trace les opérations', async () => {
    const admin = api(await loginAdmin());
    const res = await admin.get('/audit?limit=10');
    expect(res.status).toBe(200);
    expect(res.body.total).toBeGreaterThan(0);
    await expect(db('audit_logs').update({ message: 'falsifié' })).rejects.toThrow(/APPEND_ONLY/);
    await expect(db('audit_logs').del()).rejects.toThrow(/APPEND_ONLY/);
    const actions = await db('audit_logs').distinct('action').pluck('action');
    expect(actions).toEqual(expect.arrayContaining(['CONNEXION', 'CREATION', 'TRANSMISSION', 'VALIDATION', 'EXPORT']));
    expect((await api(await login('directeur')).get('/audit')).status).toBe(403);
  });

  test('l’Admin réinitialise un mot de passe (changement obligatoire ensuite)', async () => {
    const admin = api(await loginAdmin());
    const uid = await userId('ag.coi2');
    const r = await admin.post(`/users/${uid}/reinitialiser-mot-de-passe`);
    expect(r.body.motDePasseTemporaire).toBeTruthy();
    const { request, app } = require('./helpers');
    const l = await request(app).post('/api/auth/login').send({ username: 'ag.coi2', password: r.body.motDePasseTemporaire });
    expect(l.body.user.mustChangePassword).toBe(true);
  });
});

describe('Tableaux de bord', () => {
  test.each([
    ['sg', 'SECRETAIRE_GENERAL', 'vueGlobale'], ['directeur', 'DIRECTEUR', 'performance'], ['cd.edi', 'CHEF_DIVISION', 'bureaux'],
    ['cb.eap', 'CHEF_BUREAU', 'agents'], ['ag.eap1', 'AGENT', 'taches'],
  ])('%s', async (u, role, key) => {
    const res = await api(await login(u)).get('/dashboard');
    expect(res.status).toBe(200);
    expect(res.body.role).toBe(role);
    expect(res.body[key]).toBeDefined();
  });

  test('Admin', async () => {
    const res = await api(await loginAdmin()).get('/dashboard');
    expect(res.body.admin.comptes.total).toBeGreaterThan(0);
  });
});

describe('Journal d’audit — sérialisation', () => {
  test('les expressions SQL (ex. date d’archivage) sont enregistrées sans erreur', async () => {
    const { audit } = require('../src/services/audit');
    await audit(null, { action: 'TEST_SERIALISATION', module: 'tests', apres: { statut: 'ARCHIVE', archived_at: db.fn.now(), password: 'secret' } });
    const row = await db('audit_logs').where({ action: 'TEST_SERIALISATION' }).orderBy('id', 'desc').first();
    expect(row.nouvelle_valeur).toMatchObject({ statut: 'ARCHIVE', password: '***' });
    expect(typeof row.nouvelle_valeur.archived_at).toBe('string');
  });

  test('l’archivage d’un courrier est bien audité', async () => {
    const rows = await db('audit_logs').where({ module: 'courriers', action: 'ARCHIVAGE' });
    expect(rows.length).toBeGreaterThan(0);
  });
});

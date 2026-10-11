'use strict';
/**
 * Réinitialisation de la base par l’Admin (mise en service).
 * Le test se termine par un rechargement des données fictives pour laisser la base
 * de test dans son état de démonstration.
 */
const { db, login, loginAdmin, api, avecConfirmation, ADMIN_NEW } = require('./helpers');

describe('Réinitialisation de la base', () => {
  let admin;
  let mdpDirecteur; // Directeur créé après la base vierge : valide la réinitialisation suivante
  beforeAll(async () => { admin = api(await loginAdmin()); });

  test('réservée à l’Admin, avec phrase de confirmation et mot de passe', async () => {
    for (const u of ['directeur', 'cb.secretariat', 'sg']) {
      const c = api(await login(u));
      expect((await c.get('/systeme/reinitialisation')).status).toBe(403);
      expect((await c.post('/systeme/reinitialisation', { mode: 'VIERGE', confirmation: 'REINITIALISER', motDePasse: 'Demo@2026', sauvegarde: false })).status).toBe(403);
    }
    const e = await admin.get('/systeme/reinitialisation');
    expect(e.status).toBe(200);
    expect(e.body.donneesDemo).toBe(true);
    expect(e.body.volumes.agents).toBeGreaterThan(20);
    expect((await admin.get('/dashboard')).body.admin.donneesDemo).toBe(true);
    expect((await admin.post('/systeme/reinitialisation', { mode: 'VIERGE', confirmation: 'oui', motDePasse: ADMIN_NEW, sauvegarde: false })).status).toBe(400);
    expect((await admin.post('/systeme/reinitialisation', { mode: 'VIERGE', confirmation: 'REINITIALISER', motDePasse: 'mauvais', sauvegarde: false })).status).toBe(400);
    expect(Number((await db('agents').count('* as n').first()).n)).toBeGreaterThan(20);
  });

  test('base vierge : seuls l’organigramme, les référentiels et le compte Admin subsistent', async () => {
    const divisions = Number((await db('divisions').count('* as n').first()).n);
    const compte = async (t) => Number((await db(t).count('* as n').first()).n);
    const [auditAvant, connexionsAvant] = [await compte('audit_logs'), await compte('login_history')];
    const corps = { mode: 'VIERGE', confirmation: 'reinitialiser', motDePasse: ADMIN_NEW, sauvegarde: false };
    // Opération critique : sans confirmation du Directeur, une demande est créée et rien n’est effacé.
    const attente = await admin.post('/systeme/reinitialisation', corps);
    expect(attente.status).toBe(202);
    expect(attente.body).toMatchObject({ confirmationRequise: true, demande: { type: 'REINITIALISATION', statut: 'EN_ATTENTE' } });
    expect(Number((await db('agents').count('* as n').first()).n)).toBeGreaterThan(20);
    const r = await avecConfirmation(admin, 'post', '/systeme/reinitialisation', corps);
    expect(r.status).toBe(200);
    // Comptes conservés : l’Admin et le compte d’urgence (toujours scellé).
    expect(r.body.volumes).toMatchObject({ agents: 0, comptes: 2, instructions: 0, courriers: 0, documents: 0, pip: 0 });
    expect(await db('users').where({ compte_urgence: true, statut: 'DESACTIVE' }).first()).toBeTruthy();
    // La confirmation ne sert qu’une fois et reste tracée.
    expect((await db('demandes_confirmation').where({ id: attente.body.demande.id }).first()).statut).toBe('EXECUTEE');
    expect(Number((await db('divisions').count('* as n').first()).n)).toBe(divisions);
    expect(await compte('effectif_reference')).toBe(6); // référentiel du cadre organique conservé
    // Traçabilité conservée : ni le journal d’audit ni l’historique des connexions ne sont effacés
    expect(await compte('audit_logs')).toBeGreaterThan(auditAvant);
    expect(await compte('login_history')).toBeGreaterThanOrEqual(connexionsAvant);
    expect((await admin.get('/audit/integrite')).body.integre).toBe(true);
    // L’Admin conserve sa double authentification
    expect((await db('users').where({ username: 'admin' }).first()).totp_actif).toBe(true);
    expect(await db('bureaux').where({ code: 'BSD', est_secretariat_direction: true }).first()).toBeTruthy();
    // L’Admin reste connecté et la réinitialisation est tracée
    const e = await admin.get('/systeme/reinitialisation');
    expect(e.status).toBe(200);
    expect(e.body.donneesDemo).toBe(false);
    const log = await db('audit_logs').where({ action: 'REINITIALISATION', resultat: 'SUCCES' }).first();
    expect(log.message).toMatch(/base vierge/);
    // Mise en service : l’Admin crée le Directeur, qui trouve une liste vide à constituer
    const d = await admin.post('/users/initial', { type: 'DIRECTEUR', username: 'directeur.dep', matricule: 'DIR-0001', nom: 'DIRECTEUR', prenom: 'Test' });
    expect(d.status).toBe(201);
    mdpDirecteur = d.body.motDePasseTemporaire;
    const { request, app } = require('./helpers');
    await db('users').where({ id: d.body.id }).update({ must_change_password: false });
    const l = await request(app).post('/api/auth/login').send({ username: 'directeur.dep', password: d.body.motDePasseTemporaire });
    // Le Directeur configure d’abord la double authentification et son adresse de récupération.
    expect(l.body.user.exigences).toEqual(expect.arrayContaining(['DEUX_FACTEURS', 'EMAIL_RECUPERATION', 'REGLES']));
    expect((await api(l.body.accessToken).get('/liste-declarative')).body.error.code).toBe('CONFIGURATION_SECURITE_REQUISE');
    const { login } = require('./helpers');
    const dir = api(await login('directeur.dep', d.body.motDePasseTemporaire));
    const liste = await dir.get('/liste-declarative');
    expect(liste.body).toMatchObject({ statut: 'NON_VALIDEE', actions: { valider: true } });
    expect((await dir.post('/liste-declarative/valider', {})).status).toBe(400); // liste vide
  });

  test('rechargement des données fictives de démonstration', async () => {
    const r = await avecConfirmation(admin, 'post', '/systeme/reinitialisation', { mode: 'DEMO', confirmation: 'REINITIALISER', motDePasse: ADMIN_NEW, sauvegarde: false },
      { valideur: 'directeur.dep', motDePasse: mdpDirecteur });
    expect(r.status).toBe(200);
    expect(r.body.volumes.agents).toBeGreaterThan(20);
    expect(r.body.volumes.instructions).toBeGreaterThan(0);
    expect((await admin.get('/systeme/reinitialisation')).body.donneesDemo).toBe(true);
    expect(await db('users').where({ username: 'directeur.dep' }).first()).toBeUndefined();
    // Les comptes fictifs fonctionnent à nouveau
    expect((await api(await login('directeur')).get('/liste-declarative')).body.statut).toBe('VALIDEE');
  });
});

'use strict';
/**
 * Lot 10A — Données sectorielles : annuaire des acteurs (doublons, historique, import contrôlé),
 * questionnaires versionnés, campagnes, saisie, contrôle de qualité et validation. Données fictives.
 */
const ExcelJS = require('exceljs');
const { app, db, request, login, api, userId } = require('./helpers');

const binaire = (r) => r.buffer(true).parse((res, cb) => { const d = []; res.on('data', (c) => d.push(c)); res.on('end', () => cb(null, Buffer.concat(d))); });

describe('Données sectorielles', () => {
  let doi; let doi2; let eap; let cbeap; let cdedi; let str; let sg; let ref; let a1; let a2; let a3; let questionnaire; let v1;
  beforeAll(async () => {
    doi = api(await login('ag.doi1')); doi2 = api(await login('ag.doi2')); eap = api(await login('ag.eap1')); cbeap = api(await login('cb.eap'));
    cdedi = api(await login('cd.edi')); str = api(await login('ag.str1')); sg = api(await login('sg'));
    ref = (await doi.get('/donnees/referentiel')).body;
  });
  const zone = (l) => ref.zones.find((z) => z.libelle === l).id;
  const cat = (c) => ref.categories.find((x) => x.code === c).id;

  test('référentiel : 26 provinces, catégories modifiables, droits selon la structure', async () => {
    expect(ref.zones).toHaveLength(26);
    expect(ref.categories.length).toBeGreaterThanOrEqual(10);
    expect(ref.droits).toMatchObject({ annuaire: true, saisir: true, controler: true, questionnaires: false, valider: false });
    expect((await eap.get('/donnees/referentiel')).body.droits).toMatchObject({ annuaire: false, saisir: true, controler: false, questionnaires: true });
    expect((await cdedi.get('/donnees/referentiel')).body.droits).toMatchObject({ annuaire: true, questionnaires: true, controler: true, valider: true });
    expect((await str.get('/donnees/referentiel')).body.droits).toMatchObject({ annuaire: false, saisir: false, questionnaires: false });
    expect((await eap.post('/donnees/categories', { code: 'XYZ', libelle: 'Interdit' })).status).toBe(403);
    const c = await doi.post('/donnees/categories', { code: 'iot', libelle: 'Objets connectés (essai)', ordre: 99 });
    expect(c.status).toBe(201);
    expect(c.body.code).toBe('IOT');
    expect((await doi.post('/donnees/categories', { code: 'IOT', libelle: 'Doublon' })).status).toBe(409);
  });

  test('annuaire : création, doublons refusés, modification historisée', async () => {
    expect((await eap.post('/donnees/acteurs', { raison_sociale: 'Interdit', categorie_id: cat('FAI'), zone_id: zone('Kinshasa') })).status).toBe(403);
    const r1 = await doi.post('/donnees/acteurs', { raison_sociale: 'Fictive Connect SARL', sigle: 'FICO', categorie_id: cat('FAI'), zone_id: zone('Kinshasa'), rccm: 'CD/KNG/RCCM/00-B-00001', effectif: 40 });
    expect(r1.status).toBe(201);
    expect(r1.body.reference).toMatch(/^DEP\/ACT\/\d{4}\/\d{4}$/);
    a1 = r1.body;
    a2 = (await doi.post('/donnees/acteurs', { raison_sociale: 'Essai Data Center SA', categorie_id: cat('DC'), zone_id: zone('Haut-Katanga'), id_nat: '01-ESSAI-N00002' })).body;
    a3 = (await doi.post('/donnees/acteurs', { raison_sociale: 'Démo Logiciels SARL', categorie_id: cat('LOG'), zone_id: zone('Kinshasa') })).body;
    const rccm = await doi.post('/donnees/acteurs', { raison_sociale: 'Autre nom', categorie_id: cat('FAI'), zone_id: zone('Kinshasa'), rccm: 'cd/kng/rccm/00-b-00001' });
    expect(rccm.status).toBe(409);
    expect(rccm.body.error.message).toMatch(/RCCM/);
    expect((await doi.post('/donnees/acteurs', { raison_sociale: 'fictive connect sarl', categorie_id: cat('OPT'), zone_id: zone('Kinshasa') })).status).toBe(409);
    // Même raison sociale dans une autre province : accepté
    expect((await doi.post('/donnees/acteurs', { raison_sociale: 'Fictive Connect SARL', categorie_id: cat('FAI'), zone_id: zone('Kongo-Central') })).status).toBe(201);
    const m = await doi.put(`/donnees/acteurs/${a1.id}`, { ...a1, effectif: 55, statut: 'ACTIF', email: '' });
    expect(m.status).toBe(200);
    const d = (await sg.get(`/donnees/acteurs/${a1.id}`)).body;
    expect(d.effectif).toBe(55);
    expect(d.historique.map((h) => h.action)).toEqual(['CREATION', 'MODIFICATION']);
    expect(d.historique[1].commentaire).toMatch(/effectif/);
  });

  test('import contrôlé de l’annuaire : nouveaux, doublons et erreurs signalés avant confirmation', async () => {
    const modele = await binaire(doi.get('/donnees/acteurs/modele'));
    expect(modele.status).toBe(200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(modele.body);
    const ws = wb.getWorksheet('Acteurs');
    ws.addRow(['Import Alpha SARL', 'IAL', 'Fournisseurs d’accès à Internet', 'Nord-Kivu', 'Goma', null, 'SARL', 'CD/GOM/RCCM/00-B-00009']);
    ws.addRow(['Import Bêta', null, 'Centres de données et hébergeurs', 'Kinshasa']);
    ws.addRow(['Doublon RCCM', null, 'Fournisseurs d’accès à Internet', 'Kinshasa', null, null, null, 'CD/KNG/RCCM/00-B-00001']);
    ws.addRow(['Import Alpha SARL', null, 'Fournisseurs d’accès à Internet', 'Nord-Kivu']);
    ws.addRow(['Sans province', null, 'Fournisseurs d’accès à Internet', 'Atlantide']);
    const fichier = Buffer.from(await wb.xlsx.writeBuffer());
    expect((await request(app).post('/api/donnees/acteurs/import/analyser').set('Authorization', `Bearer ${await login('ag.eap1')}`).attach('fichier', fichier, 'annuaire.xlsx')).status).toBe(403);
    const an = await request(app).post('/api/donnees/acteurs/import/analyser').set('Authorization', `Bearer ${await login('ag.doi1')}`).attach('fichier', fichier, 'annuaire.xlsx');
    expect(an.status).toBe(200);
    expect(an.body.resume).toEqual({ nouveaux: 2, doublons: 2, erreurs: 1 });
    expect(an.body.lignes.find((l) => l.acteur.raison_sociale === 'Doublon RCCM').motif).toMatch(/RCCM/);
    expect(an.body.lignes.filter((l) => l.acteur.raison_sociale === 'Import Alpha SARL')[1].motif).toMatch(/ligne/);
    expect(an.body.lignes.find((l) => l.etat === 'ERREUR').motif).toMatch(/province inconnue/);
    const ok = await doi.post('/donnees/acteurs/import/confirmer', { fichier: 'annuaire.xlsx', acteurs: an.body.lignes.filter((l) => l.etat === 'NOUVEAU').map((l) => l.acteur) });
    expect(ok.status).toBe(201);
    expect(ok.body.importes).toBe(2);
    // Une seconde confirmation est refusée en bloc (doublons)
    const ko = await doi.post('/donnees/acteurs/import/confirmer', { acteurs: an.body.lignes.filter((l) => l.etat === 'NOUVEAU').map((l) => l.acteur) });
    expect(ko.status).toBe(409);
    expect(ko.body.error.message).toMatch(/Import Alpha SARL/);
    const ex = await binaire(sg.get('/donnees/acteurs/export'));
    expect(ex.status).toBe(200);
  });

  test('questionnaire versionné : validation de la définition, publication figée en base', async () => {
    expect((await doi.post('/donnees/questionnaires', { code: 'ANN-FAI', titre: 'Interdit' })).status).toBe(403);
    questionnaire = (await eap.post('/donnees/questionnaires', { code: 'ann-fai', titre: 'Enquête annuelle des fournisseurs d’accès (essai)' })).body;
    expect(questionnaire.code).toBe('ANN-FAI');
    v1 = (await eap.get(`/donnees/questionnaires/${questionnaire.id}`)).body.versions[0];
    const questions = [
      { code: 'ABONNES', libelle: 'Nombre d’abonnés', type: 'ENTIER', obligatoire: true, min: 0, unite: 'abonnés' },
      { code: 'ABONNES_FIXE', libelle: 'dont abonnés fixes', type: 'ENTIER', min: 0 },
      { code: 'CA', libelle: 'Chiffre d’affaires', type: 'NOMBRE', unite: 'CDF', min: 0 },
      { code: 'TECHNO', libelle: 'Technologie principale', type: 'CHOIX', options: ['Fibre', 'Radio', 'Satellite'], obligatoire: true },
      { code: 'COUVERTURE', libelle: 'Couverture hors chef-lieu', type: 'OUI_NON' },
    ];
    const mauvais = await eap.put(`/donnees/versions/${v1.id}`, { questions: [...questions, { code: 'ABONNES', libelle: 'Doublon', type: 'TEXTE' }], controles: [] });
    expect(mauvais.status).toBe(400);
    expect((await eap.put(`/donnees/versions/${v1.id}`, { questions, controles: [{ gauche: 'TECHNO', operateur: '<=', droite: 'ABONNES' }] })).status).toBe(400);
    const ok = await eap.put(`/donnees/versions/${v1.id}`, { questions, controles: [{ gauche: 'ABONNES_FIXE', operateur: '<=', droite: 'ABONNES', message: 'Les abonnés fixes ne peuvent dépasser le total.' }] });
    expect(ok.status).toBe(200);
    expect((await eap.post(`/donnees/versions/${v1.id}/publier`)).status).toBe(200);
    expect((await eap.put(`/donnees/versions/${v1.id}`, { questions: [], controles: [] })).status).toBe(400);
    await expect(db('sect_questionnaire_versions').where({ id: v1.id }).update({ questions: '[]' })).rejects.toThrow(/VERSION_FIGEE/);
    const v2 = await eap.post(`/donnees/questionnaires/${questionnaire.id}/versions`);
    expect(v2.status).toBe(201);
    expect(v2.body.version).toBe(2);
    expect(v2.body.questions).toHaveLength(5);
    expect((await eap.post(`/donnees/questionnaires/${questionnaire.id}/versions`)).status).toBe(400);
  });

  test('campagne : ciblage, saisie avec contrôles de qualité, contrôle à quatre yeux, validation et intangibilité', async () => {
    const resp = await userId('ag.eap2');
    const base = { titre: 'Collecte essai 2030', version_id: v1.id, periode: '2030', periode_debut: '2030-01-01', periode_fin: '2030-12-31', echeance: '2031-03-31', categories: [cat('FAI')], zones: [zone('Kinshasa')], responsable_id: resp };
    expect((await doi.post('/donnees/campagnes', base)).status).toBe(403);
    expect((await eap.post('/donnees/campagnes', { ...base, responsable_id: await userId('ag.str1') })).status).toBe(400);
    const c = (await eap.post('/donnees/campagnes', base)).body;
    expect(c.reference).toMatch(/^DEP\/COL\//);
    let d = (await eap.get(`/donnees/campagnes/${c.id}`)).body;
    expect(d.cibles.map((k) => k.id)).toEqual([a1.id]);
    await eap.post(`/donnees/campagnes/${c.id}/cibles`, { acteurs: [a2.id, a3.id] });
    await eap.del(`/donnees/campagnes/${c.id}/cibles/${a3.id}`);
    // Saisie impossible avant l’ouverture
    expect((await doi.put(`/donnees/campagnes/${c.id}/reponses/${a1.id}`, { valeurs: { ABONNES: 10 }, source: 'PAPIER' })).status).toBe(403);
    expect((await eap.post(`/donnees/campagnes/${c.id}/ouvrir`)).status).toBe(200);
    d = (await eap.get(`/donnees/campagnes/${c.id}`)).body;
    expect(d.cibles).toHaveLength(2);
    expect((await sg.get(`/donnees/campagnes/${c.id}`)).status).toBe(404);
    // Saisie avec erreurs : enregistrée en brouillon, transmission refusée
    const s1 = await doi.put(`/donnees/campagnes/${c.id}/reponses/${a1.id}`, { valeurs: { ABONNES: '1 200', ABONNES_FIXE: 1500, TECHNO: 'Laser', INCONNUE: 3 }, source: 'FICHIER', date_reception: '2031-01-15' });
    expect(s1.status).toBe(200);
    expect(s1.body.valeurs.ABONNES).toBe(1200);
    const msgs = s1.body.anomalies.map((a) => a.message).join(' | ');
    expect(msgs).toMatch(/Choix hors de la liste/);
    expect(msgs).toMatch(/Question inconnue : INCONNUE/);
    expect(msgs).toMatch(/abonnés fixes ne peuvent dépasser/);
    expect((await doi.post(`/donnees/campagnes/${c.id}/reponses/${a1.id}/soumettre`)).status).toBe(400);
    const s2 = await doi.put(`/donnees/campagnes/${c.id}/reponses/${a1.id}`, { valeurs: { ABONNES: 1200, ABONNES_FIXE: 300, CA: '2500000,5', TECHNO: 'Fibre', COUVERTURE: true }, source: 'FICHIER' });
    expect(s2.body.anomalies).toEqual([]);
    expect(s2.body.valeurs.CA).toBe(2500000.5);
    expect((await doi.post(`/donnees/campagnes/${c.id}/reponses/${a1.id}/soumettre`)).status).toBe(200);
    // Réponse transmise : plus modifiable ; contrôle par une autre personne
    expect((await doi.put(`/donnees/campagnes/${c.id}/reponses/${a1.id}`, { valeurs: {}, source: 'PAPIER' })).status).toBe(403);
    const auto = await doi.post(`/donnees/campagnes/${c.id}/reponses/${a1.id}/controler`, { decision: 'CONTROLEE' });
    expect(auto.status).toBe(403);
    expect(auto.body.error.message).toMatch(/autre personne/);
    expect((await eap.post(`/donnees/campagnes/${c.id}/reponses/${a1.id}/controler`, { decision: 'CONTROLEE' })).status).toBe(403);
    expect((await doi2.post(`/donnees/campagnes/${c.id}/reponses/${a1.id}/controler`, { decision: 'A_CORRIGER' })).status).toBe(400);
    expect((await doi2.post(`/donnees/campagnes/${c.id}/reponses/${a1.id}/controler`, { decision: 'A_CORRIGER', motif: 'Vérifier le chiffre d’affaires.' })).status).toBe(200);
    expect(await db('notifications').where({ user_id: await userId('ag.doi1'), type: 'DONNEES' }).where('titre', 'like', 'Réponse à corriger%').first()).toBeTruthy();
    await doi.put(`/donnees/campagnes/${c.id}/reponses/${a1.id}`, { valeurs: { ABONNES: 1200, ABONNES_FIXE: 300, CA: 2600000, TECHNO: 'Fibre' }, source: 'FICHIER' });
    await doi.post(`/donnees/campagnes/${c.id}/reponses/${a1.id}/soumettre`);
    expect((await doi2.post(`/donnees/campagnes/${c.id}/reponses/${a1.id}/controler`, { decision: 'CONTROLEE' })).status).toBe(200);
    // Second acteur : saisi par le Bureau Études, laissé en brouillon puis supprimé
    await eap.put(`/donnees/campagnes/${c.id}/reponses/${a2.id}`, { valeurs: { ABONNES: 5 }, source: 'PAPIER' });
    expect((await cbeap.post(`/donnees/campagnes/${c.id}/cloturer`)).status).toBe(200);
    expect((await cdedi.post(`/donnees/campagnes/${c.id}/valider`)).body.error.message).toMatch(/1 réponse\(s\) ne sont pas contrôlées/);
    expect((await cdedi.post(`/donnees/campagnes/${c.id}/retourner`, { motif: 'Compléter ou retirer la réponse en brouillon.' })).status).toBe(200);
    expect((await eap.del(`/donnees/campagnes/${c.id}/reponses/${a2.id}`)).status).toBe(200);
    await eap.post(`/donnees/campagnes/${c.id}/cloturer`);
    expect((await eap.post(`/donnees/campagnes/${c.id}/valider`)).status).toBe(403);
    expect((await cdedi.post(`/donnees/campagnes/${c.id}/valider`)).status).toBe(200);
    // Campagne validée : intangible, visible du Secrétaire Général, exportable
    await expect(db('sect_reponses').where({ campagne_id: c.id }).update({ statut: 'BROUILLON' })).rejects.toThrow(/CAMPAGNE_VALIDEE/);
    await expect(db('sect_campagnes').where({ id: c.id }).update({ titre: 'x' })).rejects.toThrow(/CAMPAGNE_VALIDEE/);
    expect((await sg.get(`/donnees/campagnes/${c.id}`)).status).toBe(200);
    const ex = await binaire(sg.get(`/donnees/campagnes/${c.id}/export`));
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(ex.body);
    const ws = wb.getWorksheet('Réponses');
    const ligne = [3, 4].map((n) => ws.getRow(n).values.slice(1)).find((l) => l[0] === a1.reference);
    expect(ligne.slice(0, 5)).toEqual([a1.reference, 'Fictive Connect SARL', expect.any(String), 'Kinshasa', 'Contrôlée']);
    expect(ligne).toContain(2600000);
    const h = (await eap.get(`/donnees/campagnes/${c.id}`)).body.historique.map((x) => x.action);
    expect(h).toEqual(expect.arrayContaining(['CREATION', 'CIBLAGE', 'OUVERTURE', 'CLOTURE', 'RETOUR_CORRECTION', 'VALIDATION']));

    // Période suivante : variation forte signalée en alerte, à justifier avant transmission
    const c2 = (await eap.post('/donnees/campagnes', { ...base, titre: 'Collecte essai 2031', periode: '2031', periode_debut: '2031-01-01', periode_fin: '2031-12-31', echeance: '2032-03-31' })).body;
    await eap.post(`/donnees/campagnes/${c2.id}/ouvrir`);
    const r = await doi.put(`/donnees/campagnes/${c2.id}/reponses/${a1.id}`, { valeurs: { ABONNES: 4000, TECHNO: 'Radio' }, source: 'COURRIEL' });
    expect(r.body.anomalies).toEqual([expect.objectContaining({ niveau: 'ALERTE', question: 'ABONNES', message: expect.stringMatching(/hausse de 233 %/) })]);
    expect((await doi.post(`/donnees/campagnes/${c2.id}/reponses/${a1.id}/soumettre`)).body.error.message).toMatch(/Justifiez/);
    await doi.put(`/donnees/campagnes/${c2.id}/reponses/${a1.id}`, { valeurs: { ABONNES: 4000, TECHNO: 'Radio' }, source: 'COURRIEL', justification: 'Rachat d’un concurrent confirmé par courrier.' });
    expect((await doi.post(`/donnees/campagnes/${c2.id}/reponses/${a1.id}/soumettre`)).status).toBe(200);
    const fiche = (await doi.get(`/donnees/campagnes/${c2.id}/reponses/${a1.id}`)).body;
    expect(fiche.precedent.ABONNES).toBe(1200);
    expect(fiche.actions).toMatchObject({ saisir: false, controler: false });
    expect((await doi2.get(`/donnees/campagnes/${c2.id}/reponses/${a1.id}`)).body.actions.controler).toBe(true);
  });
});

'use strict';
/**
 * Fiche PIP au modèle du Ministère du Plan (1.34.0) : page de contrôle (rubriques, cohérence coût /
 * financement), export et import du classeur à six feuilles, référentiels des services, du PNSD et
 * de la stratégie sectorielle, conversion des fiches de l’ancien modèle.
 */
const ExcelJS = require('exceljs');
const { db, request, app, login, api } = require('./helpers');
const { fiche } = require('./pipFiche');
const pipExcel = require('../src/services/pipExcel');
const { convertir } = require('../src/db/migrations/20261020000026_pip_modele_plan');
const { normalize } = require('../src/modules/pip/model');

const binaire = (r) => r.buffer(true).parse((res, cb) => { const d = []; res.on('data', (c) => d.push(c)); res.on('end', () => cb(null, Buffer.concat(d))); });

/** Classeur rempli « à la main » au modèle du Plan : montants en texte, dates « Jan-27 », lignes en plus. */
async function classeurManuel() {
  const wb = new ExcelJS.Workbook();
  const f = Array.from({ length: 6 }, (_, i) => wb.addWorksheet(`Feuil${i + 1}`));
  const put = (ws, cells) => Object.entries(cells).forEach(([a, v]) => { ws.getCell(a).value = v; });
  put(f[0], {
    F1: 'République Démocratique du Congo', E2: 'Ministère du Plan', D4: 'FICHE DE PROJET', D5: 'Etape :', E5: 'Identification', G5: '* Sélection',
    C6: 'Ministère / Institution :', D6: '01 Ministère de l’Économie Numérique', C7: 'Service / Société d\'Etat :', D7: 'Direction Cybersécurité (DCS)',
    B8: 'N° projet :', C8: '7', D8: 'Libellé :', E8: 'Centre national d’essai (fictif)', B9: 'Compétence :', C9: 'Pouvoir central', B10: 'Province :', E10: 'Secteur prioritaire :',
    A11: 'Secteur du projet', D11: 'Gouvernance', F11: 'Ss-secteur', G11: 'Numérique', A12: 'Nature d\'investissement', D12: 'Immobilisation incorporelle',
    A13: 'Province', D13: 'Kinshasa', A14: 'Ville/Territoire', D14: 'Kinshasa', A15: 'Commune/Secteur/Chefferie', D15: 'Gombe',
    A16: 'Rattachement PNSD', B17: '- Pilier', C17: 'Pilier d’essai', B18: '- Thématique', B19: '- Domaine', B20: '- Objectif spécifique',
    A21: 'Rattachement stratégie sectorielle', B22: '- Programme budg.', C22: 'Programme d’essai', B23: '- Action', C23: 'Action d’essai',
    A24: 'Justification du projet', B25: '- Problème identifié', C25: 'Problème', B26: '- Situation actuelle', C26: 'Actuelle', B27: '- Situation visée', C27: 'Visée',
  });
  put(f[1], {
    A1: 'Objectifs visés', A2: 'Objectif global', B2: 'Global', A3: 'Objectif spécifique 1', B3: 'OS1', A4: 'Objectif spécifique 2', B4: 'OS2', A5: 'Objectif spécifique 3',
    A6: 'Résultats attendus', B7: '- Résultat 1', C7: 'R1', B8: '- Résultat 2', B9: '- Résultat 3',
    A10: 'Bénéficiaires directs', B11: '- Descriptif', C11: 'Agents', B12: '- Aspect Genre', C12: 'Accès égal',
    A13: 'Bénéficiaires indirects', B14: '- Descriptif', C14: 'Citoyens', B15: '- Aspect Genre',
    A16: 'Effets/Impacts', B17: '- Effet / Impact 1', C17: 'E1', B18: '- Effet / Impact 2', B19: '- Effet / Impact 3',
  });
  put(f[2], {
    C1: 'Date de début prévue', D1: 'Jan-27', G1: 'Date de fin prévue', H1: 'Dec-28', L1: 'Durée prévue (en mois)', M1: 24,
    A2: 'Principales activités (planning)', E2: 2027, G2: 2028, I2: 2029, K2: 2030,
    A3: '1- Préparation', E3: 'Janvier-Mars', A4: '2- Déploiement', E4: 'Avril-Déc', G4: 'Janvier-Juin', A5: '3- Formation', G5: 'Juillet',
    A6: '4- Recette', G6: 'Août', A7: '5-', A8: '6- Clôture (ligne en plus)', G8: 'Décembre',
    A9: 'Indicateurs de résultats', E9: 'Année 1', G9: 'Année 2', I9: 'Année 3', K9: 'Autres', A10: '1- Utilisateurs', E10: '50', G10: '200',
    A13: 'Indicateurs d\'effets / impacts (Formule de calcul)', E13: 'Réf 2026', G13: 'Année 1', I13: 'Année 2', K13: 'Année 3', A14: '1- Délai (heures)', E14: '24h', G14: '4h',
  });
  put(f[3], {
    A1: 'Aspect financier', G1: '(en CDF)', A2: 'Coût du Projet :', D2: '3,000,000', E2: '(prévisionnel)', A3: 'Répartition des coûts par grandes masses',
    A4: 'Rubriques', D4: 2027, E4: 2028, F4: 2029, G4: 2030, H4: 'Total',
    A5: '1- Etudes', D5: '500,000', H5: '500,000', A6: '2- Acquisition de terrains', A7: '3- Construction/réhabilitation', A8: '4- Equipements (serveurs)', D8: '1,000,000', E8: '1 500 000',
    A9: '5- Frais de mise en œuvre', A10: '6- Autres', C11: 'Total', D11: '1,500,000', E11: '1,500,000', H11: '3,000,000',
    A12: 'Plan de financement', A13: 'Sources de financement', C13: 'Prêt / don', D13: 2027, E13: 'Année 2', F13: 'Année 3', G13: 'Autres', H13: 'Total',
    A14: '1- Etat', D14: '1,500,000', E14: '1,000,000', A15: '2- Partenaire d’essai', C15: 'Don', E15: 500000, A16: '5- En négociation', A17: '6- A rechercher', C18: 'Total',
    A19: 'Coûts récurrents après mise en exploitation (par an)', A20: 'Rubriques', D20: 2029, E20: 'Année 2', F20: 'Année 3', G20: 'Année 4', H20: 'Année std',
    A21: '1- Charges salariales', D21: '100,000', A22: '2- Maintenance', A23: '3- Eau/électricité/tél…', C24: 'Total',
    A25: 'Aspect institutionnel', A26: 'Pendant le projet', A27: '1- Maitre d\'ouvrage', C27: 'Ministère de l’Économie Numérique', A28: '2- Maitre d’œuvre', C28: 'Prestataire',
    A29: 'Après le projet', A30: 'Structure responsable', C30: 'Direction Cybersécurité (DCS)',
  });
  put(f[4], {
    A1: 'Nombre d\'emplois créés', C1: 10, E1: 'dont femmes', F1: 4, G2: '(en CDF)', A3: 'Gains économiques estimés',
    A4: 'Rubriques', D4: 'Année 1', E4: 'Année 2', F4: 'Année 3', G4: 'Autres', H4: 'Total', A5: '1- Économies', D5: '200,000', A6: '2- ', C7: 'Total',
    A8: 'Impacts environnementaux', D8: 'Si négatif, mitigation', A9: '1- Moins de papier', D9: 'Positif',
    A11: 'Risques portant sur la réalisation du projet / Mitigation', A12: 'Risques', D12: 'Mitigations', A13: '1- Résistance', D13: 'Formation',
  });
  put(f[5], {
    A1: 'Commentaire libre', A2: 'Commentaire d’essai', A3: 'Si étape de sélection', A4: 'Etudes réalisées', A5: 'Nature de l\'étude', D5: 'Date de fin', F5: 'Montant',
    A6: 'Étude de faisabilité', D6: '06/2026', F6: '250,000', A7: 'Responsable du dossier', C7: 'Responsable d’essai', B8: 'Télephone', C8: '+243 000 000 000',
    B9: 'email', C9: 'essai@example.cd', B10: 'Date :', F10: 'Signature',
  });
  return Buffer.from(await wb.xlsx.writeBuffer());
}

describe('Fiche PIP — modèle du Ministère du Plan', () => {
  let ag; let dir; let cd;
  beforeAll(async () => { ag = api(await login('ag.coi1')); dir = api(await login('directeur')); cd = api(await login('cd.sci')); });

  test('modèle en huit étapes et suggestions des référentiels (13 services du Secrétariat Général)', async () => {
    const m = (await ag.get('/pip/modele')).body;
    expect(m.sections.map((s) => s.numero)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(m.vide.financier.couts.map((r) => r.rubrique)).toEqual(['Etudes', 'Acquisition de terrains', 'Construction/réhabilitation', 'Equipements', 'Frais de mise en œuvre', 'Autres']);
    expect(m.suggestions.SERVICES).toEqual(expect.arrayContaining(['Direction Cybersécurité (DCS)', 'Cabinet du Ministre (CAB)', 'Direction d’Études et Planification (DEP)']));
    expect(await db('plan_services').whereIn('sigle', ['CAB', 'SG', 'CTA', 'CGPMP', 'DRH', 'DAF', 'DEP', 'DANTIC', 'DIN', 'DACN', 'DEN', 'DDCN', 'DCS']).count().first()).toEqual({ count: '13' });
    expect(m.suggestions.PROVINCES).toHaveLength(26);
  });

  test('page de contrôle : rubriques manquantes et incohérences bloquent la soumission', async () => {
    const f = fiche();
    f.financier.financement = [{ source: 'Etat', annee1: 1000000 }];
    f.identification.etape = 'Sélection';
    const p = (await ag.post('/pip', { donnees: f })).body;
    const d = (await ag.get(`/pip/${p.id}`)).body;
    expect(d.rubriquesManquantes).toEqual(expect.arrayContaining([expect.stringMatching(/Études réalisées/)]));
    expect(d.incoherences).toEqual(expect.arrayContaining([expect.objectContaining({ bloquant: true, message: expect.stringMatching(/plan de financement/) })]));
    expect(d.synthese).toMatchObject({ coutTotal: 3500000, financementTotal: 1000000, anneeDebut: 2027 });
    const s = await ag.post(`/pip/${p.id}/soumettre`);
    expect(s.status).toBe(400);
    expect(s.body.error.message).toMatch(/Études réalisées/);
    // Rubriques complétées : reste l’incohérence de financement
    f.controle.etudes = [{ nature: 'Faisabilité', date_fin: '2026-06-30', montant: 100000 }];
    await ag.put(`/pip/${p.id}`, { donnees: f });
    expect((await ag.post(`/pip/${p.id}/soumettre`)).body.error.message).toMatch(/Incohérences/);
    f.financier.financement = fiche().financier.financement;
    f.institutionnel.emplois = 2; f.institutionnel.emplois_femmes = 3;
    await ag.put(`/pip/${p.id}`, { donnees: f });
    expect((await ag.post(`/pip/${p.id}/soumettre`)).body.error.message).toMatch(/femmes/);
    f.institutionnel.emplois_femmes = 1;
    await ag.put(`/pip/${p.id}`, { donnees: f });
    expect((await ag.post(`/pip/${p.id}/soumettre`)).status).toBe(200);
  });

  test('export au modèle du Plan (six feuilles, mêmes cellules) et relecture identique', async () => {
    const p = (await ag.post('/pip', { donnees: fiche() })).body;
    const x = await binaire(ag.get(`/pip/${p.id}/export/xlsx`));
    expect(x.status).toBe(200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(x.body);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Feuil1', 'Feuil2', 'Feuil3', 'Feuil4', 'Feuil5', 'Feuil6']);
    const [f1, , f3, f4] = wb.worksheets;
    expect(f1.getCell('D4').value).toBe('FICHE DE PROJET');
    expect(f1.getCell('E8').value).toBe('Backbone national en fibre optique — phase 2');
    expect(f1.getCell('C17').value).toBe('Pilier d’essai');
    expect(f3.getCell('E2').value).toBe(2027);
    expect(f3.getCell('M1').value).toBe(36);
    expect(f4.getCell('D4').value).toBe(2027);
    expect(f4.getCell('A5').value).toBe('1- Etudes');
    expect(f4.getCell('H11').value).toMatchObject({ formula: 'SUM(H5:H10)', result: 3500000 });
    expect(f4.getCell('D2').value).toMatchObject({ result: 3500000 });
    expect(f4.headerFooter.oddFooter).toMatch(/Avenue Lubefu/);
    const relu = await pipExcel.analyser(x.body);
    expect(relu.donnees).toEqual(normalize(p.donnees).donnees);
    const pdf = await binaire(ag.get(`/pip/${p.id}/export/pdf`));
    expect(pdf.headers['content-type']).toBe('application/pdf');
  });

  test('import d’un classeur rempli à la main : montants en texte, dates abrégées, lignes en plus', async () => {
    const r = await request(app).post('/api/pip/import/analyser').set('Authorization', `Bearer ${await login('ag.coi1')}`)
      .attach('fichier', await classeurManuel(), { filename: 'fiche-essai.xlsx' });
    expect(r.status).toBe(200);
    const d = r.body.donnees;
    expect(d.identification).toMatchObject({ etape: 'Sélection', libelle: 'Centre national d’essai (fictif)', service: 'Direction Cybersécurité (DCS)', numero_projet: '7', province_competence: '', secteur_prioritaire: '' });
    expect(d.rattachement).toMatchObject({ pnsd_pilier: 'Pilier d’essai', pnsd_thematique: '', strategie_action: 'Action d’essai' });
    expect(d.objectifs.objectifs_specifiques).toEqual(['OS1', 'OS2']);
    expect(d.calendrier).toMatchObject({ date_debut: '2027-01-01', date_fin: '2028-12-31', duree_mois: 24 });
    expect(d.calendrier.activites.map((a) => a.activite)).toEqual(['Préparation', 'Déploiement', 'Formation', 'Recette', 'Clôture (ligne en plus)']);
    expect(d.calendrier.activites[1]).toMatchObject({ annee1: 'Avril-Déc', annee2: 'Janvier-Juin' });
    expect(d.calendrier.indicateurs_effets[0]).toMatchObject({ indicateur: 'Délai (heures)', reference: '24h', annee1: '4h' });
    expect(d.financier.couts.find((c) => /Equipements/.test(c.rubrique))).toMatchObject({ annee1: 1000000, annee2: 1500000 });
    expect(d.financier.financement.map((s) => s.source)).toEqual(['Etat', 'Partenaire d’essai', 'En négociation', 'A rechercher']);
    expect(d.financier.financement[1]).toMatchObject({ pret_don: 'Don', annee2: 500000 });
    expect(d.institutionnel).toMatchObject({ emplois: 10, emplois_femmes: 4, maitre_oeuvre: 'Prestataire', structure_responsable: 'Direction Cybersécurité (DCS)' });
    expect(d.institutionnel.risques).toEqual([{ risque: 'Résistance', mitigation: 'Formation' }]);
    expect(d.controle).toMatchObject({ commentaire: 'Commentaire d’essai', responsable: 'Responsable d’essai', email: 'essai@example.cd' });
    expect(d.controle.etudes[0]).toMatchObject({ nature: 'Étude de faisabilité', date_fin: '2026-06-01', montant: 250000 });
    expect(r.body.synthese).toMatchObject({ coutTotal: 3000000, financementTotal: 3000000 });
    expect(r.body.incoherences.filter((x) => x.bloquant)).toEqual([]);
    // Création du brouillon depuis la fiche relue
    const c = await ag.post('/pip', { donnees: d, importe: 'fiche-essai.xlsx' });
    expect(c.status).toBe(201);
    expect(c.body.intitule).toBe('Centre national d’essai (fictif)');
    expect(await db('audit_logs').where({ action: 'IMPORT', entite_id: String(c.body.id) }).first()).toBeTruthy();
    // Fichier qui n’est pas une fiche
    const wb = new ExcelJS.Workbook(); wb.addWorksheet('X').getCell('A1').value = 'autre chose';
    const mauvais = await request(app).post('/api/pip/import/analyser').set('Authorization', `Bearer ${await login('ag.coi1')}`)
      .attach('fichier', Buffer.from(await wb.xlsx.writeBuffer()), { filename: 'autre.xlsx' });
    expect(mauvais.status).toBe(400);
  });

  test('référentiels PNSD et stratégie : hiérarchie contrôlée, réservés au Directeur', async () => {
    const pilier = await dir.post('/planification/rattachements', { referentiel: 'PNSD', niveau: 'PILIER', libelle: 'Pilier de test', edition: 'PNSD (essai)' });
    expect(pilier.status).toBe(201);
    expect((await dir.post('/planification/rattachements', { referentiel: 'PNSD', niveau: 'DOMAINE', parent_id: pilier.body.id, libelle: 'Domaine sans thématique' })).status).toBe(400);
    const th = await dir.post('/planification/rattachements', { referentiel: 'PNSD', niveau: 'THEMATIQUE', parent_id: pilier.body.id, libelle: 'Thématique de test' });
    expect(th.status).toBe(201);
    expect((await dir.post('/planification/rattachements', { referentiel: 'STRATEGIE', niveau: 'ACTION', parent_id: pilier.body.id, libelle: 'Action mal rattachée' })).status).toBe(400);
    expect((await ag.post('/planification/rattachements', { referentiel: 'PNSD', niveau: 'PILIER', libelle: 'Interdit' })).status).toBe(403);
    const m = (await ag.get('/pip/modele')).body;
    expect(m.suggestions['PNSD:THEMATIQUE']).toEqual(expect.arrayContaining([{ libelle: 'Thématique de test', parent: 'Pilier de test' }]));
    const prog = (await db('plan_programmes').first()) || (await db('plan_programmes').insert({ code: 'T-PIP', libelle: 'Programme de test' }).returning('*'))[0];
    const dcs = await db('plan_services').where({ sigle: 'DCS' }).first();
    expect((await dir.put(`/planification/services/${dcs.id}`, { sigle: 'DCS', libelle: dcs.libelle, programme_id: prog.id, ordre: 13 })).body.programme_id).toBe(prog.id);
  });

  test('conversion d’une fiche de l’ancien modèle', () => {
    const d = convertir({
      identification: { intitule: 'Ancien projet', secteur: 'Économie numérique', ministere_tutelle: 'Ministère', organisme_execution: 'SG', date_demarrage: '2027-03-01', duree_mois: 12 },
      contexte: { contexte: 'C', problematique: 'P', justification: 'J', alignement: 'PNSD' },
      cout: { couts: [{ rubrique: 'Travaux', annee1: 10, annee2: 5 }] }, financement: { sources: [{ source: 'Trésor', montant: 15, statut: 'Acquis' }] },
      risques: { risques: [{ risque: 'R', mesure: 'M' }] }, responsables: { structure_responsable: 'DEP', chef_projet: 'X' },
    });
    const n = normalize(d);
    expect(n.donnees.identification).toMatchObject({ libelle: 'Ancien projet', service: 'SG' });
    expect(n.donnees.calendrier).toMatchObject({ date_debut: '2027-03-01', date_fin: '2028-02-29', duree_mois: 12 });
    expect(n.synthese).toMatchObject({ coutTotal: 15, financementTotal: 15 });
    expect(n.donnees.institutionnel.risques).toEqual([{ risque: 'R', mitigation: 'M' }]);
    expect(n.donnees.controle.commentaire).toBe('PNSD');
  });

  test('fiche de démonstration ou de test vérifiable puis validable', async () => {
    const p = (await ag.post('/pip', { donnees: fiche() })).body;
    expect((await ag.post(`/pip/${p.id}/soumettre`)).body.statut).toBe('EN_VERIFICATION');
    expect((await cd.post(`/pip/${p.id}/verifier`, {})).body.statut).toBe('VERIFIE');
    expect((await dir.post(`/pip/${p.id}/valider`, {})).body.statut).toBe('VALIDE');
  });
});

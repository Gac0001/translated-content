'use strict';
/**
 * Seed 07 — Scénario de démonstration et de formation (DEMO_MODE=true uniquement).
 *
 * Joue, au travers de l’API et donc de toutes les règles métier (circuits, historiques,
 * notifications, contrôles de qualité), une activité réaliste et entièrement fictive couvrant les
 * modules ajoutés depuis la version 1.13 : réunions et décisions, agenda du Directeur, demandes
 * du Secrétaire Général, planification (PTBA, performance, crédits, PAP/RAP), banque des projets
 * et risques, données sectorielles (annuaire, campagnes, indicateurs, bulletins).
 * Les dates sont calculées à partir du jour du chargement : la démonstration paraît toujours à jour.
 */
const config = require('../../config/env');
const demo = require('../../services/demo');

const J = (jours, heure = 9, minute = 0) => { const d = new Date(); d.setDate(d.getDate() + jours); d.setHours(heure, minute, 0, 0); return d.toISOString(); };
const D = (jours) => J(jours).slice(0, 10);

function client(base) {
  const jetons = {};
  async function jeton(u) {
    if (jetons[u]) return jetons[u];
    const post = (url, body) => fetch(`${base}${url}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());
    let r = await post('/auth/login', { username: u, password: demo.MOT_DE_PASSE });
    if (r.deuxFacteurs) r = await post('/auth/login/deux-facteurs', { defi: r.defi, code: demo.codeActuel() });
    if (!r.accessToken) throw new Error(`Connexion impossible pour ${u} : ${JSON.stringify(r).slice(0, 200)}`);
    jetons[u] = r.accessToken;
    return jetons[u];
  }
  return async function appel(u, methode, url, body) {
    const r = await fetch(`${base}${url}`, { method: methode, headers: { 'content-type': 'application/json', authorization: `Bearer ${await jeton(u)}` }, body: body === undefined ? undefined : JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (r.status >= 400) throw new Error(`${u} ${methode} ${url} → ${r.status} ${JSON.stringify(j).slice(0, 300)}`);
    return j;
  };
}

exports.seed = async function seed(knex) {
  if (!config.demo || !config.seedDemo) return;
  if (await knex('sect_acteurs').first()) return; // scénario déjà chargé
  process.env.SIG_DEP_SILENCIEUX = '1'; // pas de journal HTTP pendant le chargement
  const app = require('../../app');
  const server = await new Promise((ok) => { const s = app.listen(0, '127.0.0.1', () => ok(s)); });
  const api = client(`http://127.0.0.1:${server.address().port}/api`);
  const uid = async (u) => (await knex('users').where({ username: u }).first()).id;
  try {
    await reunionsEtDecisions(api, knex, uid);
    await demandesSg(api);
    const plan = await planification(api, knex);
    await programmation(api, knex, plan);
    await donneesSectorielles(api, knex, uid);
  } finally {
    await new Promise((ok) => server.close(ok));
    await require('../../db/knex').destroy();
  }
};

// ─── Réunions, décisions, agenda ────────────────────────────────────────────
async function reunionsEtDecisions(api, knex, uid) {
  const sec = 'cb.secretariat';
  const r = await api(sec, 'POST', '/reunions', {
    objet: 'Réunion de coordination mensuelle de la Direction', debut: J(2, 9), fin: J(2, 11), lieu: 'Salle de réunion de la DEP', pour_directeur: true,
    ordre_du_jour: [{ titre: 'Suivi des instructions du Secrétariat Général' }, { titre: 'Exécution du PTBA au premier semestre', rapporteur: 'Chef de Division Programme et Suivi' }, { titre: 'Lancement de la collecte annuelle des données sectorielles', rapporteur: 'Chef de Division Études, Documentation et Information' }],
    participants: [await uid('cd.ps'), await uid('cd.edi'), await uid('cd.sci'), await uid('cb.prg'), await uid('cb.sev')],
    externes: [{ nom: 'Représentant de l’autorité de régulation (fictif)', qualite: 'Invité' }],
  });
  await api(sec, 'POST', `/reunions/${r.id}/convoquer`);
  await knex('reunions').where({ id: r.id }).update({ debut: J(-6, 9), fin: J(-6, 11) });
  const parts = (await api(sec, 'GET', `/reunions/${r.id}`)).participants;
  await api(sec, 'PUT', `/reunions/${r.id}/presences`, { presences: parts.map((p, i) => ({ id: p.id, presence: i === 3 ? 'EXCUSE' : 'PRESENT' })) });
  await api(sec, 'POST', `/reunions/${r.id}/tenue`);
  await api(sec, 'PUT', `/reunions/${r.id}/compte-rendu`, {
    compte_rendu: 'La réunion a fait le point sur les instructions du Secrétariat Général, l’exécution du PTBA au premier semestre (taux physique moyen jugé satisfaisant, décaissements en retard sur deux activités) et le lancement de la collecte annuelle auprès des fournisseurs d’accès à Internet.',
    decisions: [
      { libelle: 'Produire la note d’analyse de l’exécution du PTBA au premier semestre', responsable_user_id: await uid('cd.ps'), echeance: D(8), resultat_attendu: 'Note transmise au Directeur' },
      { libelle: 'Relancer les fournisseurs d’accès n’ayant pas répondu à l’enquête', responsable_user_id: await uid('cd.edi'), echeance: D(5) },
      { libelle: 'Préparer les termes de référence de la revue à mi-parcours du plan stratégique', responsable_user_id: await uid('cd.sci'), echeance: D(20) },
    ],
  });
  await api(sec, 'POST', `/reunions/${r.id}/soumettre-cr`);
  await api('directeur', 'POST', `/reunions/${r.id}/valider-cr`);
  const ds = await knex('decisions').where({ reunion_id: r.id }).orderBy('id');
  const inst = await api('directeur', 'POST', `/decisions/${ds[0].id}/transformer`, { priorite: 'HAUTE' });
  await api('cd.ps', 'POST', `/instructions/${inst.id}/accuser-reception`);
  await api('cd.edi', 'POST', `/decisions/${ds[1].id}/rendre-compte`, { resultat: 'Relance adressée par courrier et par téléphone à huit fournisseurs.' });

  const r2 = await api(sec, 'POST', '/reunions', {
    objet: 'Revue de la programmation de l’exercice suivant', debut: J(3, 10), fin: J(3, 12), lieu: 'Salle de réunion de la DEP', pour_directeur: true,
    ordre_du_jour: [{ titre: 'Avant-projet de PTBA de l’exercice suivant' }, { titre: 'Projet annuel de performance' }],
    participants: [await uid('cd.ps'), await uid('cb.prg'), await uid('cb.sev')],
  });
  await api(sec, 'POST', `/reunions/${r2.id}/convoquer`);
  const cb = await api('cb.sev', 'POST', '/reunions', { objet: 'Point hebdomadaire du Bureau Suivi-Évaluation', debut: J(1, 8, 30), participants: [await uid('ag.sev1'), await uid('ag.sev2')] });
  await api('cb.sev', 'POST', `/reunions/${cb.id}/convoquer`);

  for (const e of [
    { type: 'AUDIENCE', titre: 'Audience avec une délégation d’un partenaire technique (fictif)', debut: J(1, 10), fin: J(1, 11), lieu: 'Bureau du Directeur', interlocuteur: 'Délégation du partenaire' },
    { type: 'DEPLACEMENT', titre: 'Mission de suivi dans une province (fictive)', debut: J(6, 7), fin: J(8, 18), lieu: 'Province du Kongo-Central' },
    { type: 'CEREMONIE', titre: 'Lancement officiel du bulletin sectoriel', debut: J(10, 15), lieu: 'Salle polyvalente du Secrétariat Général' },
  ]) await api(sec, 'POST', '/agenda', e);
}

// ─── Demandes d’information du Secrétaire Général ───────────────────────────
async function demandesSg(api) {
  const a = await api('sg', 'POST', '/demandes-information', { objet: 'Taux d’exécution du PTBA', question: 'Quel est le taux d’exécution physique et financière du PTBA de la Direction à ce jour ?', echeance: D(4), priorite: 'HAUTE' });
  await api('directeur', 'POST', `/demandes-information/${a.id}/repondre`, { reponse: 'Le taux d’exécution physique moyen est d’environ 55 % ; le détail par activité figure au tableau de bord de la Planification.' });
  await api('sg', 'POST', '/demandes-information', { objet: 'Nombre d’abonnés à Internet', question: 'Pouvez-vous communiquer l’évolution du nombre d’abonnés à Internet sur les deux dernières années ?', echeance: D(6), priorite: 'NORMALE' });
}

// ─── Planification : référentiel, PTBA, exécution ───────────────────────────
async function planification(api, knex) {
  const A = new Date().getFullYear();
  const prg = 'cb.prg';
  const ex = await api(prg, 'POST', '/planification/exercices', { annee: A, statut: 'EXECUTION' });
  const ex2 = await api(prg, 'POST', '/planification/exercices', { annee: A + 1, statut: 'PREPARATION' });
  const progs = [];
  for (const [code, libelle, objectif, actions] of [
    ['01', 'Pilotage et administration (démo)', 'Assurer un pilotage efficace des politiques du secteur numérique', [['1', 'Coordination et planification'], ['2', 'Gestion des ressources']]],
    ['02', 'Infrastructures numériques (démo)', 'Étendre l’accès aux réseaux à haut débit', [['1', 'Réseaux de transport'], ['2', 'Accès en zones rurales']]],
    ['03', 'Services et usages numériques (démo)', 'Développer les services publics en ligne et les compétences numériques', [['1', 'Administration en ligne'], ['2', 'Compétences numériques']]],
  ]) {
    const p = await api(prg, 'POST', '/planification/programmes', { code, libelle, objectif_global: objectif });
    p.actions = [];
    for (const [c, l] of actions) p.actions.push(await api(prg, 'POST', '/planification/actions', { programme_id: p.id, code: c, libelle: l, services_normatifs: 'DEP', operateurs: '—' }));
    progs.push(p);
  }
  const services = {};
  for (const [sigle, libelle] of [['DEP', 'Direction d’Études et Planification'], ['DINFRA', 'Direction des infrastructures numériques (démo)'], ['DUSAGES', 'Direction des usages numériques (démo)']]) {
    services[sigle] = await api(prg, 'POST', '/planification/services', { sigle, libelle });
  }
  const ligne = (activite, cout, mois, extra = {}) => ({ activite, cout, mois, structure_responsable: 'DEP', source_financement: 'Trésor Public', ...extra });
  const ptbaDep = await api('ag.prg1', 'POST', '/ptba', { exercice_id: ex.id, service_id: services.DEP.id, programme_id: progs[0].id, objectif_global: 'Renforcer la planification et le suivi-évaluation des politiques du secteur numérique' });
  await api('ag.prg1', 'PUT', `/ptba/${ptbaDep.id}`, {
    programme_id: progs[0].id, objectif_global: 'Renforcer la planification et le suivi-évaluation des politiques du secteur numérique',
    objectifs: [
      { libelle: 'Élaborer les documents de programmation du secteur', lignes: [
        ligne('Élaborer le PTBA consolidé du Ministère', 45000000, [1, 2, 3], { taches: 'Collecte des PTBA des services ; consolidation ; atelier de validation', resultats_attendus: 'PTBA consolidé validé', indicateur: 'PTBA disponible' }),
        ligne('Préparer le Projet annuel de performance', 60000000, [6, 7, 8, 9], { resultats_attendus: 'PAP transmis au Budget', indicateur: 'PAP validé' }),
        ligne('Organiser l’atelier de revue du CDMT', 35000000, [10, 11], { indicateur: 'Rapport d’atelier' }),
      ] },
      { libelle: 'Produire et diffuser les données statistiques du secteur', lignes: [
        ligne('Réaliser l’enquête annuelle auprès des fournisseurs d’accès', 80000000, [3, 4, 5], { structure_responsable: 'Bureau Études, Analyses et Prospective', indicateur: 'Taux de réponse' }),
        ligne('Publier le bulletin sectoriel annuel', 25000000, [6, 7], { structure_responsable: 'Bureau Documentation et Information', indicateur: 'Bulletin diffusé' }),
      ] },
    ],
  });
  await api('ag.prg1', 'POST', `/ptba/${ptbaDep.id}/soumettre`);
  await api('cb.prg', 'POST', `/ptba/${ptbaDep.id}/verifier`, {});
  await api('cd.ps', 'POST', `/ptba/${ptbaDep.id}/consolider`, {});
  await api('directeur', 'POST', `/ptba/${ptbaDep.id}/valider`, {});
  const lignes = (await api('cb.sev', 'GET', `/ptba/${ptbaDep.id}`)).lignes;
  const suivi = [[100, 45000000, 43000000], [40, 30000000, 18000000], [0, 0, 0], [90, 78000000, 70000000], [20, 5000000, 2500000]];
  for (const [i, l] of lignes.entries()) {
    const [t, e, dc] = suivi[i] || [0, 0, 0];
    if (t) await api('ag.sev1', 'PUT', `/ptba/lignes/${l.id}/suivi/2`, { taux_physique: t, montant_engage: e, montant_decaisse: dc, commentaire: t === 100 ? 'Activité réalisée' : 'En cours' });
  }
  const ptbaInfra = await api('ag.prg2', 'POST', '/ptba', { exercice_id: ex.id, service_id: services.DINFRA.id, programme_id: progs[1].id, objectif_global: 'Étendre la couverture des réseaux à haut débit' });
  await api('ag.prg2', 'PUT', `/ptba/${ptbaInfra.id}`, {
    programme_id: progs[1].id, objectif_global: 'Étendre la couverture des réseaux à haut débit',
    objectifs: [{ libelle: 'Suivre le déploiement de la dorsale à fibre optique', lignes: [
      ligne('Missions de suivi des chantiers de la dorsale', 120000000, [2, 5, 8, 11], { structure_responsable: 'DINFRA' }),
      ligne('Étude de faisabilité de points d’accès publics', 90000000, [4, 5, 6], { structure_responsable: 'DINFRA' }),
    ] }],
  });
  await api('ag.prg2', 'POST', `/ptba/${ptbaInfra.id}/soumettre`);
  await api('ag.prg1', 'POST', '/ptba', { exercice_id: ex2.id, service_id: services.DEP.id, programme_id: progs[0].id, objectif_global: 'Avant-projet de l’exercice suivant' });
  return { A, progs, ptbaDep };
}

// ─── Programmation : performance, crédits, documents, banque, risques ───────
async function programmation(api, knex, { A, progs, ptbaDep }) {
  const prg = 'cb.prg';
  const objM = await api(prg, 'POST', '/programmation/objectifs', { libelle: 'Accroître l’accès de la population aux services numériques' });
  const i1 = await api(prg, 'POST', '/programmation/indicateurs', { objectif_id: objM.id, libelle: 'Taux de pénétration de l’Internet', unite: '%', mode_calcul: 'Abonnés à Internet / population × 100', source: 'Enquête annuelle de la DEP', sens: 'HAUSSE' });
  const i2 = await api(prg, 'POST', '/programmation/indicateurs', { objectif_id: objM.id, libelle: 'Nombre de démarches administratives disponibles en ligne', unite: 'Nombre', source: 'Rapport de la DEP', sens: 'HAUSSE' });
  const objP = await api(prg, 'POST', '/programmation/objectifs', { programme_id: progs[0].id, libelle: 'Améliorer la qualité de la programmation et du suivi' });
  const i3 = await api(prg, 'POST', '/programmation/indicateurs', { objectif_id: objP.id, libelle: 'Taux d’exécution physique du PTBA', unite: '%', source: 'Tableau de bord du PTBA', sens: 'HAUSSE' });
  const val = async (u, i, annee, type, valeur) => api(u, 'PUT', `/programmation/indicateurs/${i.id}/valeurs`, { annee, type, valeur });
  for (const [i, r, s1, c] of [[i1, [18.2, 21.5, 24.9], 26.3, [30, 34, 38]], [i2, [12, 18, 25], 31, [40, 55, 70]], [i3, [62, 68, 71], 55, [80, 85, 90]]]) {
    for (const [k, v] of r.entries()) await val('ag.sev1', i, A - 3 + k, 'REALISATION', v);
    await val('ag.sev1', i, A, 'REALISATION_S1', s1);
    for (const [k, v] of c.entries()) await val(prg, i, A + 1 + k, 'CIBLE', v);
  }
  const postes = await knex('plan_postes_budgetaires').orderBy(['axe', 'ordre']);
  const rub = (c) => postes.find((p) => p.axe === 'RUBRIQUE' && p.code === c).id;
  const tit = (c) => postes.find((p) => p.axe === 'TITRE' && p.code === c).id;
  const lignes = [];
  progs.forEach((p, k) => {
    const base = (k + 1) * 1000000000;
    for (const [annee, type, f] of [[A - 1, 'VOTE', 1], [A - 1, 'EXECUTE', 0.82], [A, 'VOTE', 1.1], [A, 'EXECUTE_S1', 0.45], [A + 1, 'PREVISION', 1.2], [A + 2, 'PREVISION', 1.3], [A + 3, 'PREVISION', 1.4]]) {
      lignes.push({ annee, type, programme_id: p.id, poste_id: rub('REM'), montant: Math.round(base * 0.6 * f) }, { annee, type, programme_id: p.id, poste_id: rub('FONC'), montant: Math.round(base * 0.25 * f) },
        { annee, type, programme_id: p.id, poste_id: rub('INV_RP'), montant: Math.round(base * 0.15 * f) },
        { annee, type, programme_id: p.id, poste_id: tit('T3'), montant: Math.round(base * 0.6 * f) }, { annee, type, programme_id: p.id, poste_id: tit('T4'), montant: Math.round(base * 0.25 * f) },
        { annee, type, programme_id: p.id, poste_id: tit('T7'), montant: Math.round(base * 0.15 * f) });
    }
  });
  await api(prg, 'PUT', '/programmation/credits', { lignes });
  const contenu = { ministere: 'ÉCONOMIE NUMÉRIQUE', responsable: 'Directeur d’Études et Planification (démo)', missions: 'Texte de démonstration : missions du Ministère en matière de numérique.', organisation: 'Texte de démonstration : organisation du Ministère.', performances_anterieures: 'Texte de démonstration : progression régulière du taux de pénétration de l’Internet.', perspectives: 'Texte de démonstration : priorités de l’exercice.' };
  const pap = await api('ag.prg1', 'POST', '/programmation/documents', { type: 'PAP', annee: A + 1 });
  await api('ag.prg1', 'PUT', `/programmation/documents/${pap.id}`, { contenu });
  const rap = await api('ag.prg1', 'POST', '/programmation/documents', { type: 'RAP', annee: A - 1 });
  await api('ag.prg1', 'PUT', `/programmation/documents/${rap.id}`, { contenu: { synthese: 'Texte de démonstration : synthèse des résultats de l’exercice écoulé.', difficultes: 'Retards de décaissement sur les investissements.' } });
  for (const [u, e] of [['ag.prg1', 'soumettre'], ['cb.prg', 'verifier'], ['cd.ps', 'consolider'], ['directeur', 'valider']]) await api(u, 'POST', `/programmation/documents/${rap.id}/${e}`);
  await api('ag.prg1', 'POST', '/programmation/documents', { type: 'CDMT', annee: A + 1 });

  // Cadrage budgétaire fictif (CBMT A+1 à A+3), validé ; un plafond de fonctionnement volontairement
  // inférieur à la prévision de A+2 illustre le contrôle des dépassements.
  const cbmt = await api('ag.prg1', 'POST', '/programmation/documents', { type: 'CBMT', annee: A + 1 });
  const total = 6000000000;
  const plafonds = {};
  for (const [k, f] of [[A + 1, 1.25], [A + 2, 1.35], [A + 3, 1.45]]) plafonds[k] = { REM: Math.round(total * 0.6 * f), FONC: Math.round(total * 0.25 * f), INTER: 0, INV_RE: 0, INV_RP: Math.round(total * 0.15 * f) };
  plafonds[A + 2].FONC = 1900000000;
  const banqueIds = (await api('cb.prg', 'GET', '/programmation/banque')).data.map((x) => x.id);
  await api('ag.prg1', 'PUT', `/programmation/documents/${cbmt.id}`, { contenu: {
    source: 'Ministère du Budget (document fictif de démonstration)', date_publication: `${A}-05-31`,
    orientations: 'Texte de démonstration : favoriser l’inclusion numérique, la digitalisation des services publics et le développement de l’économie numérique.',
    hypotheses: Object.fromEntries([[A + 1, 5.2, 8.0, 2850, 290000], [A + 2, 5.5, 7.2, 2900, 325000], [A + 3, 5.6, 6.5, 2950, 360000]].map(([a, c, i, t, p]) => [a, { croissance: c, inflation: i, taux_change: t, pib_nominal: p }])),
    plafonds,
    actions: [
      { libelle: 'Déployer les services publics en ligne prioritaires (démo)', programme_id: progs[2].id, pips: [] },
      { libelle: 'Étendre l’accès au haut débit dans les chefs-lieux de province (démo)', programme_id: progs[1].id, pips: banqueIds.slice(0, 1) },
      { libelle: 'Renforcer le suivi-évaluation des politiques du secteur (démo)', programme_id: progs[0].id, pips: [] },
    ],
  } });
  for (const [u, e] of [['ag.prg1', 'soumettre'], ['cb.prg', 'verifier'], ['cd.ps', 'consolider'], ['directeur', 'valider']]) await api(u, 'POST', `/programmation/documents/${cbmt.id}/${e}`);

  const banque = (await api('cb.sev', 'GET', '/programmation/banque')).data;
  for (const [k, p] of banque.entries()) {
    await api('ag.sev1', 'PUT', `/programmation/banque/${p.id}`, { maturite: k === 0 ? 'PRET' : 'ETUDE', programme_id: progs[k % 2 === 0 ? 1 : 2].id, localisation: k === 0 ? 'Plusieurs provinces' : 'Kinshasa', partenaires: 'Partenaire technique (fictif)' });
    await api('ag.sev1', 'POST', `/programmation/banque/${p.id}/jalons`, { libelle: 'Étude de faisabilité validée', date_prevue: D(-30), date_realisee: k === 0 ? D(-35) : null });
    await api('ag.sev1', 'POST', `/programmation/banque/${p.id}/jalons`, { libelle: 'Accord de financement signé', date_prevue: D(45) });
  }
  if (banque[0]) await api('ag.sev1', 'POST', '/programmation/risques', { entity_type: 'PIP', entity_id: banque[0].id, libelle: 'Retard de mobilisation de la contrepartie nationale', probabilite: 3, impact: 2, mesures: 'Inscription anticipée au budget ; suivi mensuel avec les services financiers.', responsable: 'Bureau Suivi-Évaluation', echeance: D(30) });
  await api('ag.sev1', 'POST', '/programmation/risques', { entity_type: 'PTBA', entity_id: ptbaDep.id, libelle: 'Faible taux de réponse à l’enquête annuelle', probabilite: 2, impact: 2, mesures: 'Relances et appui des services provinciaux.', responsable: 'Bureau Études, Analyses et Prospective', statut: 'MAITRISE' });
}

// ─── Données sectorielles ───────────────────────────────────────────────────
const ACTEURS = [
  // raison sociale, sigle, catégorie, province, ville
  ['Kinsé Connect SARL', 'KCO', 'FAI', 'Kinshasa', 'Kinshasa'], ['Fleuve Fibre SA', 'FFI', 'FAI', 'Kinshasa', 'Kinshasa'], ['Grands Lacs Net SARL', 'GLN', 'FAI', 'Nord-Kivu', 'Goma'],
  ['Katanga Data Services SARL', 'KDS', 'FAI', 'Haut-Katanga', 'Lubumbashi'], ['Équateur Wireless SARL', 'EQW', 'FAI', 'Équateur', 'Mbandaka'], ['Kasaï Online SARL', 'KOL', 'FAI', 'Kasaï-Central', 'Kananga'],
  ['Bas-Fleuve Internet SARL', 'BFI', 'FAI', 'Kongo-Central', 'Matadi'], ['Congo Cloud Démo SA', 'CCD', 'DC', 'Kinshasa', 'Kinshasa'], ['Mobile Pay Démo SA', 'MPD', 'FIN', 'Kinshasa', 'Kinshasa'],
  ['Atelier Logiciel Démo SARL', 'ALD', 'LOG', 'Haut-Katanga', 'Lubumbashi'], ['Académie Numérique Démo ASBL', 'AND', 'FOR', 'Nord-Kivu', 'Goma'], ['Télécom Démo SA', 'TDS', 'OPT', 'Kinshasa', 'Kinshasa'],
];
// abonnés, dont fixes, chiffre d’affaires (millions CDF), technologie, couverture rurale — pour les 7 fournisseurs d’accès
const FAI = [[42000, 6000, 8400, 'Fibre optique', true], [28000, 9000, 6100, 'Fibre optique', false], [15000, 1200, 2300, 'Radio (BLR, 4G)', true], [21000, 2500, 3900, 'Radio (BLR, 4G)', true], [4000, 300, 520, 'Satellite', true], [6500, 400, 800, 'Radio (BLR, 4G)', false], [5200, 700, 760, 'Radio (BLR, 4G)', true]];

async function donneesSectorielles(api, knex, uid) {
  const A = new Date().getFullYear();
  const ref = await api('cb.doi', 'GET', '/donnees/referentiel');
  const zone = (l) => ref.zones.find((z) => z.libelle === l).id;
  const cat = (c) => ref.categories.find((x) => x.code === c).id;
  const acteurs = [];
  for (const [k, [raison, sigle, c, prov, ville]] of ACTEURS.entries()) {
    acteurs.push(await api(k % 2 ? 'ag.doi1' : 'cb.doi', 'POST', '/donnees/acteurs', { raison_sociale: raison, sigle, categorie_id: cat(c), zone_id: zone(prov), ville, forme_juridique: raison.split(' ').pop(), rccm: `CD/DEMO/RCCM/${String(k + 1).padStart(5, '0')}`, effectif: 20 + k * 7, annee_creation: 2008 + k }));
  }
  const fai = acteurs.slice(0, 7);
  const q = await api('cb.eap', 'POST', '/donnees/questionnaires', { code: 'ENQ-FAI', titre: 'Enquête annuelle des fournisseurs d’accès à Internet', description: 'Questionnaire de démonstration : abonnés, chiffre d’affaires, technologies et couverture.' });
  const v = (await api('cb.eap', 'GET', `/donnees/questionnaires/${q.id}`)).versions[0];
  await api('cb.eap', 'PUT', `/donnees/versions/${v.id}`, {
    questions: [
      { code: 'ABONNES', libelle: 'Nombre total d’abonnés', type: 'ENTIER', obligatoire: true, min: 0, unite: 'abonnés', section: 'Abonnés' },
      { code: 'ABONNES_FIXE', libelle: 'dont abonnés fixes', type: 'ENTIER', min: 0, unite: 'abonnés', section: 'Abonnés' },
      { code: 'CA', libelle: 'Chiffre d’affaires de l’exercice', type: 'NOMBRE', min: 0, unite: 'millions CDF', section: 'Activité' },
      { code: 'TECHNO', libelle: 'Technologie principale', type: 'CHOIX', obligatoire: true, options: ['Fibre optique', 'Radio (BLR, 4G)', 'Satellite'], section: 'Activité' },
      { code: 'RURAL', libelle: 'Couverture de zones rurales', type: 'OUI_NON', section: 'Activité' },
    ],
    controles: [{ gauche: 'ABONNES_FIXE', operateur: '<=', droite: 'ABONNES', message: 'Les abonnés fixes ne peuvent dépasser le total des abonnés.' }],
  });
  await api('cb.eap', 'POST', `/donnees/versions/${v.id}/publier`);
  const resp = await uid('ag.eap1');
  const campagne = async (an, statutFinal, facteur, nbReponses) => {
    const c = await api('cb.eap', 'POST', '/donnees/campagnes', {
      titre: `Collecte annuelle des fournisseurs d’accès ${an}`, version_id: v.id, periode: String(an), periode_debut: `${an}-01-01`, periode_fin: `${an}-12-31`, echeance: statutFinal === 'OUVERTE' ? D(20) : `${an + 1}-03-31`,
      categories: [cat('FAI')], zones: [], responsable_id: resp, instructions: 'Saisir les réponses à partir des formulaires reçus et joindre la pièce source.',
    });
    await api('cb.eap', 'POST', `/donnees/campagnes/${c.id}/ouvrir`);
    for (const [k, a] of fai.slice(0, nbReponses).entries()) {
      const [ab, fx, ca, techno, rural] = FAI[k];
      const valeurs = { ABONNES: Math.round(ab * facteur), ABONNES_FIXE: Math.round(fx * facteur), CA: Math.round(ca * facteur), TECHNO: techno, RURAL: rural };
      const saisie = k % 2 ? 'ag.doi1' : 'ag.eap1';
      const controle = saisie === 'ag.doi1' ? 'ag.doi2' : 'ag.doi1';
      if (statutFinal === 'OUVERTE' && k === nbReponses - 1) { // brouillon comportant une erreur, pour la formation
        await api(saisie, 'PUT', `/donnees/campagnes/${c.id}/reponses/${a.id}`, { valeurs: { ...valeurs, ABONNES_FIXE: valeurs.ABONNES + 500 }, source: 'COURRIEL', date_reception: D(-1) });
        continue;
      }
      await api(saisie, 'PUT', `/donnees/campagnes/${c.id}/reponses/${a.id}`, { valeurs, source: k % 3 ? 'PAPIER' : 'FICHIER', date_reception: statutFinal === 'OUVERTE' ? D(-3) : `${an + 1}-02-${String(10 + k).padStart(2, '0')}` });
      await api(saisie, 'POST', `/donnees/campagnes/${c.id}/reponses/${a.id}/soumettre`);
      if (statutFinal === 'OUVERTE' && k >= nbReponses - 3) continue; // à contrôler
      await api(controle, 'POST', `/donnees/campagnes/${c.id}/reponses/${a.id}/controler`, { decision: 'CONTROLEE' });
    }
    if (statutFinal === 'VALIDEE') {
      await api('cb.eap', 'POST', `/donnees/campagnes/${c.id}/cloturer`);
      await api('cd.edi', 'POST', `/donnees/campagnes/${c.id}/valider`);
    }
    return c;
  };
  await campagne(A - 2, 'VALIDEE', 0.8, 6);
  await campagne(A - 1, 'VALIDEE', 1, 7);
  await campagne(A, 'OUVERTE', 1.15, 6);

  const ind = [];
  for (const b of [
    { code: 'ABO-FAI', libelle: 'Abonnés à Internet des fournisseurs d’accès', calcul: 'SOMME', question: 'ABONNES', unite: 'abonnés', decimales: 0 },
    { code: 'PART-FIXE', libelle: 'Part des abonnements fixes', calcul: 'RATIO', question: 'ABONNES_FIXE', question_denominateur: 'ABONNES', facteur: 100, unite: '%', decimales: 1 },
    { code: 'FAI-RURAL', libelle: 'Part des fournisseurs couvrant des zones rurales', calcul: 'PART', question: 'RURAL', valeur_choix: 'Oui', unite: '%', decimales: 0 },
    { code: 'CA-MOYEN', libelle: 'Chiffre d’affaires moyen par fournisseur', calcul: 'MOYENNE', question: 'CA', unite: 'millions CDF', decimales: 0 },
  ]) ind.push(await api('cb.eap', 'POST', '/donnees/indicateurs', { ...b, questionnaire_id: q.id }));
  const bul = await api('ag.eap1', 'POST', '/donnees/bulletins', {
    type: 'BULLETIN', titre: 'Bulletin des fournisseurs d’accès à Internet', periode: `Années ${A - 2}-${A - 1}`, indicateurs: ind.map((i) => i.id), diffusion_sg: true,
    contenu: { introduction: 'Bulletin de démonstration présentant les résultats de l’enquête annuelle auprès des fournisseurs d’accès à Internet (données fictives).', analyse: 'Le nombre d’abonnés progresse d’environ un quart en un an, porté par la fibre optique à Kinshasa et par les réseaux radio en provinces.', conclusion: 'Poursuivre l’extension des réseaux en zones rurales et améliorer le taux de réponse à l’enquête.' },
  });
  await api('ag.eap1', 'POST', `/donnees/bulletins/${bul.id}/soumettre`);
  await api('cd.edi', 'POST', `/donnees/bulletins/${bul.id}/viser`);
  await api('directeur', 'POST', `/donnees/bulletins/${bul.id}/autoriser`);
  const bar = await api('ag.doi1', 'POST', '/donnees/bulletins', { type: 'BAROMETRE', titre: 'Baromètre de l’accès à Internet', periode: `Année ${A - 1}`, indicateurs: [ind[0].id, ind[2].id], contenu: { analyse: 'Projet de baromètre en attente de visa (démonstration du circuit).' } });
  await api('ag.doi1', 'POST', `/donnees/bulletins/${bar.id}/soumettre`);
}

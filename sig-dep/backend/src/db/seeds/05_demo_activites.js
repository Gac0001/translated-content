'use strict';
/**
 * Seed 05 — Activité de démonstration (SEED_DEMO=true uniquement) : instructions, tâches,
 * courriers, documents, présences et fiches PIP, afin que tableaux de bord et rapports
 * présentent des données réalistes. Ne s’exécute que si aucune instruction n’existe.
 * Toutes les références respectent la chaîne hiérarchique.
 */
const config = require('../../config/env');

const day = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const ts = (n, h = 9) => { const d = new Date(); d.setDate(d.getDate() + n); d.setHours(h, 0, 0, 0); return d; };

exports.seed = async function seed(knex) {
  if (!config.seedDemo) return;
  await exports.chargerActivites(knex);
};

/** Activité fictive (aussi utilisée par la réinitialisation de l’Admin). */
exports.chargerActivites = async function chargerActivites(knex) {
  if (!(await knex('agents').first())) return;
  if (await knex('instructions').first()) return;

  const dep = await knex('directions').where({ code: 'DEP' }).first();
  const users = Object.fromEntries((await knex('users as u')
    .leftJoin('affectations as a', function j() { this.on('a.agent_id', 'u.agent_id').andOn('a.est_active', knex.raw('true')); })
    .leftJoin('agents as ag', 'ag.id', 'u.agent_id')
    .select('u.id', 'u.username', 'a.division_id', 'a.bureau_id', 'ag.id as agent_id', 'ag.prenom', 'ag.nom'))
    .map((u) => [u.username, u]));
  if (!users.directeur || !users.sg) return;
  const U = (n) => users[n];
  const nom = (n) => `${U(n).prenom} ${U(n).nom}`;

  async function ref(cle, prefix) {
    const r = await knex.raw(`INSERT INTO sequences (cle, annee, valeur) VALUES (?, ?, 1)
      ON CONFLICT (cle, annee) DO UPDATE SET valeur = sequences.valeur + 1 RETURNING valeur`, [cle, new Date().getFullYear()]);
    return `${prefix}/${new Date().getFullYear()}/${String(r.rows[0].valeur).padStart(4, '0')}`;
  }
  async function hist(type, id, user, action, nouveau, commentaire, at, avancement = null) {
    await knex('historiques').insert({ entity_type: type, entity_id: id, user_id: user, action, nouveau_statut: nouveau, commentaire, avancement, created_at: at });
  }
  async function notif(user, type, titre, lien, exp) {
    await knex('notifications').insert({ user_id: user, type, titre, lien, expediteur_user_id: exp });
  }

  // ─── Instructions ────────────────────────────────────────────────────────
  const ROLE = { sg: 'SECRETAIRE_GENERAL', directeur: 'DIRECTEUR', 'cb.secretariat': 'CHEF_BUREAU' };
  const roleOf = (n) => ROLE[n] || (n.startsWith('cd.') ? 'CHEF_DIVISION' : n.startsWith('cb.') ? 'CHEF_BUREAU' : 'AGENT');
  async function instruction(from, to, objet, contenu, { statut, avancement = 0, echeance, emis = -10, priorite = 'NORMALE', reponse, parent } = {}) {
    const [i] = await knex('instructions').insert({
      reference: await ref('INS', 'DEP/INS'), parent_id: parent || null, emetteur_user_id: U(from).id, destinataire_user_id: U(to).id,
      emetteur_role: roleOf(from), destinataire_role: roleOf(to), objet, contenu, priorite, date_emission: ts(emis), echeance: echeance ?? day(15),
      statut, avancement, reponse: reponse || null, date_reponse: reponse ? ts(-1) : null, date_cloture: statut === 'CLOTUREE' ? ts(-1) : null,
      direction_id: dep.id, division_id: U(to).division_id, bureau_id: U(to).bureau_id, created_at: ts(emis), updated_at: ts(-1),
    }).returning('*');
    await hist('INSTRUCTION', i.id, U(from).id, 'TRANSMISSION', 'TRANSMISE', `Adressée à ${nom(to)}`, ts(emis));
    if (statut !== 'TRANSMISE') await hist('INSTRUCTION', i.id, U(to).id, 'RECEPTION', 'RECUE', 'Accusé de réception', ts(emis + 1));
    if (avancement > 0 && avancement < 100) await hist('INSTRUCTION', i.id, U(to).id, 'AVANCEMENT', statut, `Avancement : ${avancement} %`, ts(-2), avancement);
    if (reponse) await hist('INSTRUCTION', i.id, U(to).id, 'COMPTE_RENDU', 'EXECUTEE', reponse, ts(-1), 100);
    if (['VALIDEE', 'CLOTUREE'].includes(statut)) await hist('INSTRUCTION', i.id, U(from).id, 'VALIDATION', 'VALIDEE', 'Exécution validée', ts(-1, 15));
    return i;
  }

  const i1 = await instruction('sg', 'directeur', 'Rapport annuel de performance du secteur numérique', 'Produire le rapport annuel de performance consolidé du secteur, avec les indicateurs du plan stratégique.', { statut: 'EN_COURS', avancement: 45, priorite: 'HAUTE', echeance: day(20), emis: -12 });
  await instruction('sg', 'directeur', 'Note sur l’état d’avancement des projets PIP', 'Transmettre une note synthétique sur l’état d’avancement des projets inscrits au PIP.', { statut: 'EXECUTEE', avancement: 100, reponse: 'Note transmise avec le portefeuille PIP en annexe.', emis: -20, echeance: day(-5) });
  const i2 = await instruction('directeur', 'cd.ps', 'Collecte des indicateurs de performance', 'Collecter et consolider les indicateurs de performance de l’année pour le rapport annuel.', { statut: 'EN_COURS', avancement: 60, parent: i1.id, echeance: day(10), emis: -11 });
  await instruction('directeur', 'cd.edi', 'Étude sur l’inclusion numérique en milieu rural', 'Préparer les termes de référence d’une étude sur l’inclusion numérique.', { statut: 'RECUE', emis: -3, echeance: day(25) });
  await instruction('directeur', 'cd.sci', 'Cadrage budgétaire 2027', 'Préparer la contribution de la DEP au cadrage budgétaire 2027.', { statut: 'VALIDEE', avancement: 100, reponse: 'Contribution transmise.', emis: -25, echeance: day(-8) });
  await instruction('directeur', 'cb.secretariat', 'Mise à jour du registre du personnel', 'Mettre à jour le registre du personnel et préparer les listes de présence du mois.', { statut: 'EN_COURS', avancement: 30, emis: -4, echeance: day(6) });
  await instruction('cd.ps', 'cb.prg', 'Extraction des données statistiques', 'Extraire les séries statistiques 2025-2026 pour les indicateurs de performance.', { statut: 'EN_COURS', avancement: 70, parent: i2.id, echeance: day(5), emis: -9 });
  await instruction('cd.ps', 'cb.sev', 'Synthèse des missions de suivi', 'Produire la synthèse des missions de suivi du semestre.', { statut: 'EN_RETARD', avancement: 50, echeance: day(-2), emis: -15, priorite: 'HAUTE' });
  await instruction('cd.edi', 'cb.eap', 'Revue documentaire', 'Réaliser la revue documentaire préalable à l’étude sur l’inclusion numérique.', { statut: 'TRANSMISE', emis: -1, echeance: day(12) });
  await notif(U('directeur').id, 'INSTRUCTION', 'Nouvelle instruction : Rapport annuel de performance du secteur numérique', '/instructions', U('sg').id);
  await notif(U('cd.edi').id, 'INSTRUCTION', 'Nouvelle instruction : Étude sur l’inclusion numérique en milieu rural', '/instructions', U('directeur').id);

  // ─── Tâches ──────────────────────────────────────────────────────────────
  const plan = [
    ['cb.prg', 'ag.prg1', 'Programme d’activités du 4e trimestre', 'EN_COURS', 55, day(4)],
    ['cb.prg', 'ag.prg2', 'Consolidation des fiches PIP 2027', 'EXECUTEE', 100, day(2)],
    ['cb.sev', 'ag.sev1', 'Fiche de suivi du projet de backbone', 'EN_RETARD', 40, day(-3)],
    ['cb.sev', 'ag.sev2', 'Compte rendu de la mission de suivi à Matadi', 'VALIDEE', 100, day(-6)],
    ['cb.eap', 'ag.eap1', 'Revue de la littérature sur l’inclusion numérique', 'RECUE', 0, day(9)],
    ['cb.eap', 'ag.eap2', 'Collecte des données de couverture réseau', 'EN_COURS', 25, day(7)],
    ['cb.doi', 'ag.doi1', 'Bulletin d’information du mois', 'CLOTUREE', 100, day(-10)],
    ['cb.str', 'ag.str1', 'Projet de stratégie sectorielle 2027-2030', 'EN_COURS', 65, day(8)],
    ['cb.coi', 'ag.coi1', 'Dossier de coopération avec la Banque mondiale', 'EN_COURS', 35, day(14)],
    ['cb.secretariat', 'ag.secretariat1', 'Classement des courriers du mois', 'EN_COURS', 80, day(3)],
    ['cb.secretariat', 'ag.secretariat2', 'Préparation de la liste de présence', 'TRANSMISE', 0, day(2)],
  ];
  for (const [chef, agent, titre, statut, av, echeance] of plan) {
    const [t] = await knex('tasks').insert({
      reference: await ref('TAC', 'DEP/TAC'), assigne_par_user_id: U(chef).id, agent_user_id: U(agent).id, titre,
      description: `${titre} — conformément aux instructions du Chef de Bureau.`, priorite: statut === 'EN_RETARD' ? 'HAUTE' : 'NORMALE',
      date_debut: day(-12), echeance, statut, avancement: av, rapport_execution: av === 100 ? 'Travail réalisé et transmis.' : null,
      date_cloture: statut === 'CLOTUREE' ? ts(-5) : null, direction_id: dep.id, division_id: U(agent).division_id, bureau_id: U(agent).bureau_id,
      created_at: ts(-12), updated_at: ts(-1),
    }).returning('*');
    await hist('TASK', t.id, U(chef).id, 'ATTRIBUTION', 'TRANSMISE', `Attribuée à ${nom(agent)}`, ts(-12));
    if (av > 0) await hist('TASK', t.id, U(agent).id, 'AVANCEMENT', statut, `Avancement : ${av} %`, ts(-2), av);
    if (statut === 'TRANSMISE') await notif(U(agent).id, 'TACHE', `Nouvelle tâche : ${titre}`, `/taches/${t.id}`, U(chef).id);
  }

  // ─── Courriers ───────────────────────────────────────────────────────────
  const reg = U('cb.secretariat');
  const courriers = [
    ['ENTRANT', 'Ministère du Plan', 'Directeur de la DEP', 'Lettre circulaire relative à la préparation du PIP 2027', 'URGENT', 'ORDINAIRE', 'EN_CIRCULATION', true],
    ['ENTRANT', 'Cabinet du Ministre du Numérique', 'Directeur de la DEP', 'Demande de données sur la couverture Internet', 'TRES_URGENT', 'ORDINAIRE', 'ENREGISTRE', false],
    ['ENTRANT', 'Banque mondiale', 'Secrétaire Général', 'Mission d’appui au projet d’accélération numérique', 'NORMAL', 'CONFIDENTIEL', 'TRAITE', false],
    ['SORTANT', 'Direction d’Études et Planification', 'Institut National de la Statistique', 'Transmission des statistiques sectorielles 2025', 'NORMAL', 'ORDINAIRE', 'CLASSE', false],
  ];
  for (const [n, [sens, exp, dest, objet, urgence, confidentialite, statut, transmis]] of courriers.entries()) {
    const [c] = await knex('courriers').insert({
      numero_enregistrement: await ref(sens === 'ENTRANT' ? 'CE' : 'CS', sens === 'ENTRANT' ? 'DEP/CE' : 'DEP/CS'), sens, expediteur: exp, destinataire: dest, objet,
      date_courrier: day(-8 + n), date_enregistrement: day(-7 + n), urgence, confidentialite, statut, classement: statut === 'CLASSE' ? 'STAT/2026' : null,
      direction_id: dep.id, bureau_id: reg.bureau_id, detenteur_user_id: transmis ? U('directeur').id : reg.id, created_by: reg.id, created_at: ts(-7 + n),
    }).returning('*');
    await hist('COURRIER', c.id, reg.id, 'ENREGISTREMENT', 'ENREGISTRE', `Courrier n° ${c.numero_enregistrement}`, ts(-7 + n));
    if (transmis) {
      await knex('courrier_transmissions').insert({ courrier_id: c.id, from_user_id: reg.id, to_user_id: U('directeur').id, sens_hierarchique: 'ASCENDANT', observations: 'Pour attribution', created_at: ts(-6) });
      await hist('COURRIER', c.id, reg.id, 'TRANSMISSION', 'EN_CIRCULATION', `Transmis à ${nom('directeur')}`, ts(-6));
      await notif(U('directeur').id, 'COURRIER', `Courrier transmis : ${c.numero_enregistrement}`, `/courriers/${c.id}`, reg.id);
    }
  }

  // ─── Documents de service ────────────────────────────────────────────────
  const visa = (n, role, libelle, type, j) => ({ userId: U(n).id, nom: nom(n), role, libelle, type, date: ts(j).toISOString() });
  const docs = [
    { auteur: 'ag.sev2', type: 'COMPTE_RENDU', titre: 'Compte rendu de la mission de suivi à Matadi', statut: 'VALIDE', niveau: 'DIRECTION', detenteur: 'directeur',
      contenu: { date: day(-9), lieu: 'Matadi, Kongo-Central', participants: ['Équipe du Bureau Suivi-Évaluation', 'Représentants provinciaux'], ordre_du_jour: ['Visite des sites', 'Réunion de restitution'], deroulement: 'La mission a visité trois sites du projet et tenu une réunion de restitution avec les autorités provinciales.', decisions: ['Accélérer les travaux du lot 2', 'Produire un rapport trimestriel'] },
      visas: [visa('cb.sev', 'CHEF_BUREAU', 'Chef de Bureau', 'VISA', -5), visa('cd.ps', 'CHEF_DIVISION', 'Chef de Division', 'VALIDATION_DIVISION', -4), visa('directeur', 'DIRECTEUR', 'Directeur', 'SIGNATURE', -3)] },
    { auteur: 'ag.eap2', type: 'NOTE_TECHNIQUE', titre: 'Note technique sur la couverture réseau en zones rurales', statut: 'EN_EXAMEN', niveau: 'BUREAU', detenteur: 'cb.eap',
      contenu: { destinataire: 'Monsieur le Directeur', contexte: 'La couverture réseau demeure faible dans les zones rurales.', analyse: 'Les données des opérateurs montrent une couverture 4G inférieure à 30 % hors des chefs-lieux.', propositions: ['Mutualiser les infrastructures passives', 'Mobiliser le fonds de service universel'] }, visas: [] },
    { auteur: 'ag.str1', type: 'PLAN_ACTIONS', titre: 'Plan d’actions 2027 de la DEP (projet)', statut: 'BROUILLON', niveau: 'AUTEUR', detenteur: 'ag.str1',
      contenu: { periode: 'Année 2027', objectif_general: 'Renforcer la planification et le suivi-évaluation du secteur.', actions: [{ action: 'Actualiser le plan stratégique', responsable: 'Bureau Planification Stratégique', echeance: day(90), indicateur: 'Plan adopté', budget: 25000, statut: 'À lancer' }] }, visas: [] },
  ];
  for (const d of docs) {
    const a = U(d.auteur);
    const [row] = await knex('documents').insert({
      reference: await ref(`DOC-${d.type}`, `DEP/${d.type.split('_').map((x) => x[0]).join('')}`), type_document: d.type, titre: d.titre, contenu: JSON.stringify(d.contenu),
      statut: d.statut, niveau_actuel: d.niveau, auteur_user_id: a.id, detenteur_user_id: U(d.detenteur).id, direction_id: dep.id, division_id: a.division_id, bureau_id: a.bureau_id,
      visas: JSON.stringify(d.visas), valide_par: d.statut === 'VALIDE' ? U('directeur').id : null, valide_at: d.statut === 'VALIDE' ? ts(-3) : null, created_at: ts(-8), updated_at: ts(-3),
    }).returning('*');
    await knex('document_versions').insert({ document_id: row.id, numero: 1, titre: row.titre, contenu: JSON.stringify(d.contenu), commentaire: 'Version initiale', created_by: a.id, created_at: ts(-8) });
    await hist('DOCUMENT', row.id, a.id, 'CREATION', 'BROUILLON', 'Version 1', ts(-8));
    if (d.statut !== 'BROUILLON') await hist('DOCUMENT', row.id, a.id, 'TRANSMISSION', 'EN_EXAMEN', 'Transmis au Chef de Bureau', ts(-6));
    if (d.statut === 'VALIDE') await hist('DOCUMENT', row.id, U('directeur').id, 'VALIDATION', 'VALIDE', 'Validé et signé par le Directeur', ts(-3));
    if (d.statut === 'EN_EXAMEN') await notif(U(d.detenteur).id, 'DOCUMENT_A_EXAMINER', `Document à examiner : ${d.titre}`, `/documents/${row.id}`, a.id);
  }

  // ─── Présences de la semaine précédente (verrouillées) ───────────────────
  const monday = new Date(); monday.setDate(monday.getDate() - ((monday.getDay() || 7) - 1) - 7);
  const lundi = monday.toISOString().slice(0, 10);
  const vendredi = new Date(monday); vendredi.setDate(vendredi.getDate() + 4);
  const d0 = new Date(Date.UTC(monday.getFullYear(), monday.getMonth(), monday.getDate()));
  d0.setUTCDate(d0.getUTCDate() + 4 - (d0.getUTCDay() || 7));
  const semaine = Math.ceil(((d0 - new Date(Date.UTC(d0.getUTCFullYear(), 0, 1))) / 86400000 + 1) / 7);
  const valeurs = ['PRESENT', 'PRESENT', 'PRESENT', 'PRESENT', 'PRESENT', 'PRESENT', 'RETARD', 'MISSION', 'CONGE', 'ABSENT', 'MALADIE'];
  let k = 0;
  for (const b of await knex('bureaux').where({ actif: true })) {
    const chef = Object.values(users).find((u) => u.bureau_id === b.id && u.username.startsWith('cb.'));
    if (!chef) continue;
    const [s] = await knex('presence_sheets').insert({
      reference: `DEP/PRES/${d0.getUTCFullYear()}/S${String(semaine).padStart(2, '0')}/${b.code}`, structure_type: 'BUREAU', direction_id: dep.id,
      division_id: b.division_id, bureau_id: b.id, semaine_debut: lundi, semaine_fin: vendredi.toISOString().slice(0, 10), annee: d0.getUTCFullYear(), numero_semaine: semaine,
      created_by: chef.id, created_at: ts(-6),
    }).returning('*');
    const agents = await knex('affectations').where({ bureau_id: b.id, est_active: true }).pluck('agent_id');
    await knex('presence_entries').insert(agents.map((agent_id) => ({ sheet_id: s.id, agent_id, ...Object.fromEntries(['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi'].map((j) => [j, valeurs[(k++ * 7) % valeurs.length]])) })));
    await knex('presence_sheets').where({ id: s.id }).update({ statut: 'VERROUILLEE', verified_by: chef.id, verified_at: ts(-3), submitted_by: chef.id, submitted_at: ts(-3), locked_by: U('directeur').id, locked_at: ts(-2) });
    for (const [action, statut, j] of [['CREATION', 'BROUILLON', -6], ['VERIFICATION', 'VERIFIEE', -3], ['SOUMISSION', 'SOUMISE', -3]]) await hist('PRESENCE', s.id, chef.id, action, statut, null, ts(j));
    await hist('PRESENCE', s.id, U('directeur').id, 'VERROUILLAGE', 'VERROUILLEE', 'Réception par le Directeur', ts(-2));
  }

  // ─── Fiches PIP ──────────────────────────────────────────────────────────
  const pipAuteur = U('ag.coi1');
  const donnees = {
    identification: { intitule: 'Backbone national en fibre optique — phase 2', code_pip: '', secteur: 'Économie numérique', sous_secteur: 'Infrastructures numériques', ministere_tutelle: 'Ministère des Postes, Télécommunications et Numérique', organisme_execution: 'Secrétariat Général au Numérique', nature: 'Extension', type_projet: 'Infrastructure', date_demarrage: day(120), duree_mois: 36 },
    contexte: { contexte: 'Le réseau de transport national demeure insuffisant pour soutenir la transformation numérique.', problematique: 'Coût élevé et faible disponibilité de la connectivité hors des grands centres.', justification: 'L’extension du backbone réduira les coûts de transit et favorisera l’inclusion numérique.', alignement: 'Plan national du numérique ; PNSD.' },
    objectifs: { objectif_general: 'Étendre le réseau national de fibre optique vers les provinces non desservies.', objectifs_specifiques: ['Déployer 2 000 km de fibre', 'Raccorder 10 chefs-lieux de province'] },
    resultats: { resultats_attendus: ['2 000 km de fibre déployés', 'Coût de la bande passante réduit de 30 %'] },
    activites: { activites: [{ code: 'A1', activite: 'Études techniques et environnementales', resultat: 'R1', debut: day(120), fin: day(300), cout: 1500000 }, { code: 'A2', activite: 'Travaux de pose de la fibre', resultat: 'R1', debut: day(300), fin: day(1000), cout: 42000000 }] },
    indicateurs: { indicateurs: [{ indicateur: 'Kilomètres de fibre posés', reference: '0', cible: '2000', annee_cible: '2029', source: 'Rapports de chantier' }] },
    beneficiaires: { directs: 'Opérateurs, administrations provinciales, universités', indirects: 'Population des provinces raccordées', nombre: 12000000, genre: 'Accès renforcé des femmes aux services numériques via les points d’accès publics.' },
    localisation: { sites: [{ province: 'Kasaï-Central', territoire: 'Kananga', site: 'Nœud régional' }, { province: 'Tshopo', territoire: 'Kisangani', site: 'Nœud régional' }] },
    chronogramme: { chronogramme: [{ activite: 'A1', annee: '2027', t1: 'X', t2: 'X', t3: '', t4: '' }] },
    cout: { devise: 'USD', couts: [{ rubrique: 'Études', annee1: 1500000, annee2: 0, annee3: 0, total: 1500000 }, { rubrique: 'Travaux', annee1: 12000000, annee2: 18000000, annee3: 12000000, total: 42000000 }] },
    financement: { sources: [{ source: 'Trésor public', montant: 13500000, pourcentage: 31, statut: 'Acquis' }, { source: 'Partenaires techniques et financiers', montant: 30000000, pourcentage: 69, statut: 'À rechercher' }] },
    risques: { risques: [{ risque: 'Retards d’approvisionnement', probabilite: 'Moyenne', impact: 'Élevé', mesure: 'Contrats-cadres et stock tampon' }] },
    impacts: { economique: 'Baisse des coûts de connectivité et développement des services numériques.', social: 'Meilleur accès à l’éducation et à la santé en ligne.', environnemental: 'Impacts limités ; plan de gestion environnementale prévu.', institutionnel: 'Renforcement de la gouvernance du secteur.' },
    gains: { van: 18500000, tri: 14.2, ratio_bc: 1.6, emplois: 1500, description: 'Gains liés à la réduction du coût de transit et aux nouveaux services.' },
    etudes: { etudes: [{ etude: 'Étude de faisabilité', date: '2025', auteur: 'Consultant', statut: 'Disponible' }] },
    responsables: { structure_responsable: 'Direction d’Études et Planification', chef_projet: 'À désigner', contacts: 'dep@economie-numerique.gouv.cd', partenaires: ['Banque mondiale'] },
  };
  const [p1] = await knex('pip_projects').insert({
    code: await ref('PIP', 'DEP/PIP'), intitule: donnees.identification.intitule, secteur: 'Économie numérique', statut: 'VALIDE', donnees: JSON.stringify(donnees), cout_total: 43500000,
    duree_mois: 36, date_debut: day(120), auteur_user_id: pipAuteur.id, detenteur_user_id: U('directeur').id, verifie_par: U('cd.sci').id, verifie_at: ts(-6),
    valide_par: U('directeur').id, valide_at: ts(-4), direction_id: dep.id, division_id: pipAuteur.division_id, bureau_id: pipAuteur.bureau_id, created_at: ts(-15),
  }).returning('*');
  await knex('pip_versions').insert({ pip_id: p1.id, numero: 1, donnees: JSON.stringify(donnees), created_by: pipAuteur.id });
  for (const [u, action, statut, j] of [['ag.coi1', 'CREATION', 'BROUILLON', -15], ['ag.coi1', 'SOUMISSION', 'EN_VERIFICATION', -8], ['cd.sci', 'VERIFICATION', 'VERIFIE', -6], ['directeur', 'VALIDATION', 'VALIDE', -4]]) {
    await hist('PIP', p1.id, U(u).id, action, statut, null, ts(j));
  }
  const brouillon = { ...donnees, identification: { ...donnees.identification, intitule: 'Centres communautaires numériques', nature: 'Nouveau projet', duree_mois: 24 } };
  const [p2] = await knex('pip_projects').insert({
    code: await ref('PIP', 'DEP/PIP'), intitule: brouillon.identification.intitule, secteur: 'Économie numérique', statut: 'EN_VERIFICATION', donnees: JSON.stringify(brouillon), cout_total: 43500000,
    duree_mois: 24, auteur_user_id: pipAuteur.id, detenteur_user_id: U('cd.sci').id, direction_id: dep.id, division_id: pipAuteur.division_id, bureau_id: pipAuteur.bureau_id, created_at: ts(-5),
  }).returning('*');
  await knex('pip_versions').insert({ pip_id: p2.id, numero: 1, donnees: JSON.stringify(brouillon), created_by: pipAuteur.id });
  await hist('PIP', p2.id, pipAuteur.id, 'SOUMISSION', 'EN_VERIFICATION', 'Soumise au Chef de Division pour vérification', ts(-2));
  await notif(U('cd.sci').id, 'PIP', 'Fiche PIP à vérifier : Centres communautaires numériques', `/pip/${p2.id}`, pipAuteur.id);
};

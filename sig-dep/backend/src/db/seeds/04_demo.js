'use strict';
/**
 * Seed 04 — Données de démonstration (désactivables avec SEED_DEMO=false).
 * Crée des Agents, leurs affectations et des comptes de test (mot de passe : Demo@2026).
 * À NE PAS utiliser en production.
 */
const bcrypt = require('bcrypt');
const config = require('../../config/env');

const DEMO_PASSWORD = 'Demo@2026';

exports.DEMO_PASSWORD = DEMO_PASSWORD;

exports.seed = async function seed(knex) {
  if (!config.seedDemo) return;
  if (await knex('agents').first()) return; // déjà initialisé
  await exports.chargerDemo(knex);
};

/** Charge le personnel et les comptes fictifs (aussi utilisé par la réinitialisation de l’Admin). */
exports.chargerDemo = async function chargerDemo(knex) {

  const dep = await knex('directions').where({ code: 'DEP' }).first();
  const grades = Object.fromEntries((await knex('grades')).map((g) => [g.code, g.id]));
  const fonctions = Object.fromEntries((await knex('fonctions')).map((f) => [f.code, f.id]));
  const roles = Object.fromEntries((await knex('roles')).map((r) => [r.code, r.id]));
  const divisions = Object.fromEntries((await knex('divisions')).map((d) => [d.code, d]));
  const bureaux = Object.fromEntries((await knex('bureaux')).map((b) => [b.code, b]));
  const postes = Object.fromEntries((await knex('postes_organiques')).map((p) => [p.code, p.id]));
  const admin = await knex('users').where({ username: 'admin' }).first();
  const hash = await bcrypt.hash(DEMO_PASSWORD, 10);
  let seq = 1;

  async function personne({ nom, postnom, prenom, sexe, grade, fonction, username, role, niveau, division, bureau, poste, autorite = false, compte = true }) {
    const matricule = `DEP-${String(seq++).padStart(4, '0')}`;
    const [agent] = await knex('agents').insert({
      matricule: autorite ? `SG-0001` : matricule, nom, postnom, prenom, sexe,
      grade_id: grades[grade], fonction_id: fonction ? fonctions[fonction] : null,
      telephone: compte ? `+243 81 000 ${String(seq).padStart(4, '0')}` : null,
      email: compte ? `${username}@economie-numerique.gouv.cd` : null, statut: 'ACTIF', est_autorite: autorite,
      liste_declarative: !autorite, enrole_at: compte && !autorite ? knex.fn.now() : null,
    }).returning('*');
    if (niveau) {
      await knex('affectations').insert({
        agent_id: agent.id, direction_id: dep.id, niveau,
        division_id: division ? divisions[division].id : null,
        bureau_id: bureau ? bureaux[bureau].id : null,
        poste_id: poste ? postes[poste] : null,
        date_debut: '2025-01-06', est_active: true, motif: 'Affectation initiale', created_by: admin.id,
      });
    }
    if (!compte) return null;
    const [user] = await knex('users').insert({
      username, password_hash: hash, agent_id: agent.id, statut: 'ACTIF',
      must_change_password: false, created_by: admin.id, password_changed_at: knex.fn.now(),
    }).returning('*');
    await knex('user_roles').insert({ user_id: user.id, role_id: roles[role], granted_by: admin.id });
    return user;
  }

  await personne({ nom: 'MUKENDI', postnom: 'KABONGO', prenom: 'Jean-Pierre', sexe: 'M', grade: 'SG', fonction: 'F-SG', username: 'sg', role: 'SECRETAIRE_GENERAL', autorite: true });
  const directeur = await personne({ nom: 'LUKUSA', postnom: 'MBUYI', prenom: 'Christine', sexe: 'F', grade: 'DIR', fonction: 'F-DIR', username: 'directeur', role: 'DIRECTEUR', niveau: 'DIRECTION', poste: 'P-DIR' });

  // Bureau Secrétariat de Direction (rang BUREAU, rattaché au Directeur)
  const cbBsd = await personne({ nom: 'NSIMBA', postnom: 'LANDU', prenom: 'Marie', sexe: 'F', grade: 'CB', fonction: 'F-CB', username: 'cb.secretariat', role: 'CHEF_BUREAU', niveau: 'BUREAU', bureau: 'BSD', poste: 'P-CB-BSD' });
  await personne({ nom: 'KAPINGA', postnom: 'TSHIBOLA', prenom: 'Esther', sexe: 'F', grade: 'AGA1', fonction: 'F-SEC', username: 'ag.secretariat1', role: 'AGENT', niveau: 'BUREAU', bureau: 'BSD', poste: 'P-AG-BSD' });
  await personne({ nom: 'MBALA', postnom: 'NZUZI', prenom: 'Patrick', sexe: 'M', grade: 'AGA2', fonction: 'F-ASS', username: 'ag.secretariat2', role: 'AGENT', niveau: 'BUREAU', bureau: 'BSD', poste: 'P-AG-BSD' });

  const chefsDivision = [
    ['DIV-EDI', 'cd.edi', 'KALALA', 'MWAMBA', 'Didier', 'M'],
    ['DIV-SCI', 'cd.sci', 'MPIANA', 'KANKU', 'Sylvie', 'F'],
    ['DIV-PS', 'cd.ps', 'TSHISEKEDI', 'NGALULA', 'Albert', 'M'],
  ];
  for (const [div, username, nom, postnom, prenom, sexe] of chefsDivision) {
    await personne({ nom, postnom, prenom, sexe, grade: 'CD', fonction: 'F-CD', username, role: 'CHEF_DIVISION', niveau: 'DIVISION', division: div, poste: `P-CD-${div}` });
  }

  const noms = [
    ['ILUNGA', 'KASONGO', 'Rachel', 'F'], ['BOKELE', 'MOKE', 'Serge', 'M'], ['NGOY', 'KAYEMBE', 'Aline', 'F'],
    ['MAKIADI', 'LUZOLO', 'Fabrice', 'M'], ['KABILA', 'MUNGA', 'Grâce', 'F'], ['LOKOMBE', 'BAKALI', 'Hervé', 'M'],
    ['MWEZE', 'CIRHUZA', 'Nadine', 'F'], ['KIBAMBE', 'LUBAYA', 'Olivier', 'M'], ['NTUMBA', 'KALENGA', 'Josée', 'F'],
    ['BOSEKOTA', 'IKOLI', 'Trésor', 'M'], ['MAWETE', 'SITA', 'Clarisse', 'F'], ['KAZADI', 'MUTEBA', 'Junior', 'M'],
    ['YAV', 'MUTOMBO', 'Béatrice', 'F'], ['LONGANGE', 'OTSHUDI', 'Cédric', 'M'], ['MATONDO', 'NKANGA', 'Pauline', 'F'],
    ['KASEREKA', 'PALUKU', 'Emmanuel', 'M'], ['BASEME', 'AMISI', 'Laurette', 'F'], ['NKULU', 'NUMBI', 'Gédéon', 'M'],
  ];
  let n = 0;
  const bureauxDiv = ['BUR-EAP', 'BUR-DOI', 'BUR-STR', 'BUR-COI', 'BUR-SEV', 'BUR-PRG'];
  for (const code of bureauxDiv) {
    const slug = code.replace('BUR-', '').toLowerCase();
    const division = Object.values(divisions).find((d) => d.id === bureaux[code].division_id).code;
    const [nom, postnom, prenom, sexe] = noms[n++];
    await personne({ nom, postnom, prenom, sexe, grade: 'CB', fonction: 'F-CB', username: `cb.${slug}`, role: 'CHEF_BUREAU', niveau: 'BUREAU', division, bureau: code, poste: `P-CB-${code}` });
    for (let i = 1; i <= 2; i++) {
      const [anom, apostnom, aprenom, asexe] = noms[n++];
      await personne({ nom: anom, postnom: apostnom, prenom: aprenom, sexe: asexe, grade: i === 1 ? 'ATA1' : 'ATA2', fonction: i === 1 ? 'F-CE' : (code === 'BUR-PRG' ? 'F-STAT' : 'F-ANA'), username: `ag.${slug}${i}`, role: 'AGENT', niveau: 'BUREAU', division, bureau: code, poste: `P-AG-${code}` });
    }
  }

  // Agents inscrits sur la liste déclarative mais pas encore enrôlés (démonstration de l’enrôlement).
  await personne({ nom: 'LUFUNDA', postnom: 'KIALA', prenom: 'Odette', sexe: 'F', grade: 'AGA1', niveau: 'BUREAU', bureau: 'BSD', poste: 'P-AG-BSD', compte: false });
  await personne({ nom: 'MASIKA', postnom: 'KAHINDO', prenom: 'Rodrigue', sexe: 'M', grade: 'ATA2', niveau: 'BUREAU', division: 'DIV-SCI', bureau: 'BUR-STR', poste: 'P-AG-BUR-STR', compte: false });
  await personne({ nom: 'BOLAMBA', postnom: 'EKOFO', prenom: 'Ruth', sexe: 'F', grade: 'ATA1', compte: false });

  // Liste déclarative validée par le Directeur (instantané initial).
  const { agentsInscrits, snapshotEntry } = require('../../services/listeDeclarative');
  const inscrits = await agentsInscrits(knex);
  await knex('listes_declaratives_validations').insert({
    direction_id: dep.id, valide_par: directeur.id, valide_par_role: 'DIRECTEUR', nb_agents: inscrits.length,
    agents: JSON.stringify(inscrits.map(snapshotEntry)), commentaire: 'Validation initiale (données de démonstration)',
  });

  // Délégations du Directeur au Chef du Bureau Secrétariat de Direction
  const delegables = await knex('permissions').where({ delegable: true });
  for (const p of delegables) {
    await knex('user_permissions').insert({
      user_id: cbBsd.id, permission_id: p.id, granted_by: directeur.id,
      motif: 'Délégation du Directeur : opérations administratives du Bureau Secrétariat de Direction',
    });
  }
  await knex('parametres').insert({ cle: 'donnees_demo', valeur: 'true', libelle: 'La base contient des données fictives de démonstration' })
    .onConflict('cle').merge(['valeur', 'updated_at']);
};

'use strict';
/**
 * Réinitialisation de la base par l’Admin, pour la mise en service :
 *  - VIERGE : supprime toutes les données (personnel, comptes, activités, pièces jointes)
 *    en conservant l’organigramme, les référentiels, les paramètres et le compte Admin.
 *    Le journal d’audit, l’historique de connexion et les alertes de sécurité ne sont JAMAIS effacés.
 *    Le Directeur peut alors constituer la liste officielle des agents (import puis validation).
 *  - DEMO : même nettoyage, puis rechargement des données fictives de démonstration.
 *
 * Tout se fait dans une seule transaction : en cas d’erreur, la base reste inchangée.
 */
const db = require('../db/knex');
const { removeQuiet } = require('./files');

/** Tables conservées : structure de la Direction, référentiels, sécurité, paramètres. */
const CONSERVEES = [
  'knex_migrations', 'knex_migrations_lock', 'directions', 'divisions', 'bureaux', 'grades', 'fonctions',
  'postes_organiques', 'attributions', 'effectif_reference', 'roles', 'permissions', 'role_permissions', 'parametres',
  // Traçabilité : jamais effacée (tables protégées en base contre la troncature)
  'audit_logs', 'login_history', 'alertes_securite', 'demandes_confirmation', 'acces_support', 'activations_urgence',
];

async function volumes(trx = db) {
  const r = await trx.raw(`select
    (select count(*) from agents) as agents, (select count(*) from users) as comptes,
    (select count(*) from instructions) as instructions, (select count(*) from tasks) as taches,
    (select count(*) from courriers) as courriers, (select count(*) from documents) as documents,
    (select count(*) from pip_projects) as pip, (select count(*) from presence_sheets) as presences,
    (select count(*) from attachments) as pieces, (select count(*) from audit_logs) as audit`);
  return Object.fromEntries(Object.entries(r.rows[0]).map(([k, v]) => [k, Number(v)]));
}

async function donneesDemo(trx = db) {
  const p = await trx('parametres').where({ cle: 'donnees_demo' }).first();
  return !!p && p.valeur === 'true';
}

async function reinitialiser({ mode, adminId }) {
  const fichiers = [];
  const avant = await volumes();
  await db.transaction(async (trx) => {
    // 1. Ce qui doit survivre : le compte Admin (mot de passe, rôles, sessions, préférences)
    const admin = await trx('users').where({ id: adminId }).first();
    const adminRoles = await trx('user_roles').where({ user_id: adminId });
    const adminTokens = await trx('refresh_tokens').where({ user_id: adminId }).whereNull('revoked_at').where('expires_at', '>', trx.fn.now());
    const adminPrefs = await trx('notification_preferences').where({ user_id: adminId }).first();
    const adminCodes = await trx('codes_secours').where({ user_id: adminId });
    const adminHisto = await trx('historique_mots_de_passe').where({ user_id: adminId });
    // Le compte d’urgence (scellé) survit lui aussi à la réinitialisation.
    const urgence = await trx('users').where({ compte_urgence: true }).whereNot('id', adminId).first();
    const urgenceRoles = urgence ? await trx('user_roles').where({ user_id: urgence.id }) : [];

    // 2. Fichiers déposés à supprimer après validation de la transaction
    fichiers.push(...await trx('attachments').pluck('stored_name'), ...(await trx('agents').whereNotNull('photo_path').pluck('photo_path')));

    // 3. Vidage de toutes les autres tables, en une seule instruction (sans CASCADE :
    //    PostgreSQL refuse si une table conservée dépendait d’une table vidée).
    const tables = (await trx.raw(`select tablename from pg_tables where schemaname = current_schema() order by tablename`)).rows
      .map((r) => r.tablename).filter((t) => !CONSERVEES.includes(t));
    // Les identifiants ne sont pas réinitialisés : un ancien identifiant cité dans l’audit ne désigne jamais un nouveau compte.
    await trx.raw(`TRUNCATE TABLE ${tables.map((t) => `"${t}"`).join(', ')}`);

    // 4. Restauration du compte Admin (même identifiant : sa session reste valide)
    await trx('users').insert({ ...admin, agent_id: null, created_by: null, autorise_par: null });
    if (adminRoles.length) await trx('user_roles').insert(adminRoles.map(({ id, ...r }) => ({ ...r, granted_by: null })));
    if (adminTokens.length) await trx('refresh_tokens').insert(adminTokens.map(({ id, ...t }) => ({ ...t, replaced_by: null })));
    if (adminPrefs) await trx('notification_preferences').insert(adminPrefs);
    if (adminCodes.length) await trx('codes_secours').insert(adminCodes.map(({ id, ...c }) => c));
    if (adminHisto.length) await trx('historique_mots_de_passe').insert(adminHisto.map(({ id, ...h }) => h));
    if (urgence) {
      await trx('users').insert({ ...urgence, agent_id: null, created_by: null, autorise_par: null });
      if (urgenceRoles.length) await trx('user_roles').insert(urgenceRoles.map(({ id, ...r }) => ({ ...r, granted_by: null })));
    }

    // 5. Données fictives éventuelles
    if (mode === 'DEMO') {
      await require('../db/seeds/01_organisation').seed(trx);
      await require('../db/seeds/04_demo').chargerDemo(trx);
      await require('../db/seeds/05_demo_activites').chargerActivites(trx);
    }
    await trx('parametres').insert({ cle: 'donnees_demo', valeur: String(mode === 'DEMO'), libelle: 'La base contient des données fictives de démonstration' })
      .onConflict('cle').merge(['valeur']);
  });
  fichiers.forEach((f) => removeQuiet(f));
  return { avant, apres: await volumes() };
}

module.exports = { reinitialiser, volumes, donneesDemo, CONSERVEES };

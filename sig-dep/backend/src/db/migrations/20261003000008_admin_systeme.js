'use strict';
/**
 * 1.6 — Compte Admin Système (lot 1) :
 *  - rôle ADMIN renommé ADMIN_SYSTEME ;
 *  - permissions renommées selon le référentiel validé (les attributions sont conservées) ;
 *  - nouvelles permissions techniques ;
 *  - l’Admin ne gère plus la liste déclarative (réservée au Directeur).
 */
const RENOMMAGES = [
  ['systeme.parametres', 'systeme.configurer', 'systeme', 'Configurer les paramètres techniques du système'],
  ['systeme.etat', 'systeme.consulter', 'systeme', 'Consulter l’état technique du système'],
  ['systeme.sauvegardes', 'sauvegarde.creer', 'sauvegarde', 'Lancer et consulter les sauvegardes'],
  ['systeme.reinitialiser', 'systeme.maintenir', 'systeme', 'Opérations de maintenance (réinitialisation, maintenance)'],
  ['roles.gerer', 'role.attribuer', 'role', 'Associer un rôle autorisé et paramétrer les rôles'],
  ['comptes.consulter', 'compte.consulter', 'compte', 'Consulter les comptes utilisateurs'],
  ['comptes.creer_initial', 'compte.creer_initial', 'compte', 'Créer les comptes initiaux (Secrétaire Général, Directeur)'],
  ['comptes.enroler', 'compte.enroler', 'compte', 'Enrôler les agents de la liste déclarative validée'],
  ['comptes.activer', 'compte.activer', 'compte', 'Activer un compte'],
  ['comptes.reinitialiser', 'compte.reinitialiser_mot_de_passe', 'compte', 'Réinitialiser un mot de passe ou imposer son changement'],
  ['comptes.deverrouiller', 'compte.deverrouiller', 'compte', 'Débloquer un compte'],
  ['sessions.revoquer', 'session.revoquer', 'session', 'Révoquer les sessions et refresh tokens'],
];

const NOUVELLES = [
  ['compte.desactiver', 'compte', 'Désactiver ou bloquer temporairement un compte'],
  ['securite.superviser', 'securite', 'Superviser la sécurité (alertes, échecs de connexion, adresses IP, vérification)'],
  ['session.consulter', 'session', 'Consulter les sessions actives'],
  ['role.consulter', 'role', 'Consulter les rôles'],
  ['permission.consulter', 'role', 'Consulter les permissions'],
  ['organisation.configurer', 'organisation', 'Configurer techniquement l’organisation (sur décision du Directeur)'],
  ['referentiel.gerer', 'organisation', 'Gérer les référentiels techniques'],
  ['audit.exporter', 'audit', 'Exporter le journal d’audit'],
  ['sauvegarde.restaurer', 'sauvegarde', 'Restaurer une sauvegarde autorisée'],
  ['modele_carte.configurer', 'carte', 'Configurer le modèle graphique des cartes de service'],
  ['notification_systeme.envoyer', 'systeme', 'Envoyer une notification système'],
];

exports.up = async function up(knex) {
  for (const [ancien, nouveau, module, libelle] of RENOMMAGES) {
    await knex('permissions').where({ code: ancien }).update({ code: nouveau, module, libelle });
  }
  await knex('roles').where({ code: 'ADMIN' }).update({ code: 'ADMIN_SYSTEME', libelle: 'Admin Système', description: 'Fonctionnement technique, sécurité et disponibilité de SIG-DEP. Aucune autorité administrative : ne remplace jamais le Directeur, un Chef de Division ou un Chef de Bureau.' });

  const admin = await knex('roles').where({ code: 'ADMIN_SYSTEME' }).first();
  for (const [code, module, libelle] of NOUVELLES) {
    const [p] = await knex('permissions').insert({ code, module, libelle, delegable: false, reservee_division: false }).onConflict('code').merge(['libelle', 'module']).returning('id');
    if (admin) await knex('role_permissions').insert({ role_id: admin.id, permission_id: p.id }).onConflict(['role_id', 'permission_id']).ignore();
  }
  // Ceux qui activaient les comptes peuvent aussi les désactiver (Directeur, Admin).
  const activer = await knex('permissions').where({ code: 'compte.activer' }).first();
  const desactiver = await knex('permissions').where({ code: 'compte.desactiver' }).first();
  if (activer && desactiver) {
    const roles = await knex('role_permissions').where({ permission_id: activer.id }).pluck('role_id');
    for (const r of roles) await knex('role_permissions').insert({ role_id: r, permission_id: desactiver.id }).onConflict(['role_id', 'permission_id']).ignore();
  }
  // La liste déclarative relève du Directeur : l’Admin n’y a plus accès.
  if (admin) {
    const liste = await knex('permissions').whereIn('code', ['liste.consulter', 'liste.gerer', 'liste.valider']).pluck('id');
    await knex('role_permissions').where({ role_id: admin.id }).whereIn('permission_id', liste).del();
  }
};

exports.down = async function down(knex) {
  const admin = await knex('roles').where({ code: 'ADMIN_SYSTEME' }).first();
  const ids = await knex('permissions').whereIn('code', NOUVELLES.map((n) => n[0])).pluck('id');
  await knex('role_permissions').whereIn('permission_id', ids).del();
  await knex('user_permissions').whereIn('permission_id', ids).del();
  await knex('permissions').whereIn('id', ids).del();
  for (const [ancien, nouveau] of RENOMMAGES) await knex('permissions').where({ code: nouveau }).update({ code: ancien });
  if (admin) await knex('roles').where({ id: admin.id }).update({ code: 'ADMIN', libelle: 'Admin' });
};

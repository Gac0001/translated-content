'use strict';
/**
 * Sécurité (Admin Système) : politique des mots de passe et des sessions, alertes,
 * sessions actives, historique des connexions et vérification de sécurité.
 */
const fs = require('fs');
const path = require('path');
const express = require('express');
const { z } = require('zod');
const db = require('../../db/knex');
const config = require('../../config/env');
const validate = require('../../middleware/validate');
const { requirePerm } = require('../../middleware/auth');
const { audit } = require('../../services/audit');
const { alerter } = require('../../services/alertes');
const { politique, invalider, DEFAUTS, BORNES } = require('../../services/politique');
const { verifier } = require('../../services/auditIntegrite');
const { notFound, badRequest } = require('../../utils/errors');

const router = express.Router();

// ─── Politique ───────────────────────────────────────────────────────────────
const LIBELLES = {
  mdp_longueur_min: 'Longueur minimale', mdp_exiger_majuscule: 'Exiger une majuscule', mdp_exiger_minuscule: 'Exiger une minuscule',
  mdp_exiger_chiffre: 'Exiger un chiffre', mdp_exiger_special: 'Exiger un caractère spécial', mdp_historique: 'Anciens mots de passe interdits',
  mdp_expiration_jours: 'Expiration (jours, 0 = jamais)', verrouillage_tentatives: 'Échecs avant verrouillage', verrouillage_minutes: 'Durée du verrouillage (minutes)',
  session_duree_jours: 'Durée maximale d’une session (jours)', session_inactivite_minutes: 'Déconnexion après inactivité (minutes)',
  inactivite_compte_jours: 'Compte inactif après (jours sans connexion)', inactivite_desactivation_auto: 'Désactiver automatiquement les comptes inactifs',
  alerte_echecs_seuil: 'Alerte : échecs de connexion en 15 minutes',
  disque_seuil_attention: 'Espace disque : alerte sous (% libre)', disque_seuil_critique: 'Espace disque : critique sous (% libre)',
  erreurs_conservation_jours: 'Journal technique : conservation (jours)',
};

router.get('/politique', requirePerm('systeme.consulter', 'securite.superviser'), async (req, res) => {
  const p = await politique();
  res.json({ valeurs: Object.fromEntries(Object.keys(LIBELLES).map((k) => [k, p[k]])), libelles: LIBELLES, bornes: BORNES, defauts: DEFAUTS });
});

router.put('/politique', requirePerm('systeme.configurer'), validate({ body: z.record(z.string(), z.union([z.number(), z.boolean()])) }), async (req, res) => {
  const avant = await politique();
  const changes = {};
  for (const [cle, v] of Object.entries(req.valid.body)) {
    if (!LIBELLES[cle]) throw badRequest(`Paramètre inconnu : ${cle}.`);
    if (typeof DEFAUTS[cle] === 'boolean') {
      if (typeof v !== 'boolean') throw badRequest(`${LIBELLES[cle]} : valeur oui/non attendue.`);
    } else {
      const [min, max] = BORNES[cle];
      if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) throw badRequest(`${LIBELLES[cle]} : valeur entière entre ${min} et ${max} attendue.`);
    }
    if (avant[cle] !== v) changes[cle] = v;
  }
  const futur = { ...avant, ...changes };
  if (futur.disque_seuil_attention <= futur.disque_seuil_critique) throw badRequest('Le seuil d’alerte d’espace disque doit être supérieur au seuil critique.');
  if (!Object.keys(changes).length) return res.json({ message: 'Aucun changement.' });
  await db.transaction(async (trx) => {
    for (const [cle, v] of Object.entries(changes)) {
      await trx('parametres').where({ cle }).update({ valeur: String(v), updated_at: trx.fn.now(), updated_by: req.ctx.userId });
    }
  });
  invalider();
  const anciens = Object.fromEntries(Object.keys(changes).map((k) => [k, avant[k]]));
  await audit(req, { action: 'POLITIQUE_SECURITE', module: 'securite', avant: anciens, apres: changes, message: 'Modification de la politique de sécurité' });
  await alerter({ type: 'POLITIQUE', gravite: 'ATTENTION', titre: 'Politique de sécurité modifiée', message: Object.keys(changes).map((k) => `${LIBELLES[k]} : ${anciens[k]} → ${changes[k]}`).join(' ; '), user: { id: req.ctx.userId, username: req.ctx.username }, ip: req.ip });
  res.json({ message: 'Politique de sécurité enregistrée.', valeurs: await politique() });
});

// ─── Alertes ─────────────────────────────────────────────────────────────────
router.get('/alertes', requirePerm('securite.superviser'), validate({ query: z.object({ statut: z.enum(['ouvertes', 'toutes']).default('ouvertes'), limit: z.coerce.number().int().min(1).max(500).default(100) }) }), async (req, res) => {
  const q = db('alertes_securite as a').leftJoin('users as u', 'u.id', 'a.acquittee_par').select('a.*', 'u.username as acquittee_par_username').orderBy('a.created_at', 'desc').limit(req.valid.query.limit);
  if (req.valid.query.statut === 'ouvertes') q.whereNull('a.acquittee_at');
  const resume = (await db('alertes_securite').whereNull('acquittee_at').select('gravite').count('* as n').groupBy('gravite'))
    .reduce((o, r) => ({ ...o, [r.gravite]: Number(r.n) }), { INFO: 0, ATTENTION: 0, CRITIQUE: 0 });
  res.json({ data: await q, resume });
});

router.post('/alertes/:id/acquitter', requirePerm('securite.superviser'), validate({ params: z.object({ id: z.coerce.number().int().positive() }), body: z.object({ commentaire: z.string().trim().max(500).optional() }) }), async (req, res) => {
  const a = await db('alertes_securite').where({ id: req.valid.params.id }).first();
  if (!a) throw notFound('Alerte introuvable.');
  if (a.acquittee_at) throw badRequest('Alerte déjà traitée.');
  await db('alertes_securite').where({ id: a.id }).update({ acquittee_at: db.fn.now(), acquittee_par: req.ctx.userId });
  await audit(req, { action: 'ACQUITTEMENT_ALERTE', module: 'securite', entite: 'alerte', entiteId: a.id, message: `${a.titre}${req.valid.body.commentaire ? ` — ${req.valid.body.commentaire}` : ''}` });
  res.json({ message: 'Alerte marquée comme traitée.' });
});

// ─── Sessions actives ───────────────────────────────────────────────────────
router.get('/sessions', requirePerm('session.consulter'), async (req, res) => {
  // Une session = une famille de refresh tokens ; seul le jeton courant (non révoqué) est actif.
  const rows = await db('refresh_tokens as t').join('users as u', 'u.id', 't.user_id')
    .whereNull('t.revoked_at').where('t.expires_at', '>', db.fn.now())
    .select('t.family_id', 't.ip', 't.user_agent', 't.expires_at', 't.created_at as dernier_renouvellement', 'u.id as user_id', 'u.username',
      db.raw(`(select min(created_at) from refresh_tokens f where f.family_id = t.family_id) as ouverte_le`),
      db.raw(`ARRAY(SELECT r.code FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = u.id) as roles`))
    .orderBy('t.created_at', 'desc');
  res.json({ data: rows });
});

router.post('/sessions/:famille/revoquer', requirePerm('session.revoquer'), validate({ params: z.object({ famille: z.uuid() }), body: z.object({ motif: z.string().trim().max(300).optional() }) }), async (req, res) => {
  const t = await db('refresh_tokens').where({ family_id: req.valid.params.famille }).first();
  if (!t) throw notFound('Session introuvable.');
  const n = await db('refresh_tokens').where({ family_id: t.family_id }).whereNull('revoked_at').update({ revoked_at: db.fn.now(), revoked_reason: 'REVOCATION_ADMIN' });
  const u = await db('users').where({ id: t.user_id }).first('id', 'username');
  await audit(req, { action: 'REVOCATION_SESSION', module: 'securite', entite: 'user', entiteId: t.user_id, message: `Session fermée (${t.ip || 'IP inconnue'})${req.valid.body.motif ? ` — ${req.valid.body.motif}` : ''}` });
  res.json({ message: n ? `Session de « ${u.username} » fermée : elle ne pourra plus être renouvelée.` : 'Session déjà fermée.' });
});

// ─── Connexions ──────────────────────────────────────────────────────────────
router.get('/connexions', requirePerm('securite.superviser'), validate({ query: z.object({
  resultat: z.enum(['succes', 'echec']).optional(), q: z.string().trim().max(80).optional(), heures: z.coerce.number().int().min(1).max(24 * 90).default(24 * 7),
  limit: z.coerce.number().int().min(1).max(1000).default(200),
}) }), async (req, res) => {
  const f = req.valid.query;
  const base = () => {
    const q = db('login_history').where('created_at', '>', db.raw(`now() - make_interval(hours => ?)`, [f.heures]));
    if (f.resultat) q.where('succes', f.resultat === 'succes');
    if (f.q) q.where((w) => w.whereILike('username', `%${f.q}%`).orWhereILike('ip', `%${f.q}%`));
    return q;
  };
  const [data, ips, resume] = await Promise.all([
    base().orderBy('created_at', 'desc').limit(f.limit),
    db('login_history').where('created_at', '>', db.raw(`now() - make_interval(hours => ?)`, [f.heures])).where('succes', false)
      .select('ip').count('* as echecs').countDistinct('username as comptes').max('created_at as derniere').groupBy('ip').orderBy('echecs', 'desc').limit(10),
    db('login_history').where('created_at', '>', db.raw(`now() - make_interval(hours => ?)`, [f.heures]))
      .select(db.raw('count(*) filter (where succes) as succes'), db.raw('count(*) filter (where not succes) as echecs')).first(),
  ]);
  res.json({ data, ipsSuspectes: ips.map((r) => ({ ...r, echecs: Number(r.echecs), comptes: Number(r.comptes) })), resume: { succes: Number(resume.succes), echecs: Number(resume.echecs) } });
});

// ─── Vérification de sécurité ───────────────────────────────────────────────
async function controlerFichiers() {
  let surDisque = [];
  try { surDisque = fs.readdirSync(config.uploadDir).filter((f) => !f.startsWith('.')); } catch (e) { return { statut: 'ATTENTION', detail: `Répertoire des fichiers inaccessible : ${e.message}` }; }
  const references = new Set([...(await db('attachments').pluck('stored_name')), ...(await db('agents').whereNotNull('photo_path').pluck('photo_path'))]);
  const orphelins = surDisque.filter((f) => !references.has(f));
  const manquants = [...references].filter((f) => !surDisque.includes(f));
  const extensions = surDisque.filter((f) => !/\.(pdf|jpe?g|png|webp|docx?|xlsx?|odt|ods|txt|csv|zip)$/i.test(f));
  const pb = [];
  if (manquants.length) pb.push(`${manquants.length} fichier(s) référencé(s) introuvable(s) sur le disque`);
  if (orphelins.length) pb.push(`${orphelins.length} fichier(s) sans référence en base`);
  if (extensions.length) pb.push(`${extensions.length} fichier(s) de type inattendu`);
  return { statut: manquants.length || extensions.length || orphelins.length ? 'ATTENTION' : 'OK', detail: pb.length ? pb.join(' ; ') : `${surDisque.length} fichier(s) contrôlé(s), tous référencés.` };
}

router.post('/verification', requirePerm('securite.superviser'), async (req, res) => {
  const p = await politique();
  const controles = [];
  const add = (controle, statut, detail) => controles.push({ controle, statut, detail });

  const integrite = await verifier();
  add('Intégrité du journal d’audit', integrite.integre ? 'OK' : 'CRITIQUE', integrite.integre ? `${integrite.entrees} entrées chaînées, aucune altération.` : integrite.problemes.map((x) => x.raison).slice(0, 3).join(' ; '));

  const admins = await db('users as u').join('user_roles as ur', 'ur.user_id', 'u.id').join('roles as r', 'r.id', 'ur.role_id').where('r.code', 'ADMIN_SYSTEME').whereNot('u.statut', 'DESACTIVE').select('u.username', 'u.totp_actif', 'u.email_recuperation', 'u.email_recuperation_verifie_at');
  const sans2fa = admins.filter((a) => !a.totp_actif);
  add('Double authentification des Admins', sans2fa.length ? 'CRITIQUE' : 'OK', sans2fa.length ? `Sans 2FA : ${sans2fa.map((a) => a.username).join(', ')}` : `${admins.length} compte(s) Admin protégé(s).`);
  const nonVerifies = admins.filter((a) => !a.email_recuperation || !a.email_recuperation_verifie_at);
  add('Adresse de récupération des Admins', nonVerifies.length ? 'ATTENTION' : 'OK', nonVerifies.length ? `Non vérifiée : ${nonVerifies.map((a) => a.username).join(', ')} (récupération par e-mail impossible).` : 'Vérifiée.');
  add('Nombre de comptes Admin Système', admins.length === 1 ? 'OK' : 'ATTENTION', `${admins.length} compte(s) actif(s) (un seul attendu).`);

  const temporaires = Number((await db('users').where({ must_change_password: true }).whereNot('statut', 'DESACTIVE').where('created_at', '<', db.raw(`now() - interval '7 days'`)).count('* as n').first()).n);
  add('Mots de passe temporaires anciens', temporaires ? 'ATTENTION' : 'OK', temporaires ? `${temporaires} compte(s) n’ont pas changé leur mot de passe temporaire depuis plus de 7 jours.` : 'Aucun.');

  const inactifs = Number((await db('users').whereNot('statut', 'DESACTIVE').whereRaw('coalesce(last_login_at, created_at) < now() - make_interval(days => ?)', [p.inactivite_compte_jours]).count('* as n').first()).n);
  add('Comptes inactifs', inactifs ? 'ATTENTION' : 'OK', inactifs ? `${inactifs} compte(s) sans connexion depuis plus de ${p.inactivite_compte_jours} jours.` : 'Aucun.');

  const verrouilles = Number((await db('users').where('statut', 'VERROUILLE').count('* as n').first()).n);
  add('Comptes verrouillés', verrouilles ? 'ATTENTION' : 'OK', `${verrouilles} compte(s).`);

  const echecs = Number((await db('login_history').where('succes', false).where('created_at', '>', db.raw(`now() - interval '24 hours'`)).count('* as n').first()).n);
  add('Échecs de connexion (24 h)', echecs >= p.alerte_echecs_seuil * 2 ? 'ATTENTION' : 'OK', `${echecs} échec(s).`);

  const faibles = [];
  if (p.mdp_longueur_min < 10) faibles.push(`longueur minimale ${p.mdp_longueur_min}`);
  if (!p.mdp_exiger_special || !p.mdp_exiger_chiffre) faibles.push('complexité réduite');
  if (p.session_duree_jours > 14) faibles.push(`sessions de ${p.session_duree_jours} jours`);
  add('Politique des mots de passe et des sessions', faibles.length ? 'ATTENTION' : 'OK', faibles.length ? faibles.join(' ; ') : 'Conforme aux recommandations.');

  const secretDefaut = /remplacer-par|secret-de-test|changeme/i.test(config.jwt.accessSecret) || config.jwt.accessSecret.length < 32;
  add('Secret de signature des jetons', secretDefaut ? (config.isProd ? 'CRITIQUE' : 'ATTENTION') : 'OK', secretDefaut ? 'Secret JWT par défaut ou trop court : définissez JWT_ACCESS_SECRET (32 caractères au moins).' : 'Défini.');
  add('Cookies de session sécurisés (HTTPS)', config.cookieSecure ? 'OK' : (config.isProd ? 'CRITIQUE' : 'ATTENTION'), config.cookieSecure ? 'COOKIE_SECURE=true.' : 'COOKIE_SECURE=false : à activer en production derrière HTTPS.');
  add('Messagerie (alertes et récupération)', config.mail.enabled ? 'OK' : 'ATTENTION', config.mail.enabled ? 'Active.' : 'Désactivée : alertes et récupération par e-mail indisponibles.');

  let derniere = null;
  try {
    derniere = fs.readdirSync(config.backupDir).filter((f) => /\.(dump|sql)$/.test(f)).map((f) => fs.statSync(path.join(config.backupDir, f)).mtime).sort((a, b) => b - a)[0] || null;
  } catch (e) { /* aucun répertoire */ }
  const age = derniere ? (Date.now() - derniere.getTime()) / 3600000 : null;
  add('Dernière sauvegarde', !derniere ? 'CRITIQUE' : age > 48 ? 'ATTENTION' : 'OK', derniere ? `Il y a ${Math.round(age)} h.` : 'Aucune sauvegarde trouvée.');

  const f = await controlerFichiers();
  add('Fichiers téléversés', f.statut, f.detail);

  const bilan = controles.some((c) => c.statut === 'CRITIQUE') ? 'CRITIQUE' : controles.some((c) => c.statut === 'ATTENTION') ? 'ATTENTION' : 'OK';
  await audit(req, { action: 'VERIFICATION_SECURITE', module: 'securite', resultat: bilan === 'CRITIQUE' ? 'ECHEC' : 'SUCCES', message: `Vérification de sécurité : ${bilan}`, apres: { controles: controles.map((c) => `${c.controle} : ${c.statut}`) } });
  if (bilan === 'CRITIQUE') await alerter({ type: 'VERIFICATION', gravite: 'CRITIQUE', titre: 'La vérification de sécurité signale des points critiques', message: controles.filter((c) => c.statut === 'CRITIQUE').map((c) => c.controle).join(', '), user: { id: req.ctx.userId, username: req.ctx.username }, unique: 60 });
  await db('parametres').insert({ cle: 'securite_derniere_verification', valeur: JSON.stringify({ bilan, at: new Date().toISOString() }), libelle: 'Sécurité : dernière vérification' }).onConflict('cle').merge(['valeur', 'updated_at']);
  res.json({ bilan, controles, verifieAt: new Date().toISOString() });
});

module.exports = router;

'use strict';
/**
 * Sauvegardes (Admin Système) : registre, sauvegarde manuelle, vérification d’intégrité,
 * test de restauration, planification et conservation ; restaurations (demande Admin,
 * validation Directeur, exécution Admin).
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
const { politique, invalider } = require('../../services/politique');
const sv = require('../../services/sauvegarde');
const restauration = require('../../services/restauration');
const { notFound, badRequest } = require('../../utils/errors');

const router = express.Router();
const idParam = z.object({ id: z.coerce.number().int().positive() });
const moi = (req) => ({ id: req.ctx.userId, username: req.ctx.username });

async function sauvegardeActive(id) {
  const s = await db('sauvegardes').where({ id, statut: 'REUSSIE' }).whereNull('supprimee_at').first();
  if (!s) throw notFound('Sauvegarde introuvable ou supprimée.');
  return s;
}

// ─── Restaurations (avant les routes « /:id ») ──────────────────────────────
router.get('/restaurations', requirePerm('sauvegarde.restaurer', 'sauvegarde.valider_restauration'), async (req, res) => {
  await restauration.expirer();
  res.json({ data: await db('demandes_restauration').orderBy('id', 'desc').limit(50), phrase: restauration.PHRASE, validiteHeures: restauration.VALIDITE_HEURES,
    actions: { demander: req.ctx.can('sauvegarde.restaurer'), decider: req.ctx.can('sauvegarde.valider_restauration') } });
});

router.post('/restaurations/:id/decision', requirePerm('sauvegarde.valider_restauration'), validate({ params: idParam, body: z.object({
  decision: z.enum(['VALIDER', 'REFUSER']), motDePasse: z.string().min(1, 'mot de passe requis'), commentaire: z.string().trim().max(1000).optional(),
}) }), async (req, res) => {
  const d = await restauration.decider(req.valid.params.id, req.valid.body, req);
  res.json({ message: d.statut === 'VALIDEE' ? `Restauration validée : l’Admin Système peut l’exécuter pendant ${restauration.VALIDITE_HEURES} h.` : 'Restauration refusée.', demande: d });
});

router.post('/restaurations/:id/annuler', requirePerm('sauvegarde.restaurer'), validate({ params: idParam }), async (req, res) => {
  await restauration.annuler(req.valid.params.id, req);
  res.json({ message: 'Demande annulée.' });
});

router.post('/restaurations/:id/executer', requirePerm('sauvegarde.restaurer'), validate({ params: idParam, body: z.object({
  confirmation: z.string().trim(), motDePasse: z.string().min(1), code: z.string().trim().min(6).max(20),
}) }), async (req, res) => {
  const r = await restauration.executer(req.valid.params.id, req.valid.body, req);
  res.json({ message: 'Base restaurée. Toutes les sessions ont été fermées : reconnectez-vous.', resultat: r });
});

// ─── Registre et opérations ─────────────────────────────────────────────────
router.get('/', requirePerm('sauvegarde.creer'), async (req, res) => {
  const p = await politique();
  const [actives, historique, verifications, etat] = await Promise.all([
    db('sauvegardes').where({ statut: 'REUSSIE' }).whereNull('supprimee_at').orderBy('created_at', 'desc'),
    db('sauvegardes').orderBy('created_at', 'desc').limit(100),
    db('verifications_sauvegarde').orderBy('created_at', 'desc').limit(30),
    sv.etatSauvegardes(),
  ]);
  res.json({
    sauvegardes: actives.map((s) => ({ ...s, presente: fs.existsSync(path.join(config.backupDir, s.fichier)) })), historique, verifications, etat,
    planification: Object.fromEntries(['sauvegarde_auto', 'sauvegarde_heure', 'retention_quotidienne', 'retention_hebdomadaire', 'retention_mensuelle', 'retention_ponctuelle_jours', 'test_restauration_auto', 'test_restauration_jour'].map((k) => [k, p[k]])),
    configuration: { repertoire: config.backupDir, copie: config.backupCopyDir, chiffrement: !!config.backupEncKey },
  });
});

router.post('/', requirePerm('sauvegarde.creer'), async (req, res) => {
  const r = await sv.creerSauvegarde('', { origine: 'MANUELLE', user: moi(req) }).catch(async (e) => {
    await audit(req, { action: 'SAUVEGARDE', module: 'systeme', resultat: 'ECHEC', message: e.message });
    throw e;
  });
  const v = await sv.verifierIntegrite(await db('sauvegardes').where({ id: r.id }).first(), { user: moi(req) });
  await audit(req, { action: 'SAUVEGARDE', module: 'systeme', message: `${r.fichier} (${r.tailleOctets} octets${r.chiffre ? ', chiffrée' : ''}, copie : ${r.copie})` });
  res.status(201).json({ ...r, verification: v.statut, message: 'Sauvegarde réalisée et vérifiée.' });
});

router.post('/:id/verifier', requirePerm('sauvegarde.creer'), validate({ params: idParam }), async (req, res) => {
  const s = await sauvegardeActive(req.valid.params.id);
  const r = await sv.verifierIntegrite(s, { user: moi(req) });
  await audit(req, { action: 'VERIFICATION_SAUVEGARDE', module: 'sauvegarde', entite: 'sauvegarde', entiteId: s.id, resultat: r.statut === 'OK' ? 'SUCCES' : 'ECHEC', message: `${s.fichier} : ${r.statut}` });
  res.json(r);
});

router.post('/:id/tester', requirePerm('sauvegarde.creer'), validate({ params: idParam }), async (req, res) => {
  const s = await sauvegardeActive(req.valid.params.id);
  const r = await sv.testerRestauration(s, { user: moi(req) });
  await audit(req, { action: 'TEST_RESTAURATION', module: 'sauvegarde', entite: 'sauvegarde', entiteId: s.id, resultat: r.statut === 'OK' ? 'SUCCES' : 'ECHEC', message: `${s.fichier} : ${r.statut}` });
  res.json(r);
});

router.get('/:id/telecharger', requirePerm('sauvegarde.creer'), validate({ params: idParam }), async (req, res) => {
  const s = await sauvegardeActive(req.valid.params.id);
  const chemin = path.join(config.backupDir, s.fichier);
  if (!fs.existsSync(chemin)) throw notFound('Fichier absent du serveur.');
  await audit(req, { action: 'EXPORT', module: 'sauvegarde', entite: 'sauvegarde', entiteId: s.id, message: `Téléchargement de la sauvegarde ${s.fichier}` });
  res.download(chemin);
});

router.post('/:id/restauration', requirePerm('sauvegarde.restaurer'), validate({ params: idParam, body: z.object({ motif: z.string().trim().min(10, 'motif détaillé requis (10 caractères au moins)').max(1000) }) }), async (req, res) => {
  const d = await restauration.demander(req.valid.params.id, req.valid.body.motif, req);
  res.status(201).json({ message: 'Demande transmise au Directeur pour validation.', demande: d });
});

// ─── Planification et conservation ──────────────────────────────────────────
router.put('/planification', requirePerm('systeme.configurer'), validate({ body: z.object({
  sauvegarde_auto: z.boolean(), sauvegarde_heure: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'heure HH:MM attendue'),
  retention_quotidienne: z.number().int().min(3).max(60), retention_hebdomadaire: z.number().int().min(0).max(52), retention_mensuelle: z.number().int().min(0).max(120),
  retention_ponctuelle_jours: z.number().int().min(7).max(3650), test_restauration_auto: z.boolean(), test_restauration_jour: z.number().int().min(0).max(6),
}).partial() }), async (req, res) => {
  const avant = await politique();
  const changes = Object.fromEntries(Object.entries(req.valid.body).filter(([k, v]) => avant[k] !== v));
  if (!Object.keys(changes).length) return res.json({ message: 'Aucun changement.' });
  for (const [cle, v] of Object.entries(changes)) await db('parametres').where({ cle }).update({ valeur: String(v), updated_at: db.fn.now(), updated_by: req.ctx.userId });
  invalider();
  const anciens = Object.fromEntries(Object.keys(changes).map((k) => [k, avant[k]]));
  await audit(req, { action: 'PLANIFICATION_SAUVEGARDES', module: 'sauvegarde', avant: anciens, apres: changes, message: 'Modification de la planification des sauvegardes' });
  if (changes.sauvegarde_auto === false) await alerter({ type: 'SAUVEGARDE_AUTO_DESACTIVEE', gravite: 'ATTENTION', titre: 'Sauvegardes automatiques désactivées', message: `Par ${req.ctx.username}.`, user: moi(req) });
  res.json({ message: 'Planification enregistrée.' });
});

router.post('/conservation/appliquer', requirePerm('systeme.maintenir'), async (req, res) => {
  const supprimees = await sv.appliquerRetention();
  await audit(req, { action: 'CONSERVATION_SAUVEGARDES', module: 'sauvegarde', message: `${supprimees.length} sauvegarde(s) supprimée(s) selon la politique`, apres: { supprimees } });
  res.json({ supprimees, message: supprimees.length ? `${supprimees.length} sauvegarde(s) supprimée(s).` : 'Aucune sauvegarde à supprimer.' });
});

module.exports = router;

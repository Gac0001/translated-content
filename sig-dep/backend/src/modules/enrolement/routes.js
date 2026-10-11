'use strict';
/**
 * Enrôlement des agents : création de leur compte à partir de la liste déclarative validée.
 *
 *  - Admin : tous les agents de la liste validée (en commençant par le Bureau Secrétariat de Direction) ;
 *  - membres du Bureau Secrétariat de Direction : agents des AUTRES structures uniquement ;
 *  - tout autre utilisateur : aucun accès.
 * Le formulaire est prérempli à partir de la fiche ; les informations complémentaires sont obligatoires.
 */
const express = require('express');
const crypto = require('crypto');
const multer = require('multer');
const bcrypt = require('bcrypt');
const { z } = require('zod');
const config = require('../../config/env');
const db = require('../../db/knex');
const { requirePerm } = require('../../middleware/auth');
const { audit } = require('../../services/audit');
const { notify } = require('../../services/notifications');
const liste = require('../../services/listeDeclarative');
const { sha256File, removeQuiet, IMAGES } = require('../../services/files');
const { temporaryPassword } = require('../../utils/password');
const { setRoles, usernameSchema } = require('../users/routes');
const { notFound, badRequest, forbidden, conflict } = require('../../utils/errors');
const { ROLE_LIBELLES } = require('../../constants');

const router = express.Router();
router.use(requirePerm('compte.enroler'));

const DOCS = ['application/pdf', ...IMAGES];
const EXT = { 'application/pdf': '.pdf', 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, config.uploadDir),
    filename: (req, file, cb) => cb(null, `${crypto.randomUUID()}${EXT[file.mimetype] || '.bin'}`),
  }),
  limits: { fileSize: config.maxUploadBytes, files: 2 },
  fileFilter: (req, file, cb) => {
    if (file.fieldname === 'photo' && !IMAGES.includes(file.mimetype)) return cb(badRequest('Photo : format JPEG, PNG ou WebP attendu.'));
    if (file.fieldname === 'commission' && !DOCS.includes(file.mimetype)) return cb(badRequest('Commission d’affectation : fichier PDF ou image attendu.'));
    if (!['photo', 'commission'].includes(file.fieldname)) return cb(badRequest('Fichier inattendu.'));
    return cb(null, true);
  },
}).fields([{ name: 'photo', maxCount: 1 }, { name: 'commission', maxCount: 1 }]);

/** L’agent (ou la structure choisie) relève-t-il de la portée de l’utilisateur ? */
function horsPortee(ctx, estSecretariat, autorise = false) {
  if (ctx.enrolement === 'SECRETARIAT_AUTORISE') {
    if (!estSecretariat) return 'L’Admin n’enrôle que les agents du Bureau Secrétariat de Direction : les autres comptes sont créés par le Secrétariat.';
    return autorise ? null : 'Le Directeur n’a pas autorisé l’enrôlement de cet agent par l’Admin.';
  }
  if (ctx.enrolement === 'HORS_SECRETARIAT') {
    return estSecretariat ? 'Les comptes des agents du Bureau Secrétariat de Direction sont créés par l’Admin.' : null;
  }
  return 'Vous n’êtes pas habilité à créer des comptes.';
}

function proposerUsername(a) {
  const base = `${(a.prenom || '').split(/\s+/)[0] || ''}.${a.nom || ''}`.toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9.]/g, '').replace(/^\.+|\.+$/g, '');
  return base.length >= 3 ? base : `agent.${String(a.matricule || '').toLowerCase().replace(/[^a-z0-9]/g, '')}`;
}

// ─── Recherche des candidats ────────────────────────────────────────────────
router.get('/candidats', async (req, res) => {
  const e = await liste.etat();
  const q = String(req.query.q || '').trim().toLowerCase();
  const rows = e.agents
    .filter((a) => !a.user_id)
    .filter((a) => !q || `${a.matricule} ${a.nom} ${a.postnom || ''} ${a.prenom || ''}`.toLowerCase().includes(q))
    .map((a) => {
      const portee = horsPortee(req.ctx, !!a.est_secretariat_direction, !!a.enrolement_autorise_at);
      const motif = !e.validation ? 'Liste déclarative non validée.' : a.ecart === 'AJOUTE' ? 'Ajouté après la validation : revalidation requise.' : a.ecart === 'MODIFIE' ? 'Modifié depuis la validation : revalidation requise.' : portee;
      return {
        agent_id: a.agent_id, matricule: a.matricule, nom: a.nom, postnom: a.postnom, prenom: a.prenom, grade: a.grade_code,
        structure: a.bureau_nom || a.division_nom || null, secretariat: !!a.est_secretariat_direction, poste: a.poste,
        enrolable: !motif, motif,
      };
    });
  const avecCompte = e.agents.filter((a) => a.user_id);
  res.json({
    statutListe: e.statut, validation: e.validation ? { valide_at: e.validation.valide_at, par: e.validation.valide_par_nom || e.validation.username } : null,
    portee: req.ctx.enrolement,
    candidats: rows,
    resume: {
      sansCompte: rows.length, enrolables: rows.filter((r) => r.enrolable).length,
      secretariatSansCompte: rows.filter((r) => r.secretariat).length,
      avecCompte: avecCompte.length,
    },
  });
});

const ACCENTS = 'ÀÂÄÉÈÊËÎÏÔÖÙÛÜÇàâäéèêëîïôöùûüç';
const SANS_ACCENTS = 'AAAEEEEIIOOUUUCaaaeeeeiioouuuc';

// ─── Identification d’un agent (matricule ou nom) ───────────────────────────
// Recherche dans toute la base pour expliquer pourquoi un agent n’est pas enrôlable
// (absent de la liste, liste à revalider, compte existant, hors portée).
router.get('/identifier', async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (q.length < 2) throw badRequest('Saisissez au moins 2 caractères (matricule ou nom).');
  const chiffres = q.replace(/\D/g, '');
  const mots = q.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').split(/\s+/).filter(Boolean);
  const rows = await db('agents as ag').whereNull('ag.archived_at').where('ag.est_autorite', false)
    .where((w) => {
      w.whereRaw('upper(ag.matricule) = upper(?)', [q]);
      if (chiffres.length >= 3) w.orWhereRaw(`regexp_replace(ag.matricule, '\\D', '', 'g') = ?`, [chiffres]);
      w.orWhere((x) => mots.forEach((m) => x.whereRaw(`lower(translate(concat_ws(' ', ag.nom, ag.postnom, ag.prenom), ?, ?)) like ?`, [ACCENTS, SANS_ACCENTS, `%${m}%`])));
    })
    .orderBy('ag.nom').limit(20).pluck('ag.id');
  const e = await liste.etat();
  const parId = new Map(e.agents.map((a) => [a.agent_id, a]));
  const autres = rows.filter((id) => !parId.has(id));
  const horsListe = autres.length ? await db('agents as ag').leftJoin('users as u', 'u.agent_id', 'ag.id').leftJoin('grades as g', 'g.id', 'ag.grade_id')
    .whereIn('ag.id', autres).select('ag.id as agent_id', 'ag.matricule', 'ag.nom', 'ag.postnom', 'ag.prenom', 'g.code as grade_code', 'u.username') : [];
  const resultats = [
    ...rows.filter((id) => parId.has(id)).map((id) => {
      const a = parId.get(id);
      let statut = 'ENROLABLE'; let motif = null;
      if (a.user_id) { statut = 'COMPTE_EXISTANT'; motif = `Cet agent possède déjà un compte (${a.username}).`; }
      else if (!e.validation) { statut = 'LISTE_NON_VALIDEE'; motif = 'La liste déclarative n’a pas encore été validée par le Directeur.'; }
      else if (a.ecart) { statut = 'A_REVALIDER'; motif = a.ecart === 'AJOUTE' ? 'Ajouté à la liste après sa validation : le Directeur doit la revalider.' : 'Matricule, grade ou affectation modifiés depuis la validation : le Directeur doit revalider la liste.'; }
      else { const p = horsPortee(req.ctx, !!a.est_secretariat_direction, !!a.enrolement_autorise_at); if (p) { statut = 'HORS_PORTEE'; motif = p; } }
      return { agent_id: a.agent_id, matricule: a.matricule, nom: a.nom, postnom: a.postnom, prenom: a.prenom, grade: a.grade_code, structure: a.bureau_nom || a.division_nom || null, surListe: true, statut, motif };
    }),
    ...horsListe.map((a) => ({
      agent_id: a.agent_id, matricule: a.matricule, nom: a.nom, postnom: a.postnom, prenom: a.prenom, grade: a.grade_code, structure: null, surListe: false,
      statut: a.username ? 'COMPTE_EXISTANT' : 'NON_INSCRIT',
      motif: a.username ? `Cet agent possède déjà un compte (${a.username}).` : 'Cet agent ne figure pas sur la liste déclarative de la Direction : le Directeur doit l’y inscrire puis la valider.',
    })),
  ];
  res.json({ q, resultats, statutListe: e.statut });
});

// ─── Préremplissage ─────────────────────────────────────────────────────────
async function chargerAgent(id) {
  const a = await db('agents as ag')
    .leftJoin('affectations as af', function j() { this.on('af.agent_id', 'ag.id').andOn('af.est_active', db.raw('true')); })
    .leftJoin('bureaux as b', 'b.id', 'af.bureau_id').leftJoin('divisions as d', 'd.id', 'af.division_id')
    .leftJoin('postes_organiques as p', 'p.id', 'af.poste_id').leftJoin('grades as g', 'g.id', 'ag.grade_id')
    .where('ag.id', id)
    .first('ag.*', 'af.id as affectation_id', 'af.niveau', 'af.division_id', 'af.bureau_id', 'af.date_debut as date_affectation',
      'b.nom as bureau_nom', 'b.est_secretariat_direction', 'd.nom as division_nom', 'p.libelle as poste', 'p.role_associe', 'g.code as grade_code', 'g.libelle as grade_libelle');
  if (!a) throw notFound('Agent introuvable.');
  return a;
}

router.get('/agents/:id', async (req, res) => {
  const id = Number(req.params.id);
  const a = await chargerAgent(id);
  const motif = await liste.motifNonEnrolable(id);
  const portee = horsPortee(req.ctx, !!a.est_secretariat_direction, !!a.enrolement_autorise_at);
  if (portee && a.affectation_id) throw forbidden(portee, 'HORS_PORTEE_ENROLEMENT');
  const [fonctions, divisions, bureaux] = await Promise.all([
    db('fonctions').where({ actif: true }).where('grade_id', a.grade_id || -1).orderBy('libelle'),
    db('divisions').where({ actif: true }).orderBy('ordre'),
    db('bureaux').where({ actif: true }).orderBy(['parent_type', 'ordre']),
  ]);
  res.json({
    agent: {
      id: a.id, matricule: a.matricule, nom: a.nom, postnom: a.postnom, prenom: a.prenom, sexe: a.sexe,
      date_naissance: a.date_naissance, lieu_naissance: a.lieu_naissance, date_mise_en_service: a.date_mise_en_service,
      numero_carte_igap: a.numero_carte_igap, telephone: a.telephone, email: a.email, adresse: a.adresse,
      grade_id: a.grade_id, grade_code: a.grade_code, grade_libelle: a.grade_libelle, fonction_id: a.fonction_id, has_photo: !!a.photo_path,
    },
    affectation: a.affectation_id ? {
      verrouillee: true, niveau: a.niveau, division_id: a.division_id, division_nom: a.est_secretariat_direction ? 'Aucune (rattaché au Directeur)' : a.division_nom,
      bureau_id: a.bureau_id, bureau_nom: a.bureau_nom, poste: a.poste, role: a.role_associe, date_affectation: a.date_affectation,
    } : null,
    usernamePropose: proposerUsername(a),
    fonctions: fonctions.map((f) => ({ id: f.id, libelle: f.libelle })),
    structures: {
      divisions: divisions.map((d) => ({ id: d.id, nom: d.nom })),
      bureaux: bureaux.filter((b) => !(req.ctx.enrolement === 'HORS_SECRETARIAT' && b.est_secretariat_direction)).map((b) => ({ id: b.id, nom: b.nom, division_id: b.division_id, rattachement: b.parent_type })),
    },
    enrolable: !motif && !portee, motif: motif || portee,
  });
});

// ─── Création du compte ─────────────────────────────────────────────────────
const dateSchema = z.string().date('date invalide');
const bodySchema = z.object({
  username: usernameSchema,
  sexe: z.enum(['M', 'F'], { message: 'sexe requis' }),
  date_naissance: dateSchema,
  lieu_naissance: z.string().trim().max(150).optional().transform((v) => v || null),
  date_mise_en_service: dateSchema,
  numero_carte_igap: z.string().trim().min(3, 'numéro de carte IGAP requis').max(60),
  fonction_id: z.coerce.number().int().positive({ message: 'fonction requise' }),
  telephone: z.string().trim().max(40).optional().transform((v) => v || null),
  email: z.union([z.email('adresse électronique invalide'), z.literal('')]).optional().transform((v) => v || null),
  adresse: z.string().trim().max(300).optional().transform((v) => v || null),
  division_id: z.coerce.number().int().positive().optional(),
  bureau_id: z.coerce.number().int().positive().optional(),
  role: z.enum(['AGENT', 'CHEF_BUREAU', 'CHEF_DIVISION']).optional(),
  date_affectation: dateSchema.optional(),
  identite_confirmee: z.literal('true', { message: 'confirmez l’identité de l’agent' }),
  affectation_confirmee: z.literal('true', { message: 'confirmez l’affectation de l’agent' }),
});

router.post('/agents/:id', (req, res, next) => upload(req, res, async (err) => {
  const fichiers = Object.values(req.files || {}).flat();
  const nettoyer = () => fichiers.forEach((f) => removeQuiet(f.filename));
  try {
    if (err) throw err;
    const id = Number(req.params.id);
    const b = bodySchema.parse(req.body || {});
    const photo = req.files?.photo?.[0];
    const commission = req.files?.commission?.[0];
    if (!photo) throw badRequest('La photo de l’agent est obligatoire.');
    if (!commission) throw badRequest('La commission d’affectation (PDF ou image) est obligatoire.');

    const a = await chargerAgent(id);
    const motif = await liste.motifNonEnrolable(id);
    if (motif) throw forbidden(motif, 'NON_ENROLABLE');

    // Affectation : reprise de la liste validée, ou choisie si l’agent n’en a pas.
    let structure = null;
    if (!a.affectation_id) {
      if (b.bureau_id) {
        const bur = await db('bureaux').where({ id: b.bureau_id, actif: true }).first();
        if (!bur) throw badRequest('Bureau inconnu.');
        structure = { type: 'BUREAU', bureau: bur, role: b.role === 'CHEF_BUREAU' ? 'CHEF_BUREAU' : 'AGENT' };
      } else if (b.division_id) {
        structure = { type: 'DIVISION', divisionId: b.division_id, role: 'CHEF_DIVISION' };
      } else throw badRequest('Choisissez la Division et le Bureau d’affectation.');
    }
    const estSecretariat = a.affectation_id ? !!a.est_secretariat_direction : !!(structure.bureau && structure.bureau.est_secretariat_direction);
    const portee = horsPortee(req.ctx, estSecretariat, !!a.enrolement_autorise_at);
    if (portee) throw forbidden(portee, 'HORS_PORTEE_ENROLEMENT');

    // Contrôles de cohérence
    const today = new Date().toISOString().slice(0, 10);
    const age = (d1, d2) => (new Date(d2) - new Date(d1)) / (365.25 * 86400000);
    if (b.date_naissance < '1940-01-01' || b.date_naissance > today) throw badRequest('Date de naissance invalide.');
    if (b.date_mise_en_service > today) throw badRequest('La date de mise en service ne peut pas être future.');
    if (age(b.date_naissance, b.date_mise_en_service) < 18) throw badRequest('La date de mise en service doit être postérieure aux 18 ans de l’agent.');
    if (!a.grade_id) throw badRequest('Le grade de l’agent n’est pas renseigné sur la liste déclarative : corrigez la liste avant l’enrôlement.');
    const fonction = await db('fonctions').where({ id: b.fonction_id, actif: true }).first();
    if (!fonction) throw badRequest('Fonction inconnue.');
    if (fonction.grade_id !== a.grade_id) throw badRequest(`La fonction « ${fonction.libelle} » ne correspond pas au grade de l’agent (${a.grade_libelle}).`);
    const igap = await db('agents').whereRaw('upper(numero_carte_igap) = upper(?)', [b.numero_carte_igap]).whereNot('id', id).first();
    if (igap) throw conflict('Ce numéro de carte IGAP est déjà attribué à un autre agent.');
    if (await db('users').where({ username: b.username }).first()) throw conflict('Ce nom d’utilisateur est déjà utilisé.');

    let poste = null; let role = a.role_associe;
    if (structure) {
      if (structure.type === 'BUREAU') {
        poste = await db('postes_organiques').where({ bureau_id: structure.bureau.id, role_associe: structure.role, actif: true }).first();
        role = structure.role;
      } else {
        if (a.grade_code !== 'CD') throw badRequest('Seul un agent de grade Chef de Division peut être affecté au niveau d’une Division.');
        poste = await db('postes_organiques').where({ division_id: structure.divisionId, niveau: 'DIVISION', role_associe: 'CHEF_DIVISION', actif: true }).first();
      }
      if (!poste) throw badRequest('Aucun poste organique correspondant dans la structure choisie.');
      if (role !== 'AGENT') {
        const q = db('affectations as af').join('postes_organiques as p', 'p.id', 'af.poste_id').where({ 'af.est_active': true, 'p.role_associe': role });
        if (structure.type === 'BUREAU') q.where('af.bureau_id', structure.bureau.id); else q.where('af.division_id', structure.divisionId).where('af.niveau', 'DIVISION');
        if (await q.first()) throw conflict('Cette structure a déjà un responsable en fonction.');
      }
    }
    if (!role || !['AGENT', 'CHEF_BUREAU', 'CHEF_DIVISION'].includes(role)) throw badRequest('Poste de l’agent indéterminé : vérifiez son affectation sur la liste déclarative.');

    const temp = temporaryPassword();
    const hash = await bcrypt.hash(temp, 12);
    const dep = await db('directions').where({ code: 'DEP' }).first();
    const user = await db.transaction(async (trx) => {
      const [att] = await trx('attachments').insert({
        entity_type: 'AGENT', entity_id: id, original_name: `Commission d’affectation — ${a.matricule}${EXT[commission.mimetype] || ''}`,
        stored_name: commission.filename, mime_type: commission.mimetype, size_bytes: commission.size, sha256: await sha256File(commission.path), uploaded_by: req.ctx.userId,
      }).returning('id');
      await trx('agents').where({ id }).update({
        sexe: b.sexe, date_naissance: b.date_naissance, lieu_naissance: b.lieu_naissance, date_mise_en_service: b.date_mise_en_service,
        numero_carte_igap: b.numero_carte_igap.toUpperCase(), fonction_id: fonction.id, telephone: b.telephone ?? a.telephone, email: b.email ?? a.email,
        adresse: b.adresse ?? a.adresse, photo_path: photo.filename, commission_attachment_id: att.id,
        enrole_at: trx.fn.now(), enrole_par: req.ctx.userId, updated_at: trx.fn.now(),
      });
      if (structure) {
        await trx('affectations').insert({
          agent_id: id, direction_id: dep.id, niveau: structure.type,
          bureau_id: structure.type === 'BUREAU' ? structure.bureau.id : null,
          division_id: structure.type === 'BUREAU' ? structure.bureau.division_id : structure.divisionId,
          poste_id: poste.id, date_debut: b.date_affectation || b.date_mise_en_service, motif: 'Affectation à l’enrôlement', created_by: req.ctx.userId,
        });
      }
      const [u] = await trx('users').insert({
        username: b.username, password_hash: hash, agent_id: id, statut: 'ACTIF', must_change_password: true,
        created_by: req.ctx.userId, autorise_par: req.ctx.userId, autorise_at: trx.fn.now(),
      }).returning('*');
      await setRoles(trx, u.id, [role], req.ctx.userId);
      return u;
    });
    if (a.photo_path) removeQuiet(a.photo_path);
    await audit(req, {
      action: 'CREATION', module: 'comptes', entite: 'user', entiteId: user.id,
      apres: { username: user.username, role, agent: a.matricule, igap: b.numero_carte_igap, affectation: structure ? 'choisie à l’enrôlement' : 'liste validée', identite_confirmee: true, affectation_confirmee: true },
      message: `Enrôlement de l’agent ${a.matricule} (${ROLE_LIBELLES[role]})`,
    });
    await notify(user.id, { type: 'COMPTE_CREE', titre: 'Votre compte SIG-DEP a été créé', message: 'Changez votre mot de passe temporaire à la première connexion.', lien: '/profil', expediteur: req.ctx.userId });
    return res.status(201).json({
      id: user.id, username: user.username, role, motDePasseTemporaire: temp,
      message: 'Compte créé. Communiquez le mot de passe temporaire de façon sécurisée : il devra être changé à la première connexion.',
    });
  } catch (e) {
    nettoyer();
    return next(e);
  }
}));

module.exports = router;

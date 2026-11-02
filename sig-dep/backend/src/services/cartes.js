'use strict';
/**
 * Cartes de service (cahier des charges, §§ 20 et 31).
 *
 * Circuit : préparation par le Bureau Secrétariat de Direction (contrôle du dossier) → vérification
 * → validation par le Directeur (numéro unique, jeton du QR code, renseignements et photo figés,
 * validité de 5 ans par défaut) → impression → remise et accusé de réception du titulaire.
 * Suivi : suspension, réactivation, annulation, perte, remplacement, renouvellement, expiration.
 *
 * Vérification publique par QR code ou par matricule : photo, nom complet, grade, fonction,
 * affectation et état de la carte, sans autre renseignement personnel.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('../db/knex');
const { nextReference } = require('./sequence');
const { notify } = require('./notifications');
const { directeursActifs, alerter } = require('./alertes');
const { aujourdhui } = require('./interims');
const { safePath } = require('./files');
const { badRequest, forbidden, notFound, conflict } = require('../utils/errors');

const EN_PREPARATION = ['BROUILLON', 'A_COMPLETER', 'VERIFIEE'];
const EN_CIRCULATION = ['VALIDEE', 'IMPRIMEE', 'REMISE', 'SUSPENDUE'];
const STATUTS_AGENT_EN_FONCTION = ['ACTIF', 'CONGE'];
const MOTIFS = { PREMIERE: 'Première délivrance', RENOUVELLEMENT: 'Renouvellement', REMPLACEMENT: 'Remplacement' };

const nomComplet = (a) => [a.prenom, a.nom, a.postnom].filter(Boolean).join(' ');

async function modeleActif(trx = db) {
  return trx('modeles_carte').where({ actif: true }).first();
}

/** Renseignements de l’agent tels qu’ils figureront sur la carte. */
async function dossierAgent(agentId, trx = db) {
  const a = await trx('agents as ag')
    .leftJoin('grades as g', 'g.id', 'ag.grade_id')
    .leftJoin('fonctions as f', 'f.id', 'ag.fonction_id')
    .leftJoin('affectations as af', function j() { this.on('af.agent_id', 'ag.id').andOn('af.est_active', db.raw('true')); })
    .leftJoin('bureaux as b', 'b.id', 'af.bureau_id')
    .leftJoin('divisions as d', 'd.id', 'af.division_id')
    .leftJoin('postes_organiques as p', 'p.id', 'af.poste_id')
    .where('ag.id', agentId)
    .first('ag.*', 'g.libelle as grade', 'f.libelle as fonction', 'af.id as affectation_id', 'af.niveau',
      'b.nom as bureau', 'd.nom as division', 'p.libelle as poste',
      db.raw('COALESCE(b.code_organique, d.code_organique) as code_organique'));
  if (!a) throw notFound('Agent introuvable.');
  const dep = await trx('directions').where({ code: 'DEP' }).first();
  const affectation = a.bureau ? (a.division ? `${a.bureau} — ${a.division}` : a.bureau) : a.division || (a.niveau === 'DIRECTION' ? dep.nom : null);
  return {
    agent: a,
    donnees: {
      matricule: a.matricule, nom: a.nom, postnom: a.postnom || null, prenom: a.prenom || null, nomComplet: nomComplet(a),
      grade: a.grade || null, fonction: a.fonction || a.poste || null, affectation, codeOrganique: a.code_organique || null, direction: dep.nom,
    },
  };
}

/** Anomalies bloquant la vérification ou la validation. */
function anomalies({ agent, donnees }) {
  const l = [];
  if (agent.est_autorite) l.push('Le Secrétaire Général ne reçoit pas de carte de service de la Direction.');
  if (agent.archived_at || !STATUTS_AGENT_EN_FONCTION.includes(agent.statut)) l.push(`Agent non en fonction (statut : ${agent.statut}).`);
  if (!agent.affectation_id) l.push('Aucune affectation active.');
  if (!donnees.grade) l.push('Grade non renseigné.');
  if (!donnees.fonction) l.push('Fonction non renseignée.');
  if (!agent.photo_path) l.push('Photo absente.');
  else if (!/\.(png|jpe?g)$/i.test(agent.photo_path)) l.push('Photo au format WebP : déposez une photo JPEG ou PNG pour l’impression.');
  else if (!fs.existsSync(safePath(agent.photo_path))) l.push('Fichier de la photo introuvable sur le serveur.');
  return l;
}

function vue(c) {
  return {
    ...c,
    motifLibelle: MOTIFS[c.motif_emission],
    titulaire: c.donnees ? c.donnees.nomComplet : nomComplet(c),
  };
}

function baseQuery(trx = db) {
  return trx('cartes_service as c').join('agents as ag', 'ag.id', 'c.agent_id')
    .leftJoin('users as up', 'up.id', 'c.prepare_par').leftJoin('users as uv', 'uv.id', 'c.valide_par')
    .select('c.*', 'ag.nom', 'ag.postnom', 'ag.prenom', 'ag.matricule', 'up.username as prepare_par_username', 'uv.username as valide_par_username');
}

/** Carte visible : registre (Directeur, Secrétariat) ou carte de l’agent lui-même. */
async function charger(ctx, id, trx = db) {
  const c = await baseQuery(trx).where('c.id', id).first();
  if (!c) throw notFound('Carte introuvable.');
  if (!ctx.can('cartes.consulter') && c.agent_id !== ctx.agentId) throw forbidden('Cette carte ne relève pas de votre périmètre.', 'HORS_PERIMETRE');
  return c;
}

/** Recalcule l’état d’une carte en préparation selon le dossier de l’agent. */
async function actualiser(c) {
  if (!['BROUILLON', 'A_COMPLETER'].includes(c.statut)) return c;
  const anom = anomalies(await dossierAgent(c.agent_id));
  const statut = anom.length ? 'A_COMPLETER' : 'BROUILLON';
  if (statut !== c.statut) await db('cartes_service').where({ id: c.id }).update({ statut, updated_at: db.fn.now() });
  return { ...c, statut };
}

// ─── Circuit ────────────────────────────────────────────────────────────────
async function preparer(ctx, { agent_id: agentId, motif_emission: motif = 'PREMIERE' }) {
  const dossier = await dossierAgent(agentId);
  if (dossier.agent.est_autorite) throw badRequest('Le Secrétaire Général ne reçoit pas de carte de service de la Direction.');
  if (await db('cartes_service').where({ agent_id: agentId }).whereIn('statut', EN_PREPARATION).first()) throw conflict('Une carte est déjà en préparation pour cet agent.');
  const enCirculation = await db('cartes_service').where({ agent_id: agentId }).whereIn('statut', EN_CIRCULATION).first();
  if (enCirculation && motif === 'PREMIERE') throw conflict(`Cet agent a déjà une carte en circulation (${enCirculation.numero}) : préparez un renouvellement ou un remplacement.`);
  if (!enCirculation && motif !== 'PREMIERE' && !(await db('cartes_service').where({ agent_id: agentId }).whereNotNull('numero').first())) {
    throw badRequest('Aucune carte antérieure : il s’agit d’une première délivrance.');
  }
  const modele = await modeleActif();
  if (!modele) throw badRequest('Aucun modèle de carte actif : l’Admin Système doit en configurer un.');
  const [c] = await db('cartes_service').insert({
    agent_id: agentId, modele_id: modele.id, motif_emission: motif, remplace_carte_id: enCirculation ? enCirculation.id : null,
    statut: anomalies(dossier).length ? 'A_COMPLETER' : 'BROUILLON', prepare_par: ctx.userId,
  }).returning('*');
  return c;
}

async function verifier(ctx, id) {
  const c = await actualiser(await charger(ctx, id));
  if (c.statut === 'A_COMPLETER') throw badRequest('Le dossier de l’agent est incomplet : corrigez les anomalies signalées.');
  if (c.statut !== 'BROUILLON') throw badRequest('Seule une carte en préparation peut être vérifiée.');
  await db('cartes_service').where({ id }).update({ statut: 'VERIFIEE', verifie_par: ctx.userId, verifie_at: db.fn.now(), commentaire: null, updated_at: db.fn.now() });
  await notify(await directeursActifs(), { type: 'CARTE', titre: `Carte de service à valider : ${nomComplet(c)}`, message: MOTIFS[c.motif_emission], lien: `/cartes/${id}`, expediteur: ctx.userId });
  return charger(ctx, id);
}

async function retourner(ctx, id, commentaire) {
  const c = await charger(ctx, id);
  if (c.statut !== 'VERIFIEE') throw badRequest('Seule une carte vérifiée peut être retournée.');
  await db('cartes_service').where({ id }).update({ statut: 'BROUILLON', commentaire, updated_at: db.fn.now() });
  await notify(c.prepare_par, { type: 'CARTE', titre: `Carte retournée pour correction : ${nomComplet(c)}`, message: commentaire, lien: `/cartes/${id}`, expediteur: ctx.userId });
  return actualiser(await charger(ctx, id));
}

/** Copie de la photo figée avec la carte : une nouvelle photo de l’agent ne modifie pas la carte délivrée. */
function figerPhoto(photoPath) {
  const ext = path.extname(photoPath).toLowerCase();
  const nom = `carte-${crypto.randomUUID()}${ext}`;
  fs.copyFileSync(safePath(photoPath), safePath(nom));
  return nom;
}

function ajouterAnnees(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y + n, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() - 1); // valable jusqu’à la veille de l’anniversaire
  return dt.toISOString().slice(0, 10);
}

/**
 * Code de vérification de la carte : 20 chiffres aléatoires (environ 66 bits), porté à la fois par
 * le QR code (dans le lien de vérification) et par le code à barres (Code 128 C, lisible à l’impression).
 */
function nouveauJeton() {
  return Array.from({ length: 20 }, () => crypto.randomInt(10)).join('');
}

async function valider(ctx, id) {
  const c = await charger(ctx, id);
  if (c.statut !== 'VERIFIEE') throw badRequest('Seule une carte vérifiée peut être validée.');
  // Le Directeur titulaire valide lui-même sa carte ; tout autre validateur (intérimaire) ne le peut pas.
  const directeurTitulaire = ctx.rolesPermanents?.includes('DIRECTEUR') && !ctx.interim;
  if (ctx.agentId && c.agent_id === ctx.agentId && !directeurTitulaire) throw forbidden('Vous ne pouvez pas valider votre propre carte de service.', 'CONFLIT_INTERET');
  const dossier = await dossierAgent(c.agent_id);
  const anom = anomalies(dossier);
  if (anom.length) throw badRequest(`Dossier incomplet : ${anom.join(' ')}`);
  const modele = await db('modeles_carte').where({ id: c.modele_id }).first();
  const specimen = await db('specimens_signature').where({ user_id: ctx.userId, actif: true }).first();
  const photo = figerPhoto(dossier.agent.photo_path);
  const delivrance = aujourdhui();
  try {
    await db.transaction(async (trx) => {
      // La carte remplacée ou renouvelée cesse d’être valable à la validation de la nouvelle.
      if (c.remplace_carte_id) {
        await trx('cartes_service').where({ id: c.remplace_carte_id }).whereIn('statut', EN_CIRCULATION)
          .update({ statut: 'REMPLACEE', motif: `Remplacée par une nouvelle carte (${MOTIFS[c.motif_emission].toLowerCase()})`, updated_at: trx.fn.now() });
      }
      await trx('cartes_service').where({ id }).update({
        statut: 'VALIDEE', numero: await nextReference('CARTE', 'DEP/CS', trx), jeton: nouveauJeton(),
        donnees: JSON.stringify(dossier.donnees), photo, date_delivrance: delivrance, date_expiration: ajouterAnnees(delivrance, modele.validite_annees),
        valide_par: ctx.userId, valide_at: trx.fn.now(), specimen_id: specimen ? specimen.id : null, updated_at: trx.fn.now(),
      });
    });
  } catch (e) {
    try { fs.unlinkSync(safePath(photo)); } catch (x) { /* ignore */ }
    throw e;
  }
  const v = await charger(ctx, id);
  await notify([c.prepare_par, ...await db('users').where({ agent_id: c.agent_id }).pluck('id')], {
    type: 'CARTE', titre: `Carte de service validée : ${v.numero}`, message: `${v.donnees.nomComplet} — valable jusqu’au ${v.date_expiration.split('-').reverse().join('/')}`, lien: `/cartes/${id}`, expediteur: ctx.userId,
  });
  return v;
}

/** Impression (ou réimpression) : uniquement des cartes validées et en circulation. */
async function marquerImpression(ctx, ids) {
  const cartes = await db('cartes_service').whereIn('id', ids);
  if (cartes.length !== ids.length) throw notFound('Carte introuvable.');
  const non = cartes.filter((c) => !['VALIDEE', 'IMPRIMEE', 'REMISE'].includes(c.statut));
  if (non.length) throw badRequest('Seules les cartes validées et en circulation peuvent être imprimées.');
  await db('cartes_service').whereIn('id', ids).update({ nb_impressions: db.raw('nb_impressions + 1'), imprime_at: db.raw('COALESCE(imprime_at, now())'), updated_at: db.fn.now() });
  await db('cartes_service').whereIn('id', ids).where({ statut: 'VALIDEE' }).update({ statut: 'IMPRIMEE' });
  return db('cartes_service').whereIn('id', ids).orderBy('id');
}

async function remettre(ctx, id) {
  const c = await charger(ctx, id);
  if (c.statut !== 'IMPRIMEE') throw badRequest('Seule une carte imprimée peut être remise.');
  await db('cartes_service').where({ id }).update({ statut: 'REMISE', remise_at: db.fn.now(), remise_par: ctx.userId, updated_at: db.fn.now() });
  await notify(await db('users').where({ agent_id: c.agent_id }).pluck('id'), { type: 'CARTE', titre: 'Carte de service remise', message: 'Confirmez la réception de votre carte de service.', lien: '/ma-carte', expediteur: ctx.userId });
  return charger(ctx, id);
}

/** Accusé de réception par le titulaire lui-même. */
async function accuserReception(ctx) {
  const c = await db('cartes_service').where({ agent_id: ctx.agentId || -1, statut: 'REMISE' }).whereNull('accuse_at').first();
  if (!c) throw badRequest('Aucune carte remise en attente de votre accusé de réception.');
  await db('cartes_service').where({ id: c.id }).update({ accuse_at: db.fn.now(), updated_at: db.fn.now() });
  return c;
}

async function changerStatut(ctx, id, action, motif) {
  const c = await charger(ctx, id);
  const transitions = {
    suspendre: { de: ['VALIDEE', 'IMPRIMEE', 'REMISE'], vers: 'SUSPENDUE', perm: 'cartes.valider' },
    reactiver: { de: ['SUSPENDUE'], vers: c.remise_at ? 'REMISE' : c.imprime_at ? 'IMPRIMEE' : 'VALIDEE', perm: 'cartes.valider' },
    annuler: { de: [...EN_PREPARATION, ...EN_CIRCULATION], vers: 'ANNULEE', perm: 'cartes.valider' },
    perdue: { de: ['VALIDEE', 'IMPRIMEE', 'REMISE', 'SUSPENDUE'], vers: 'PERDUE', perm: 'cartes.preparer' },
  };
  const t = transitions[action];
  const titulaire = ctx.agentId && c.agent_id === ctx.agentId;
  // Le titulaire peut lui-même déclarer la perte (ou le vol) de sa carte.
  if (!ctx.can(t.perm) && !(action === 'perdue' && titulaire)) throw forbidden();
  if (!t.de.includes(c.statut)) throw badRequest('Opération impossible dans l’état actuel de la carte.');
  if (action !== 'reactiver' && (!motif || motif.trim().length < 5)) throw badRequest('Motif requis.');
  await db('cartes_service').where({ id }).update({ statut: t.vers, motif: action === 'reactiver' ? null : motif, updated_at: db.fn.now() });
  if (action === 'perdue') {
    await notify([...await directeursActifs(), c.prepare_par], { type: 'CARTE', titre: `Carte de service déclarée perdue : ${c.numero}`, message: `${nomComplet(c)} — ${motif}. Préparez un remplacement.`, lien: `/cartes/${id}`, expediteur: ctx.userId });
  }
  return charger(ctx, id);
}

/** Expiration des cartes échues (tâche planifiée). */
async function expirer() {
  return db('cartes_service').whereIn('statut', EN_CIRCULATION).where('date_expiration', '<', aujourdhui())
    .update({ statut: 'EXPIREE', updated_at: db.fn.now() });
}

// ─── Vérification publique ──────────────────────────────────────────────────
const VERDICTS = {
  VALIDE: 'Carte valide',
  EXPIREE: 'Carte expirée',
  SUSPENDUE: 'Carte suspendue',
  ANNULEE: 'Carte annulée',
  PERDUE: 'Carte déclarée perdue ou volée : à retenir',
  REMPLACEE: 'Carte remplacée par une carte plus récente',
  NON_EN_FONCTION: 'Le titulaire n’est plus en fonction à la Direction',
  INCONNUE: 'Aucune carte de service correspondante',
};

function verdict(c, agent) {
  if (!c) return 'INCONNUE';
  if (['SUSPENDUE', 'ANNULEE', 'PERDUE', 'REMPLACEE'].includes(c.statut)) return c.statut;
  if (c.statut === 'EXPIREE' || String(c.date_expiration) < aujourdhui()) return 'EXPIREE';
  if (agent.archived_at || !STATUTS_AGENT_EN_FONCTION.includes(agent.statut)) return 'NON_EN_FONCTION';
  return 'VALIDE';
}

function photoDataUrl(nom) {
  try {
    const ext = path.extname(nom).toLowerCase();
    return `data:${ext === '.png' ? 'image/png' : 'image/jpeg'};base64,${fs.readFileSync(safePath(nom)).toString('base64')}`;
  } catch (e) { return null; }
}

/** Vérifie une carte par son jeton (QR code) ou par le matricule du titulaire. Journalisé. */
async function verificationPublique({ jeton, matricule }, { ip, userAgent }) {
  let c = null;
  if (jeton) {
    c = await db('cartes_service').where({ jeton }).whereNotNull('numero').first();
  } else if (matricule) {
    const m = String(matricule).replace(/[\s.\-/]/g, '').toUpperCase();
    const agent = await db('agents').whereRaw("upper(regexp_replace(matricule, '[\\s.\\-/]', '', 'g')) = ?", [m]).first('id');
    if (agent) {
      // Carte en circulation, sinon la plus récente délivrée.
      c = await db('cartes_service').where({ agent_id: agent.id }).whereIn('statut', EN_CIRCULATION).first()
        || await db('cartes_service').where({ agent_id: agent.id }).whereNotNull('numero').orderBy('valide_at', 'desc').first();
    }
  }
  const agent = c ? await db('agents').where({ id: c.agent_id }).first() : null;
  const v = verdict(c, agent);
  await db('verifications_carte').insert({ mode: jeton ? 'QR' : 'MATRICULE', carte_id: c ? c.id : null, resultat: v, ip, user_agent: String(userAgent || '').slice(0, 300) });
  // Recherches infructueuses répétées par matricule depuis une même adresse : tentative d’énumération.
  if (v === 'INCONNUE' && matricule) {
    const echecs = await db('verifications_carte').where({ ip, mode: 'MATRICULE', resultat: 'INCONNUE' }).where('created_at', '>', db.raw(`now() - interval '15 minutes'`)).count('* as n').first();
    if (Number(echecs.n) >= 10) {
      await alerter({ type: 'VERIFICATION_CARTES', gravite: 'ATTENTION', titre: 'Vérifications de cartes par matricule répétées sans résultat', message: `${echecs.n} recherches infructueuses en 15 minutes depuis ${ip}.`, ip, unique: 60 });
    }
  }
  if (!c) return { verdict: v, libelle: VERDICTS[v] };
  const d = c.donnees;
  return {
    verdict: v,
    libelle: VERDICTS[v],
    valide: v === 'VALIDE',
    carte: { numero: c.numero, dateDelivrance: c.date_delivrance, dateExpiration: c.date_expiration },
    titulaire: { photo: photoDataUrl(c.photo), nomComplet: d.nomComplet, grade: d.grade, fonction: d.fonction, affectation: d.affectation },
    emetteur: d.direction,
  };
}

module.exports = {
  EN_PREPARATION, EN_CIRCULATION, MOTIFS, VERDICTS, modeleActif, dossierAgent, anomalies, vue, baseQuery, charger, actualiser,
  preparer, verifier, retourner, valider, marquerImpression, remettre, accuserReception, changerStatut, expirer, verificationPublique, ajouterAnnees, nomComplet,
};

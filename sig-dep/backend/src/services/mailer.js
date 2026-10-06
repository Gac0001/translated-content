'use strict';
/**
 * Notifications par e-mail.
 *
 *  - Les e-mails sont d’abord placés dans une file durable (table email_outbox), dans la même
 *    transaction que la notification interne : aucun message n’est perdu si le serveur SMTP
 *    est momentanément indisponible.
 *  - Un traitement périodique (services/jobs.js) envoie la file, avec réessais espacés
 *    (1, 5, 15, 60 puis 240 minutes) avant de marquer l’envoi en échec.
 *  - Les éléments confidentiels ne sont jamais décrits dans l’e-mail ; aucun mot de passe
 *    n’est jamais envoyé.
 */
const nodemailer = require('nodemailer');
const db = require('../db/knex');
const config = require('../config/env');
const { DEP_NOM, SG_NOM, PAYS } = require('../constants');

/** Types de notification pouvant donner lieu à un e-mail (libellés affichés dans les préférences). */
const EMAIL_TYPES = {
  INSTRUCTION: 'Nouvelle instruction ou suite donnée',
  INSTRUCTION_REPONSE: 'Compte rendu d’une instruction émise',
  TACHE: 'Tâche attribuée, validée ou retournée',
  COURRIER: 'Transmission de courrier',
  DOCUMENT_A_EXAMINER: 'Document à examiner',
  DOCUMENT_RETOURNE: 'Document retourné pour correction',
  DOCUMENT_VALIDE: 'Document validé',
  ECHEANCE: 'Échéance proche',
  RETARD: 'Tâche ou instruction en retard',
  PRESENCE: 'Liste de présence soumise',
  PIP: 'Fiche PIP à traiter',
  AFFECTATION: 'Changement d’affectation',
  COMPTE_CREE: 'Compte créé ou activé',
  MDP_REINITIALISE: 'Mot de passe réinitialisé',
  SECURITE: 'Alerte de sécurité',
  SYSTEME: 'Annonce de l’administration du système',
  ACTE: 'Acte administratif (intérim, désignation…)',
  CARTE: 'Carte de service',
  CONNEXION: 'Connexion depuis un nouvel appareil',
  DEMANDE_INFO: 'Demande d’information du Secrétaire Général ou réponse du Directeur',
  REUNION: 'Convocation, report, rappel ou compte rendu de réunion',
  DECISION: 'Décision à exécuter ou suivi d’une décision',
  AGENDA: 'Agenda du Directeur (rendez-vous et rappels)',
  PTBA: 'PTBA à vérifier, consolider, valider ou corriger',
};

const RETRY_MINUTES = [1, 5, 15, 60, 240];

let transporter = null;
function getTransport() {
  if (transporter) return transporter;
  const m = config.mail;
  if (m.transport === 'json') transporter = nodemailer.createTransport({ jsonTransport: true });
  else if (m.transport === 'log') transporter = nodemailer.createTransport({ streamTransport: true, buffer: true });
  else {
    transporter = nodemailer.createTransport({
      host: m.host, port: m.port, secure: m.secure,
      auth: m.user ? { user: m.user, pass: m.pass } : undefined,
      tls: { rejectUnauthorized: m.rejectUnauthorized },
      connectionTimeout: 15000, greetingTimeout: 10000, socketTimeout: 30000,
    });
  }
  return transporter;
}

/** Réinitialise le transport (après modification de la configuration, ou dans les tests). */
function resetTransport() { transporter = null; }

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** Construit le sujet et les corps texte / HTML d’un e-mail institutionnel. */
function render({ titre, message, lien, destinataire, confidentiel = false }) {
  const url = lien ? `${config.mail.appUrl}${lien.startsWith('/') ? lien : `/${lien}`}` : config.mail.appUrl;
  const corps = confidentiel
    ? 'Un élément confidentiel vous a été adressé. Pour des raisons de sécurité, son contenu n’est pas repris dans ce message : connectez-vous au SIG-DEP pour le consulter.'
    : (message || '');
  const titreAffiche = confidentiel ? 'Élément confidentiel à consulter' : titre;
  const subject = `[SIG-DEP] ${titreAffiche}`.slice(0, 300);
  const salutation = destinataire ? `Bonjour ${destinataire},` : 'Bonjour,';
  const text = [
    `${PAYS} — ${SG_NOM}`, DEP_NOM, '',
    salutation, '', titreAffiche, corps ? `\n${corps}` : '', '',
    `Consulter dans le SIG-DEP : ${url}`, '',
    '—', 'Message automatique du SIG-DEP. Merci de ne pas y répondre.',
    'Vous pouvez gérer vos préférences de notification depuis votre profil.',
  ].join('\n');
  const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;background:#f1f5f9;font-family:Segoe UI,Arial,sans-serif;color:#1e293b">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden">
<tr><td style="height:4px;background:#007fff;font-size:0;line-height:0">&nbsp;</td></tr>
<tr><td style="height:2px;background:#f7d618;font-size:0;line-height:0">&nbsp;</td></tr>
<tr><td style="height:2px;background:#ce1021;font-size:0;line-height:0">&nbsp;</td></tr>
<tr><td style="padding:18px 24px 8px;text-align:center">
  <div style="font-size:12px;font-weight:bold;color:#0b3d6e;letter-spacing:.5px">${esc(PAYS.toUpperCase())}</div>
  <div style="font-size:11px;color:#334155">${esc(SG_NOM.toUpperCase())}</div>
  <div style="font-size:12px;font-weight:bold;color:#0b3d6e">${esc(DEP_NOM.toUpperCase())} (DEP)</div>
</td></tr>
<tr><td style="padding:8px 24px 24px">
  <p style="margin:16px 0 8px;font-size:14px">${esc(salutation)}</p>
  <h1 style="margin:8px 0 12px;font-size:18px;color:#0b3d6e">${esc(titreAffiche)}</h1>
  ${corps ? `<p style="margin:0 0 16px;font-size:14px;line-height:1.5;white-space:pre-line">${esc(corps)}</p>` : ''}
  <p style="margin:20px 0"><a href="${esc(url)}" style="display:inline-block;background:#0b3d6e;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:6px;font-size:14px;font-weight:bold">Ouvrir dans le SIG-DEP</a></p>
  <p style="margin:0;font-size:12px;color:#64748b">Si le bouton ne fonctionne pas, copiez ce lien : ${esc(url)}</p>
</td></tr>
<tr><td style="padding:12px 24px;background:#f8fafc;border-top:1px solid #e2e8f0;font-size:11px;color:#64748b">
  Message automatique du SIG-DEP — ${esc(DEP_NOM)}. Merci de ne pas y répondre.<br>Vous pouvez gérer vos préférences de notification depuis votre profil.
</td></tr></table></td></tr></table></body></html>`;
  return { subject, text, html };
}

/**
 * Place en file les e-mails correspondant à des notifications internes déjà enregistrées.
 * rows : lignes de la table notifications (avec id, user_id, type, titre, message, lien).
 */
async function enqueueForNotifications(rows, { confidentiel = false } = {}, trx = db) {
  if (!config.mail.enabled || !rows.length) return 0;
  const candidats = rows.filter((r) => EMAIL_TYPES[r.type]);
  if (!candidats.length) return 0;
  const ids = [...new Set(candidats.map((r) => r.user_id))];
  const dest = await trx('users as u')
    .leftJoin('agents as a', 'a.id', 'u.agent_id')
    .leftJoin('notification_preferences as p', 'p.user_id', 'u.id')
    .whereIn('u.id', ids).where('u.statut', 'ACTIF')
    // Adresse de l’agent, à défaut l’adresse de récupération du compte (Admin Système)
    .whereRaw(`coalesce(nullif(a.email, ''), u.email_recuperation) is not null`)
    .select('u.id', db.raw(`coalesce(nullif(a.email, ''), u.email_recuperation) as email`), 'a.prenom', 'a.nom', 'p.email_actif', 'p.types_desactives');
  const byId = Object.fromEntries(dest.map((d) => [d.id, d]));
  const out = [];
  for (const n of candidats) {
    const d = byId[n.user_id];
    if (!d) continue; // pas d’adresse électronique, ou compte inactif
    if (d.email_actif === false) continue;
    if (Array.isArray(d.types_desactives) && d.types_desactives.includes(n.type)) continue;
    const m = render({ titre: n.titre, message: n.message, lien: n.lien, destinataire: [d.prenom, d.nom].filter(Boolean).join(' '), confidentiel });
    out.push({ notification_id: n.id, user_id: d.id, type: n.type, to_email: d.email, subject: m.subject, text_body: m.text, html_body: m.html });
  }
  if (out.length) await trx('email_outbox').insert(out);
  return out.length;
}

async function sendOne(row) {
  const info = await getTransport().sendMail({
    from: config.mail.from, to: row.to_email, subject: row.subject, text: row.text_body, html: row.html_body,
    headers: { 'Auto-Submitted': 'auto-generated', 'X-Auto-Response-Suppress': 'All' },
  });
  if (config.mail.transport === 'log') console.log(`[MAIL] → ${row.to_email} : ${row.subject}`);
  return info;
}

/** Envoie les e-mails en attente (verrouillage de lignes : plusieurs instances d’API possibles). */
async function processOutbox(limit = 25) {
  if (!config.mail.enabled) return { envoyes: 0, echecs: 0 };
  let envoyes = 0; let echecs = 0;
  const batch = await db.transaction(async (trx) => {
    const rows = await trx('email_outbox').where('statut', 'EN_ATTENTE').where('prochain_essai', '<=', trx.fn.now())
      .orderBy('id').limit(limit).forUpdate().skipLocked();
    if (rows.length) {
      // Report provisoire : si le processus s’arrête pendant l’envoi, la ligne sera reprise plus tard
      await trx('email_outbox').whereIn('id', rows.map((r) => r.id)).update({ prochain_essai: trx.raw(`now() + interval '10 minutes'`) });
    }
    return rows;
  });
  for (const row of batch) {
    try {
      await sendOne(row);
      await db('email_outbox').where({ id: row.id }).update({ statut: 'ENVOYE', sent_at: db.fn.now(), tentatives: row.tentatives + 1, derniere_erreur: null });
      envoyes += 1;
    } catch (e) {
      const tentatives = row.tentatives + 1;
      const final = tentatives >= config.mail.maxAttempts;
      const delai = RETRY_MINUTES[Math.min(tentatives - 1, RETRY_MINUTES.length - 1)];
      await db('email_outbox').where({ id: row.id }).update({
        tentatives, derniere_erreur: String(e.message || e).slice(0, 1000), statut: final ? 'ECHEC' : 'EN_ATTENTE',
        prochain_essai: db.raw(`now() + make_interval(mins => ?)`, [delai]),
      });
      echecs += 1;
    }
  }
  return { envoyes, echecs };
}

/**
 * E-mail de sécurité adressé directement (code de vérification, alerte) : envoi immédiat,
 * mis en file en cas d’échec. Retourne false si la messagerie est désactivée.
 */
async function envoyerDirect({ to, userId = null, type = 'SECURITE', titre, message, lien = '/' }) {
  if (!config.mail.enabled || !to) return false;
  const m = render({ titre, message, lien });
  const row = { user_id: userId, type, to_email: to, subject: m.subject, text_body: m.text, html_body: m.html };
  try {
    await sendOne(row);
    await db('email_outbox').insert({ ...row, statut: 'ENVOYE', sent_at: db.fn.now(), tentatives: 1 });
  } catch (e) {
    await db('email_outbox').insert({ ...row, derniere_erreur: String(e.message || e).slice(0, 1000) });
  }
  return true;
}

/** Envoi immédiat d’un e-mail de test (hors file), utilisé par l’administration. */
async function sendTest(to) {
  const m = render({ titre: 'E-mail de test du SIG-DEP', message: 'Ce message confirme que la configuration de la messagerie du SIG-DEP fonctionne.', lien: '/' });
  return sendOne({ to_email: to, subject: m.subject, text_body: m.text, html_body: m.html });
}

async function verifyConnection() {
  if (config.mail.transport !== 'smtp') return { ok: true, message: `Transport « ${config.mail.transport} » (aucune connexion réseau).` };
  try {
    await getTransport().verify();
    return { ok: true, message: 'Connexion au serveur SMTP réussie.' };
  } catch (e) {
    return { ok: false, message: `Connexion au serveur SMTP impossible : ${e.message}` };
  }
}

module.exports = { EMAIL_TYPES, envoyerDirect, render, enqueueForNotifications, processOutbox, sendTest, verifyConnection, resetTransport, esc };

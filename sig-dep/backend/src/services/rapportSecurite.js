'use strict';
/**
 * Rapport mensuel de sécurité : indicateurs du mois (connexions, comptes, rôles,
 * réinitialisations, incidents, sauvegardes, intégrité de l’audit). Les données sont
 * figées en base à la génération ; le PDF est produit à la demande à partir de ces données.
 * Destinataires : Admin Système et Directeur.
 */
const db = require('../db/knex');
const pdf = require('./pdf');
const { notify } = require('./notifications');
const { adminsActifs, directeursActifs } = require('./alertes');
const { verifier } = require('./auditIntegrite');
const { politique } = require('./politique');
const { audit } = require('./audit');

const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const libellePeriode = (p) => { const [a, m] = p.split('-').map(Number); return `${MOIS[m - 1]} ${a}`; };

/** Période AAAA-MM du mois précédent (fuseau de Kinshasa). */
function moisPrecedent(d = new Date()) {
  const k = new Date(d.toLocaleString('en-US', { timeZone: 'Africa/Kinshasa' }));
  k.setDate(1); k.setMonth(k.getMonth() - 1);
  return `${k.getFullYear()}-${String(k.getMonth() + 1).padStart(2, '0')}`;
}

function bornes(periode) {
  const [a, m] = periode.split('-').map(Number);
  // Bornes exprimées à l’heure de Kinshasa (UTC+1)
  return { debut: `${periode}-01T00:00:00+01:00`, fin: `${m === 12 ? a + 1 : a}-${String(m === 12 ? 1 : m + 1).padStart(2, '0')}-01T00:00:00+01:00` };
}

async function calculer(periode) {
  const { debut, fin } = bornes(periode);
  const dans = (q, col = 'created_at') => q.where(col, '>=', debut).where(col, '<', fin);
  const n = async (q) => Number((await q.count('* as n').first()).n);
  const p = await politique();
  const [succes, echecs, comptesEchecs, ips, verrouillages, blocages, roles, mdp, recup, alertes, alertesTypes, sauvegardes, echecsSauvegarde, inactifs, nouveaux, desactivations, erreurs] = await Promise.all([
    n(dans(db('login_history')).where('succes', true)),
    n(dans(db('login_history')).where('succes', false)),
    dans(db('login_history')).where('succes', false).countDistinct('username as n').first(),
    dans(db('login_history')).where('succes', false).select('ip').count('* as echecs').countDistinct('username as comptes').groupBy('ip').orderBy('echecs', 'desc').limit(5),
    n(dans(db('audit_logs')).where({ action: 'VERROUILLAGE' })),
    n(dans(db('audit_logs')).where({ action: 'BLOCAGE' })),
    dans(db('audit_logs')).where({ action: 'CHANGEMENT_ROLE' }).select('username', 'entite', 'entite_id', 'message', 'created_at').orderBy('created_at'),
    n(dans(db('audit_logs')).whereIn('action', ['REINITIALISATION_MDP', 'CHANGEMENT_MDP_IMPOSE'])),
    n(dans(db('audit_logs')).where({ action: 'CHANGEMENT_MDP', message: 'Mot de passe réinitialisé par récupération' })),
    dans(db('alertes_securite')).select('gravite').count('* as n').groupBy('gravite'),
    dans(db('alertes_securite')).select('type', 'gravite').count('* as n').groupBy('type', 'gravite').orderBy('n', 'desc'),
    n(dans(db('sauvegardes')).where({ statut: 'REUSSIE' })),
    n(dans(db('sauvegardes')).where({ statut: 'ECHEC' })),
    n(db('users').whereNot('statut', 'DESACTIVE').whereRaw('coalesce(last_login_at, created_at) < ?::timestamptz - make_interval(days => ?)', [fin, p.inactivite_compte_jours])),
    n(dans(db('audit_logs')).where({ module: 'comptes', action: 'CREATION' })),
    n(dans(db('audit_logs')).where({ action: 'DESACTIVATION' })),
    n(dans(db('erreurs_techniques'), 'derniere_at')),
  ]);
  const integrite = await verifier();
  const derniereSauvegarde = await db('sauvegardes').where({ statut: 'REUSSIE' }).where('created_at', '<', fin).orderBy('created_at', 'desc').first('created_at', 'fichier');
  const parGravite = Object.fromEntries(alertes.map((r) => [r.gravite, Number(r.n)]));
  return {
    periode, libelle: libellePeriode(periode),
    connexions: { reussies: succes, echecs, comptesVises: Number(comptesEchecs.n), ipsSuspectes: ips.map((r) => ({ ip: r.ip, echecs: Number(r.echecs), comptes: Number(r.comptes) })) },
    comptes: { verrouillagesAutomatiques: verrouillages, blocagesAdmin: blocages, inactifsFinDeMois: inactifs, crees: nouveaux, desactives: desactivations },
    roles: roles.map((r) => ({ date: r.created_at, par: r.username, compte: `${r.entite} ${r.entite_id || ''}`.trim(), detail: r.message })),
    reinitialisations: { parAdmin: mdp, parRecuperation: recup },
    incidents: { critiques: parGravite.CRITIQUE || 0, attention: parGravite.ATTENTION || 0, info: parGravite.INFO || 0, parType: alertesTypes.map((r) => ({ type: r.type, gravite: r.gravite, nombre: Number(r.n) })) },
    sauvegardes: { reussies: sauvegardes, echecs: echecsSauvegarde, derniere: derniereSauvegarde ? derniereSauvegarde.created_at : null },
    erreursTechniques: erreurs,
    integriteAudit: { integre: integrite.integre, entrees: integrite.entrees, problemes: integrite.problemes.length },
  };
}

/** Calcule, enregistre (remplace) et diffuse le rapport d’une période. */
async function generer(periode, req = null) {
  const donnees = await calculer(periode);
  const ctx = req && req.ctx;
  await db('rapports_securite').insert({ periode, donnees: JSON.stringify(donnees), genere_par: ctx ? ctx.userId : null, genere_par_username: ctx ? ctx.username : 'système', genere_at: db.fn.now() })
    .onConflict('periode').merge(['donnees', 'genere_par', 'genere_par_username', 'genere_at']);
  await audit(req, { action: 'RAPPORT_SECURITE', module: 'securite', entite: 'rapport', entiteId: periode, message: `Rapport mensuel de sécurité — ${donnees.libelle}${ctx ? '' : ' (génération automatique)'}`, user: ctx ? null : { id: null, username: 'système' } });
  const dest = [...await adminsActifs(), ...await directeursActifs()];
  await notify(dest, { type: 'SECURITE', titre: `Rapport mensuel de sécurité — ${donnees.libelle}`, message: `Incidents critiques : ${donnees.incidents.critiques}. Échecs de connexion : ${donnees.connexions.echecs}. Journal d’audit ${donnees.integriteAudit.integre ? 'intègre' : 'ALTÉRÉ'}.`, lien: '/rapports-securite', expediteur: ctx ? ctx.userId : null });
  return donnees;
}

/** Génère automatiquement le rapport du mois écoulé s’il n’existe pas encore. */
async function genererMoisEcoule() {
  const periode = moisPrecedent();
  if (await db('rapports_securite').where({ periode }).first()) return null;
  return generer(periode);
}

/** Titre de rubrique sans texte (suivi d’un tableau ou d’une liste). */
function rubrique(doc, titre, texteSiVide) {
  if (texteSiVide) return pdf.section(doc, titre, texteSiVide);
  pdf.ensureSpace(doc, 60);
  doc.font('Helvetica-Bold').fontSize(10.5).fillColor(pdf.BLUE).text(titre).moveDown(0.3).fillColor('#000');
  return null;
}

/** Produit le PDF du rapport (données figées). */
function ecrirePdf(res, r) {
  const d = r.donnees;
  const { doc, finish } = pdf.createPdf(res, { filename: `rapport-securite-${d.periode}.pdf`, titre: 'RAPPORT MENSUEL DE SÉCURITÉ DU SIG-DEP', sousTitre: `Période : ${d.libelle} — généré le ${pdf.fmtDateTime(r.genere_at)} par ${r.genere_par_username || 'le système'}` });
  pdf.section(doc, '1. Synthèse', `${d.incidents.critiques} incident(s) critique(s), ${d.incidents.attention} alerte(s) à surveiller. ${d.connexions.reussies} connexion(s) réussie(s) et ${d.connexions.echecs} échec(s). Journal d’audit ${d.integriteAudit.integre ? `intègre (${d.integriteAudit.entrees} entrées chaînées)` : `ALTÉRÉ : ${d.integriteAudit.problemes} anomalie(s) — à examiner immédiatement`}.`);
  rubrique(doc, '2. Connexions');
  pdf.keyValues(doc, [['Connexions réussies', d.connexions.reussies], ['Échecs de connexion', d.connexions.echecs], ['Comptes visés par des échecs', d.connexions.comptesVises]]);
  if (d.connexions.ipsSuspectes.length) pdf.table(doc, [{ header: 'Adresse IP', key: 'ip', width: 3 }, { header: 'Échecs', key: 'echecs', width: 1 }, { header: 'Comptes visés', key: 'comptes', width: 1 }], d.connexions.ipsSuspectes);
  rubrique(doc, '3. Comptes');
  pdf.keyValues(doc, [['Comptes créés', d.comptes.crees], ['Comptes désactivés', d.comptes.desactives], ['Verrouillages automatiques', d.comptes.verrouillagesAutomatiques], ['Blocages par l’Admin', d.comptes.blocagesAdmin], ['Comptes inactifs en fin de mois', d.comptes.inactifsFinDeMois], ['Réinitialisations de mot de passe (Admin)', d.reinitialisations.parAdmin], ['Récupérations par l’utilisateur', d.reinitialisations.parRecuperation]]);
  rubrique(doc, '4. Changements de rôles', d.roles.length ? null : 'Aucun changement de rôle.');
  if (d.roles.length) pdf.table(doc, [{ header: 'Date', value: (x) => pdf.fmtDateTime(x.date), width: 2 }, { header: 'Par', key: 'par', width: 2 }, { header: 'Compte', key: 'compte', width: 2 }, { header: 'Détail', key: 'detail', width: 4 }], d.roles);
  rubrique(doc, '5. Incidents (alertes de sécurité)', d.incidents.parType.length ? null : 'Aucune alerte de sécurité.');
  if (d.incidents.parType.length) pdf.table(doc, [{ header: 'Type', key: 'type', width: 3 }, { header: 'Gravité', key: 'gravite', width: 2 }, { header: 'Nombre', key: 'nombre', width: 1 }], d.incidents.parType);
  rubrique(doc, '6. Sauvegardes et exploitation');
  pdf.keyValues(doc, [['Sauvegardes réussies', d.sauvegardes.reussies], ['Sauvegardes échouées', d.sauvegardes.echecs], ['Dernière sauvegarde réussie', d.sauvegardes.derniere ? pdf.fmtDateTime(d.sauvegardes.derniere) : 'Aucune'], ['Erreurs techniques (groupes)', d.erreursTechniques]]);
  pdf.signatureBlock(doc, [{ libelle: 'L’Admin Système' }, { libelle: 'Vu, le Directeur' }]);
  return finish();
}

module.exports = { calculer, generer, genererMoisEcoule, ecrirePdf, moisPrecedent, libellePeriode };

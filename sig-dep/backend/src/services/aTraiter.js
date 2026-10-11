'use strict';
/**
 * Files « À traiter » du tableau de bord : ce qui attend l’utilisateur dans les circuits.
 * Chaque file reprend exactement la règle de droit de l’action correspondante sur la fiche
 * (ptba/routes actionsPour, programmation actionsDoc, donnees actionsCampagne/actionsReponse,
 * exploitation actions, reunions roles, actes droits, cartes, décisions, restaurations) :
 * personne ne voit dans sa file un élément qu’il ne pourrait pas traiter.
 * Une file vide n’est pas renvoyée.
 */
const db = require('../db/knex');
const { depassements } = require('./cadrage');
const { OUVERTES } = require('./decisions');

/** Date du jour à Kinshasa (AAAA-MM-JJ). */
const kinshasaDate = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Kinshasa', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

const MAX = 5;
const nomAgent = (a) => `concat_ws(' ', ${a}.prenom, ${a}.nom)`;

/** Construit une file à partir de lignes déjà triées (les plus urgentes d’abord). */
function file(cle, module, titre, voirTout, lignes, item) {
  if (!lignes.length) return null;
  return { cle, module, titre, voirTout, total: lignes.length, items: lignes.slice(0, MAX).map(item) };
}

const TYPES_DOC = { PAP: 'PAP', RAP: 'RAP', CDMT: 'CDMT', CBMT: 'CBMT' };
const titreDoc = (d) => (d.type === 'CBMT' ? `CBMT ${d.annee}-${d.annee + 2}` : `${TYPES_DOC[d.type] || d.type} ${d.annee}`);

// ─── Planification ──────────────────────────────────────────────────────────
const ptbaRows = (statuts) => db('ptba as p').join('plan_services as s', 's.id', 'p.service_id').join('exercices as e', 'e.id', 'p.exercice_id')
  .whereIn('p.statut', statuts).orderBy('p.updated_at').select('p.id', 'p.reference', 'p.statut', 's.sigle', 'e.annee', 'p.updated_at');
const docRows = (statuts) => db('plan_documents').whereIn('statut', statuts).orderBy('updated_at').select('id', 'reference', 'type', 'annee', 'statut', 'updated_at');
const itemPtba = (p) => ({ id: `ptba-${p.id}`, titre: `PTBA ${p.annee} — ${p.sigle}`, detail: p.reference, to: `/planification/ptba/${p.id}`, statut: p.statut });
const itemDoc = (d) => ({ id: `doc-${d.id}`, titre: titreDoc(d), detail: d.reference, to: `/planification/documents/${d.id}`, statut: d.statut });

async function planification(ctx, aujourdhui) {
  const out = [];
  const etape = async (perm, statut, verbe, cle) => {
    if (!ctx.can(perm)) return;
    const [ptba, docs] = await Promise.all([ptbaRows([statut]), docRows([statut])]);
    out.push(file(`ptba_${cle}`, 'planification', `PTBA à ${verbe}`, '/planification', ptba, itemPtba));
    out.push(file(`docs_${cle}`, 'planification', `Documents de programmation à ${verbe}`, '/planification?onglet=documents', docs, itemDoc));
  };
  await etape('ptba.verifier', 'SOUMIS', 'vérifier', 'verifier');
  await etape('ptba.consolider', 'VERIFIE', 'consolider', 'consolider');
  await etape('ptba.valider', 'CONSOLIDE', 'valider', 'valider');
  if (ctx.can('ptba.preparer')) {
    const [ptbaC, docsC, ptbaB, docsB] = await Promise.all([ptbaRows(['A_CORRIGER']), docRows(['A_CORRIGER']), ptbaRows(['BROUILLON']), docRows(['BROUILLON'])]);
    out.push(file('programmation_corriger', 'planification', 'Retournés pour correction', '/planification', [...ptbaC.map((p) => ['p', p]), ...docsC.map((d) => ['d', d])],
      ([k, x]) => (k === 'p' ? itemPtba(x) : itemDoc(x))));
    out.push(file('programmation_brouillons', 'planification', 'Brouillons à compléter puis soumettre', '/planification', [...ptbaB.map((p) => ['p', p]), ...docsB.map((d) => ['d', d])],
      ([k, x]) => (k === 'p' ? itemPtba(x) : itemDoc(x))));
  }
  if (ctx.can('ptba.verifier')) {
    const annee = Number(aujourdhui.slice(0, 4));
    const dep = await depassements([annee, annee + 1]);
    out.push(file('cbmt_depassements', 'planification', 'Dépassements des plafonds du CBMT', '/planification?onglet=credits', dep,
      (x) => ({ id: `dep-${x.annee}-${x.rubrique}`, titre: `${x.rubrique} — ${x.annee}`, detail: `Prévision ${Math.round(x.prevision).toLocaleString('fr-FR')} pour un plafond de ${Math.round(x.plafond).toLocaleString('fr-FR')} CDF`, to: '/planification?onglet=credits', alerte: true })));
  }
  if (ctx.can('ptba.suivre')) {
    // Exécution du trimestre écoulé de l’exercice en cours (rien à signaler au premier trimestre).
    const annee = Number(aujourdhui.slice(0, 4));
    const trimestre = Math.floor((Number(aujourdhui.slice(5, 7)) - 1) / 3);
    if (trimestre >= 1) {
      const rows = await db('ptba as p').join('plan_services as s', 's.id', 'p.service_id').join('exercices as e', 'e.id', 'p.exercice_id')
        .join('ptba_lignes as l', 'l.ptba_id', 'p.id').where({ 'p.statut': 'VALIDE', 'e.annee': annee })
        .whereNotExists(db('ptba_suivi as u').whereRaw('u.ligne_id = l.id').where('u.trimestre', '>=', trimestre))
        .groupBy('p.id', 's.sigle', 'e.annee').orderBy('s.sigle').select('p.id', 's.sigle', 'e.annee', db.raw('count(l.id)::int as lignes'));
      out.push(file('execution_saisir', 'planification', `Exécution du T${trimestre} à saisir`, '/planification?onglet=execution', rows,
        (p) => ({ id: `exe-${p.id}`, titre: `PTBA ${p.annee} — ${p.sigle}`, detail: `${p.lignes} activité(s) sans exécution du T${trimestre}`, to: `/planification/ptba/${p.id}` })));
    }
    const [jalons, risques] = await Promise.all([
      db('pip_jalons as j').join('pip_projects as p', 'p.id', 'j.pip_id').whereNull('j.date_realisee').where('j.date_prevue', '<', aujourdhui)
        .orderBy('j.date_prevue').select('j.id', 'j.libelle', 'j.date_prevue', 'p.code'),
      db('risques').where('statut', 'OUVERT').whereRaw('probabilite * impact >= 6').orderByRaw('probabilite * impact desc').orderBy('created_at').select('id', 'libelle', 'probabilite', 'impact', 'echeance'),
    ]);
    out.push(file('jalons_retard', 'planification', 'Jalons de projets en retard', '/planification?onglet=banque', jalons,
      (j) => ({ id: `jal-${j.id}`, titre: j.libelle, detail: `Projet ${j.code}`, echeance: j.date_prevue, to: '/planification?onglet=banque' })));
    out.push(file('risques_critiques', 'planification', 'Risques critiques ouverts', '/planification?onglet=risques', risques,
      (r) => ({ id: `ris-${r.id}`, titre: r.libelle, detail: `Criticité ${r.probabilite * r.impact}`, echeance: r.echeance, to: '/planification?onglet=risques', alerte: true })));
  }
  return out;
}

// ─── Données sectorielles ───────────────────────────────────────────────────
async function donnees(ctx, aujourdhui) {
  const out = [];
  if (ctx.can('donnees.valider')) {
    const rows = await db('sect_campagnes').where('statut', 'CLOTUREE').orderBy('cloturee_at').select('id', 'reference', 'titre', 'periode');
    out.push(file('campagnes_valider', 'donnees', 'Campagnes clôturées à valider', '/donnees?onglet=campagnes', rows,
      (c) => ({ id: `cam-${c.id}`, titre: c.titre, detail: `${c.reference} · ${c.periode}`, to: `/donnees/campagnes/${c.id}` })));
  }
  const bulletins = async (perm, statut, cle, titre) => {
    if (!ctx.can(perm)) return;
    const rows = await db('sect_bulletins').where('statut', statut).orderBy('updated_at').select('id', 'reference', 'titre', 'periode');
    out.push(file(cle, 'donnees', titre, '/donnees?onglet=bulletins', rows, (b) => ({ id: `bul-${b.id}`, titre: b.titre, detail: `${b.reference} · ${b.periode}`, to: `/donnees/bulletins/${b.id}` })));
  };
  await bulletins('donnees.viser', 'SOUMIS', 'bulletins_viser', 'Bulletins à viser');
  await bulletins('donnees.autoriser', 'VISE', 'bulletins_autoriser', 'Bulletins dont la diffusion est à autoriser');
  const reponses = (q) => db('sect_reponses as r').join('sect_campagnes as c', 'c.id', 'r.campagne_id').join('sect_acteurs as a', 'a.id', 'r.acteur_id')
    .modify(q).select('r.id', 'r.campagne_id', 'r.acteur_id', 'r.anomalies', 'a.raison_sociale', 'c.reference', 'c.echeance', 'r.observations');
  const itemReponse = (r) => {
    const erreurs = (r.anomalies || []).filter((x) => x.niveau === 'ERREUR').length;
    return { id: `rep-${r.id}`, titre: r.raison_sociale, detail: erreurs ? `${r.reference} · ${erreurs} erreur(s)` : r.reference, to: `/donnees/campagnes/${r.campagne_id}/reponses/${r.acteur_id}`, alerte: erreurs > 0 };
  };
  if (ctx.can('donnees.controler')) {
    const rows = await reponses((q) => q.where('r.statut', 'SAISIE').whereIn('c.statut', ['OUVERTE', 'CLOTUREE']).whereNot('r.saisi_par', ctx.userId).orderBy('r.saisi_at'));
    out.push(file('reponses_controler', 'donnees', 'Réponses à contrôler', '/donnees?onglet=campagnes', rows, itemReponse));
  }
  if (ctx.can('donnees.saisir')) {
    const [corriger, brouillons, campagnes] = await Promise.all([
      reponses((q) => q.where({ 'r.statut': 'A_CORRIGER', 'r.saisi_par': ctx.userId, 'c.statut': 'OUVERTE' }).orderBy('r.updated_at')),
      reponses((q) => q.where({ 'r.statut': 'BROUILLON', 'r.saisi_par': ctx.userId, 'c.statut': 'OUVERTE' }).orderBy('r.updated_at')),
      // Campagnes ouvertes dont l’échéance tombe dans les 7 jours : acteurs ciblés sans réponse transmise.
      db('sect_campagnes as c').where('c.statut', 'OUVERTE').whereRaw('c.echeance <= ?::date + 7', [aujourdhui]).orderBy('c.echeance')
        .select('c.id', 'c.reference', 'c.titre', 'c.echeance',
          db.raw(`(select count(*)::int from sect_campagne_cibles k where k.campagne_id = c.id and not exists (
            select 1 from sect_reponses r where r.campagne_id = c.id and r.acteur_id = k.acteur_id and r.statut in ('SAISIE', 'CONTROLEE'))) as manquantes`)),
    ]);
    out.push(file('reponses_corriger', 'donnees', 'Mes réponses à corriger', '/donnees?onglet=campagnes', corriger, (r) => ({ ...itemReponse(r), detail: r.observations ? `${r.reference} · ${r.observations}` : r.reference })));
    out.push(file('reponses_brouillons', 'donnees', 'Mes brouillons à transmettre', '/donnees?onglet=campagnes', brouillons, itemReponse));
    out.push(file('campagnes_echeance', 'donnees', 'Collectes proches de l’échéance', '/donnees?onglet=campagnes', campagnes.filter((c) => c.manquantes > 0),
      (c) => ({ id: `ech-${c.id}`, titre: c.titre, detail: `${c.manquantes} acteur(s) sans réponse transmise`, echeance: c.echeance, to: `/donnees/campagnes/${c.id}` })));
  }
  if (ctx.can('donnees.rediger')) {
    const rows = await db('sect_bulletins').where({ statut: 'A_CORRIGER', redige_par: ctx.userId }).orderBy('updated_at').select('id', 'reference', 'titre', 'observations');
    out.push(file('bulletins_corriger', 'donnees', 'Mes bulletins à corriger', '/donnees?onglet=bulletins', rows, (b) => ({ id: `bco-${b.id}`, titre: b.titre, detail: b.observations || b.reference, to: `/donnees/bulletins/${b.id}` })));
  }
  return out;
}

// ─── Réunions et décisions ──────────────────────────────────────────────────
async function reunions(ctx) {
  const out = [];
  const secretariat = ctx.can('reunions.preparer_direction');
  const base = () => db('reunions as r').select('r.id', 'r.reference', 'r.objet', 'r.debut', 'r.statut');
  const preparateur = (q) => q.where((w) => { w.where('r.organisateur_user_id', ctx.userId); if (secretariat) w.orWhere('r.niveau', 'DIRECTION'); });
  const [valider, convoquer, tenir, rediger] = await Promise.all([
    base().where({ 'r.statut': 'CR_A_VALIDER', 'r.president_user_id': ctx.userId }).orderBy('r.cr_soumis_at'),
    base().where('r.statut', 'BROUILLON').modify(preparateur).orderBy('r.debut'),
    base().where('r.statut', 'CONVOQUEE').where('r.debut', '<=', db.fn.now()).whereNot('r.president_user_id', ctx.userId)
      .where((w) => w.where('r.redacteur_user_id', ctx.userId).orWhere((x) => preparateur(x))).orderBy('r.debut'),
    base().where({ 'r.statut': 'TENUE', 'r.redacteur_user_id': ctx.userId }).orderBy('r.debut'),
  ]);
  const item = (r) => ({ id: `reu-${r.id}`, titre: r.objet, detail: `${r.reference} · ${new Date(r.debut).toLocaleString('fr-FR', { timeZone: 'Africa/Kinshasa', dateStyle: 'short', timeStyle: 'short' })}`, to: `/reunions/${r.id}` });
  out.push(file('cr_valider', 'reunions', 'Comptes rendus à valider', '/reunions?periode=passees', valider, item));
  out.push(file('reunions_convoquer', 'reunions', 'Réunions préparées à convoquer', '/reunions', convoquer, item));
  out.push(file('reunions_tenir', 'reunions', 'Réunions passées à déclarer tenues', '/reunions?periode=passees', tenir, item));
  out.push(file('cr_rediger', 'reunions', 'Comptes rendus à rédiger', '/reunions?periode=passees', rediger, item));
  return out;
}

async function decisions(ctx, aujourdhui) {
  const rows = await db('decisions').where('responsable_user_id', ctx.userId).whereIn('statut', OUVERTES)
    .where((w) => w.where((x) => x.whereNull('instruction_id').whereNull('task_id')).orWhere('echeance', '<', aujourdhui))
    .orderByRaw('echeance asc nulls last').select('id', 'reference', 'libelle', 'echeance', 'statut');
  return [file('decisions_executer', 'decisions', 'Mes décisions à mettre en œuvre', '/decisions?mes=1', rows,
    (d) => ({ id: `dec-${d.id}`, titre: d.libelle, detail: d.reference, echeance: d.echeance, statut: d.statut, to: `/decisions/${d.id}` }))];
}

// ─── Actes et cartes ────────────────────────────────────────────────────────
async function actes(ctx) {
  const out = [];
  const autorites = [ctx.can('actes.valider') && 'DIRECTEUR', ctx.can('actes.valider_direction') && 'SECRETAIRE_GENERAL'].filter(Boolean);
  const item = (a) => ({ id: `act-${a.id}`, titre: a.objet, detail: `${a.numero} · ${a.reference}`, to: `/actes/${a.id}`, statut: a.statut });
  if (autorites.length) {
    // Comme sur la fiche : on ne décide pas d’un acte qui nous concerne.
    const rows = await db('actes_administratifs').where('statut', 'SOUMIS').whereIn('validation_par', autorites)
      .modify((q) => { if (ctx.agentId) q.where((w) => w.whereNull('agent_id').orWhereNot('agent_id', ctx.agentId)).where((w) => w.whereNull('titulaire_agent_id').orWhereNot('titulaire_agent_id', ctx.agentId)); })
      .orderBy('soumis_at').select('id', 'numero', 'reference', 'objet', 'statut');
    out.push(file('actes_decider', 'actes', 'Actes administratifs à décider', '/actes?statut=SOUMIS', rows, item));
  }
  if (ctx.can('actes.preparer') || ctx.can('actes.enregistrer_direction')) {
    const rows = await db('actes_administratifs as a').where('a.prepare_par', ctx.userId)
      .where((w) => w.where('a.statut', 'BROUILLON').orWhere((x) => x.where('a.statut', 'REFUSE')
        .whereNotExists(db('actes_administratifs as r').whereRaw('r.rectifie_acte_id = a.id'))))
      .orderBy('a.updated_at').select('a.id', 'a.numero', 'a.reference', 'a.objet', 'a.statut');
    out.push(file('actes_reprendre', 'actes', 'Actes en préparation ou refusés à reprendre', '/actes', rows, item));
  }
  return out;
}

const ETAPES_CARTE = { BROUILLON: 'à vérifier et transmettre', A_COMPLETER: 'dossier à compléter', VALIDEE: 'à imprimer', IMPRIMEE: 'à remettre au titulaire' };
async function cartes(ctx) {
  const out = [];
  const rows = (statuts) => db('cartes_service as c').join('agents as a', 'a.id', 'c.agent_id').whereIn('c.statut', statuts)
    .orderBy('c.updated_at').select('c.id', 'c.statut', 'c.numero', db.raw(`${nomAgent('a')} as titulaire`));
  if (ctx.can('cartes.valider')) {
    out.push(file('cartes_valider', 'cartes', 'Cartes de service à valider', '/cartes?statut=VERIFIEE', await rows(['VERIFIEE']),
      (c) => ({ id: `car-${c.id}`, titre: c.titulaire, detail: 'Vérifiée par le Secrétariat', to: `/cartes/${c.id}` })));
  }
  if (ctx.can('cartes.preparer')) {
    out.push(file('cartes_circuit', 'cartes', 'Cartes de service en circuit', '/cartes', await rows(Object.keys(ETAPES_CARTE)),
      (c) => ({ id: `cac-${c.id}`, titre: c.titulaire, detail: ETAPES_CARTE[c.statut], to: `/cartes/${c.id}`, alerte: c.statut === 'A_COMPLETER' })));
  }
  return out;
}

// ─── Système ────────────────────────────────────────────────────────────────
async function systeme(ctx) {
  const out = [];
  if (ctx.can('operations.confirmer')) {
    const rows = await db('demandes_confirmation').where('statut', 'EN_ATTENTE').where('expire_at', '>', db.fn.now()).orderBy('created_at').select('id', 'resume', 'demandeur', 'expire_at');
    out.push(file('confirmations', 'systeme', 'Opérations de l’Admin à confirmer', '/gouvernance', rows,
      (d) => ({ id: `cnf-${d.id}`, titre: d.resume, detail: `Demandée par ${d.demandeur}`, to: '/gouvernance' })));
  } else if (ctx.can('systeme.maintenir') || ctx.can('systeme.configurer') || ctx.can('role.attribuer')) {
    const rows = await db('demandes_confirmation').where({ statut: 'EN_ATTENTE', demandeur_id: ctx.userId }).where('expire_at', '>', db.fn.now()).orderBy('created_at').select('id', 'resume', 'expire_at');
    out.push(file('mes_confirmations', 'systeme', 'Mes demandes en attente de confirmation', '/gouvernance', rows,
      (d) => ({ id: `mcf-${d.id}`, titre: d.resume, detail: 'En attente du Directeur', to: '/gouvernance' })));
  }
  if (ctx.can('sauvegarde.valider_restauration')) {
    const rows = await db('demandes_restauration').where('statut', 'EN_ATTENTE').where('expire_at', '>', db.fn.now()).orderBy('demande_at').select('id', 'sauvegarde_date', 'demande_par_username', 'motif');
    out.push(file('restaurations_decider', 'systeme', 'Demandes de restauration à décider', '/restaurations', rows,
      (r) => ({ id: `rsd-${r.id}`, titre: `Retour à l’état du ${new Date(r.sauvegarde_date).toLocaleString('fr-FR', { timeZone: 'Africa/Kinshasa' })}`, detail: `Demandée par ${r.demande_par_username}`, to: '/restaurations', alerte: true })));
  }
  if (ctx.can('sauvegarde.restaurer')) {
    const rows = await db('demandes_restauration').where('statut', 'VALIDEE').where('expire_at', '>', db.fn.now()).orderBy('expire_at').select('id', 'sauvegarde_date', 'expire_at');
    out.push(file('restaurations_executer', 'systeme', 'Restaurations validées à exécuter', '/restaurations', rows,
      (r) => ({ id: `rse-${r.id}`, titre: `Retour à l’état du ${new Date(r.sauvegarde_date).toLocaleString('fr-FR', { timeZone: 'Africa/Kinshasa' })}`, detail: `À exécuter avant le ${new Date(r.expire_at).toLocaleString('fr-FR', { timeZone: 'Africa/Kinshasa' })}`, to: '/restaurations', alerte: true })));
  }
  return out;
}

/** Toutes les files de l’utilisateur, et leur total par module (compteurs du menu). */
async function aTraiter(ctx) {
  const aujourdhui = kinshasaDate();
  const groupes = await Promise.all([
    ctx.can('planification.consulter') ? planification(ctx, aujourdhui) : [],
    ctx.can('donnees.consulter') ? donnees(ctx, aujourdhui) : [],
    reunions(ctx), decisions(ctx, aujourdhui), actes(ctx), cartes(ctx), systeme(ctx),
  ]);
  const files = groupes.flat().filter(Boolean);
  const parModule = {};
  for (const f of files) parModule[f.module] = (parModule[f.module] || 0) + f.total;
  return { files, parModule };
}

module.exports = { aTraiter };

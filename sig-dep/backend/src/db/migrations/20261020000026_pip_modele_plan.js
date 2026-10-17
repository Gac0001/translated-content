'use strict';
/**
 * Fiche PIP au modèle du Ministère du Plan (cahier des charges, annexe 6 et sections 15 et 30) :
 *  - référentiel des services du Secrétariat Général (13 services), chacun rattaché à un programme
 *    budgétaire ;
 *  - référentiels de rattachement stratégique : PNSD (pilier, thématique, domaine, objectif
 *    spécifique) et stratégie sectorielle (programme, action), hiérarchisés ;
 *  - conversion des fiches existantes vers le nouveau modèle (les versions antérieures restent
 *    conservées telles quelles dans pip_versions).
 */
const SERVICES = [
  ['CAB', 'Cabinet du Ministre'], ['SG', 'Administration du Secrétaire Général'], ['CTA', 'Cellule Technique d’Appui'],
  ['CGPMP', 'Cellule Gestion des Projets et des Marchés Publics'], ['DRH', 'Direction des Ressources Humaines'],
  ['DAF', 'Direction Administrative et Financière'], ['DEP', 'Direction d’Études et Planification'],
  ['DANTIC', 'Direction Archives et Nouvelles Technologies de l’Information et de la Communication'],
  ['DIN', 'Direction Infrastructures Numériques'], ['DACN', 'Direction Applicatifs et Contenus Numériques'],
  ['DEN', 'Direction Économie Numérique'], ['DDCN', 'Direction Développement Culture Numérique'], ['DCS', 'Direction Cybersécurité'],
];

const vide = (v) => v === undefined || v === null || (typeof v === 'string' && !v.trim()) || (Array.isArray(v) && !v.length);
const ajoutMois = (iso, mois) => {
  if (!iso || !mois) return null;
  const [a, m] = String(iso).slice(0, 10).split('-').map(Number);
  const d = new Date(Date.UTC(a, m - 1 + Number(mois), 0));
  return d.toISOString().slice(0, 10);
};

/** Fiche de l’ancien modèle (16 sections) → modèle du Ministère du Plan (8 étapes). */
function convertir(v1 = {}) {
  const id = v1.identification || {}; const ctx = v1.contexte || {}; const ob = v1.objectifs || {}; const be = v1.beneficiaires || {};
  const loc = (v1.localisation && v1.localisation.sites && v1.localisation.sites[0]) || {};
  const im = v1.impacts || {}; const ga = v1.gains || {}; const re = v1.responsables || {};
  const debut = id.date_demarrage ? String(id.date_demarrage).slice(0, 10) : null;
  const ligne = (r, cles) => Object.fromEntries(cles.map(([a, b]) => [a, r[b] ?? null]));
  return {
    identification: {
      etape: 'Identification', ministere: '01 Ministère de l’Économie Numérique', service: id.organisme_execution || '',
      numero_projet: id.code_pip || '', libelle: id.intitule || '', competence: 'Pouvoir central', province_competence: '', secteur_prioritaire: '',
      secteur: id.secteur || '', sous_secteur: id.sous_secteur || '', nature_investissement: id.type_projet || '',
      province: loc.province || '', ville_territoire: loc.territoire || '', commune: loc.site || '',
    },
    rattachement: { pnsd_pilier: '', pnsd_thematique: '', pnsd_domaine: '', pnsd_objectif: '', strategie_programme: '', strategie_action: '' },
    justification: { probleme: ctx.problematique || '', situation_actuelle: ctx.contexte || '', situation_visee: ctx.justification || '' },
    objectifs: {
      objectif_global: ob.objectif_general || '', objectifs_specifiques: ob.objectifs_specifiques || [],
      resultats: (v1.resultats && v1.resultats.resultats_attendus) || [],
      directs_descriptif: be.directs || '', directs_genre: be.genre || '', indirects_descriptif: be.indirects || '', indirects_genre: '',
      effets: [im.economique, im.social, im.institutionnel].filter((x) => !vide(x)),
    },
    calendrier: {
      date_debut: debut, date_fin: ajoutMois(debut, id.duree_mois), duree_mois: id.duree_mois || null,
      activites: ((v1.activites && v1.activites.activites) || []).map((a) => ({ activite: a.activite, annee1: [a.debut, a.fin].filter(Boolean).join(' – ') || null, annee2: null, annee3: null, annee4: null })),
      indicateurs_resultats: [],
      indicateurs_effets: ((v1.indicateurs && v1.indicateurs.indicateurs) || []).map((i) => ({ indicateur: i.indicateur, reference: i.reference ?? null, annee1: i.cible ?? null, annee2: null, annee3: null })),
    },
    financier: {
      couts: ((v1.cout && v1.cout.couts) || []).map((r) => ({ ...ligne(r, [['rubrique', 'rubrique'], ['annee1', 'annee1'], ['annee2', 'annee2'], ['annee3', 'annee3']]), annee4: null })),
      financement: ((v1.financement && v1.financement.sources) || []).map((s) => ({ source: s.source, pret_don: s.statut || null, annee1: s.montant ?? null, annee2: null, annee3: null, autres: null })),
      recurrents: [],
    },
    institutionnel: {
      maitre_ouvrage: id.ministere_tutelle || '', maitre_oeuvre: id.organisme_execution || '', structure_responsable: re.structure_responsable || '',
      emplois: ga.emplois ?? null, emplois_femmes: null, gains: [],
      impacts_environnementaux: vide(im.environnemental) ? [] : [{ impact: im.environnemental, mitigation: null }],
      risques: ((v1.risques && v1.risques.risques) || []).map((r) => ({ risque: r.risque, mitigation: r.mesure ?? null })),
    },
    controle: {
      commentaire: [ctx.alignement, ga.description].filter((x) => !vide(x)).join('\n\n'),
      etudes: ((v1.etudes && v1.etudes.etudes) || []).map((e) => ({ nature: e.etude, date_fin: /^\d{4}-\d{2}-\d{2}/.test(e.date || '') ? e.date.slice(0, 10) : null, montant: null })),
      responsable: re.chef_projet || '', telephone: re.contacts || '', email: '', date_fiche: null,
    },
  };
}

exports.convertir = convertir;

exports.up = async function up(knex) {
  await knex.schema.alterTable('plan_services', (t) => {
    t.integer('programme_id').references('plan_programmes.id');
    t.integer('ordre').notNullable().defaultTo(0);
  });
  for (const [i, [sigle, libelle]] of SERVICES.entries()) {
    const existe = await knex('plan_services').where({ sigle }).first();
    if (existe) await knex('plan_services').where({ id: existe.id }).update({ ordre: i + 1 });
    else await knex('plan_services').insert({ sigle, libelle, ordre: i + 1 });
  }

  await knex.schema.createTable('plan_rattachements', (t) => {
    t.increments('id');
    t.string('referentiel', 20).notNullable(); // PNSD | STRATEGIE
    t.string('niveau', 20).notNullable(); // PNSD : PILIER > THEMATIQUE > DOMAINE > OBJECTIF ; STRATEGIE : PROGRAMME > ACTION
    t.integer('parent_id').references('plan_rattachements.id').onDelete('RESTRICT');
    t.string('code', 30);
    t.string('libelle', 500).notNullable();
    t.string('edition', 60); // ex. « PNSD 2024-2028 », « 2026-2030 »
    t.integer('ordre').notNullable().defaultTo(0);
    t.boolean('actif').notNullable().defaultTo(true);
    t.timestamps(true, true);
    t.index(['referentiel', 'niveau']);
  });
  await knex.raw(`ALTER TABLE plan_rattachements ADD CONSTRAINT plan_rattachements_chk CHECK (
    (referentiel = 'PNSD' AND niveau IN ('PILIER','THEMATIQUE','DOMAINE','OBJECTIF'))
    OR (referentiel = 'STRATEGIE' AND niveau IN ('PROGRAMME','ACTION')))`);

  await knex.schema.alterTable('pip_projects', (t) => { t.string('modele', 10).notNullable().defaultTo('PLAN'); });
  // pip_versions est en ajout seul : la colonne est créée avec « V1 » pour les versions existantes
  // (sans mise à jour de lignes), puis la valeur par défaut devient « PLAN ».
  await knex.schema.alterTable('pip_versions', (t) => { t.string('modele', 10).notNullable().defaultTo('V1'); });
  await knex.raw(`ALTER TABLE pip_versions ALTER COLUMN modele SET DEFAULT 'PLAN'`);
  for (const p of await knex('pip_projects').select('id', 'donnees', 'devise')) {
    const d = convertir(p.donnees || {});
    await knex('pip_projects').where({ id: p.id }).update({ donnees: JSON.stringify(d), secteur: d.identification.secteur || null });
  }
};

exports.down = async function down(knex) {
  // Retour à l’ancien modèle : dernière version enregistrée selon celui-ci
  for (const p of await knex('pip_projects').select('id')) {
    const v = await knex('pip_versions').where({ pip_id: p.id, modele: 'V1' }).orderBy('numero', 'desc').first();
    if (v) await knex('pip_projects').where({ id: p.id }).update({ donnees: JSON.stringify(v.donnees) });
  }
  await knex.schema.alterTable('pip_versions', (t) => { t.dropColumn('modele'); });
  await knex.schema.alterTable('pip_projects', (t) => { t.dropColumn('modele'); });
  await knex.schema.dropTable('plan_rattachements');
  await knex.schema.alterTable('plan_services', (t) => { t.dropColumn('ordre'); t.dropColumn('programme_id'); });
};

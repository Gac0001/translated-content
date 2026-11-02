'use strict';
/**
 * Fiche de projet PIP au modèle du Ministère du Plan (Direction de la Programmation et
 * Budgétisation), cahier des charges, annexe 6 : huit étapes, dans l’ordre du classeur officiel
 * (six feuilles). Montants en francs congolais. Les années « 1 à 4 » partent de l’année de début.
 *
 * Les rubriques de rattachement (service, PNSD, stratégie sectorielle, localisation) proposent les
 * valeurs des référentiels (`suggestions`) sans les imposer : un classeur importé reste lisible.
 */
const ANNEES = (n, type = 'number') => Array.from({ length: n }, (_, i) => ({ key: `annee${i + 1}`, label: `Année ${i + 1}`, type }));
const RUBRIQUES_COUTS = ['Etudes', 'Acquisition de terrains', 'Construction/réhabilitation', 'Equipements', 'Frais de mise en œuvre', 'Autres'];
const SOURCES = ['Etat', 'Partenaires', 'En négociation', 'A rechercher'];
const RECURRENTS = ['Charges salariales', 'Maintenance', 'Eau/électricité/tél…'];
const ETAPES = ['Identification', 'Sélection'];

const SECTIONS = [
  { key: 'identification', numero: 1, label: 'Identification', feuille: 1, fields: [
    { key: 'etape', label: 'Étape', type: 'select', options: ETAPES, required: true, default: 'Identification', help: 'À l’étape de Sélection, les études réalisées sont obligatoires.' },
    { key: 'ministere', label: 'Ministère / Institution (code et libellé)', type: 'text', required: true, default: '01 Ministère de l’Économie Numérique' },
    { key: 'service', label: 'Service / Société d’État', type: 'text', required: true, suggestions: 'SERVICES' },
    { key: 'numero_projet', label: 'N° projet', type: 'text' },
    { key: 'libelle', label: 'Libellé du projet', type: 'text', required: true },
    { key: 'competence', label: 'Compétence', type: 'select', options: ['Pouvoir central', 'Pouvoir provincial'], required: true, default: 'Pouvoir central' },
    { key: 'province_competence', label: 'Province (compétence provinciale)', type: 'text', suggestions: 'PROVINCES' },
    { key: 'secteur_prioritaire', label: 'Secteur prioritaire', type: 'text' },
    { key: 'secteur', label: 'Secteur du projet', type: 'text', required: true, suggestions: 'SECTEURS' },
    { key: 'sous_secteur', label: 'Sous-secteur', type: 'text', default: 'Numérique' },
    { key: 'nature_investissement', label: 'Nature d’investissement', type: 'text', required: true, suggestions: 'NATURES' },
    { key: 'province', label: 'Province', type: 'text', required: true, suggestions: 'PROVINCES' },
    { key: 'ville_territoire', label: 'Ville / Territoire', type: 'text' },
    { key: 'commune', label: 'Commune / Secteur / Chefferie', type: 'text' },
  ] },
  { key: 'rattachement', numero: 2, label: 'Rattachement stratégique', feuille: 1, fields: [
    { key: 'pnsd_pilier', label: 'PNSD — Pilier', type: 'text', required: true, suggestions: 'PNSD:PILIER' },
    { key: 'pnsd_thematique', label: 'PNSD — Thématique', type: 'text', suggestions: 'PNSD:THEMATIQUE', parent: 'pnsd_pilier' },
    { key: 'pnsd_domaine', label: 'PNSD — Domaine', type: 'text', suggestions: 'PNSD:DOMAINE', parent: 'pnsd_thematique' },
    { key: 'pnsd_objectif', label: 'PNSD — Objectif spécifique', type: 'text', suggestions: 'PNSD:OBJECTIF', parent: 'pnsd_domaine' },
    { key: 'strategie_programme', label: 'Stratégie sectorielle — Programme budgétaire', type: 'text', required: true, suggestions: 'STRATEGIE:PROGRAMME' },
    { key: 'strategie_action', label: 'Stratégie sectorielle — Action', type: 'text', suggestions: 'STRATEGIE:ACTION', parent: 'strategie_programme' },
  ] },
  { key: 'justification', numero: 3, label: 'Justification du projet', feuille: 1, fields: [
    { key: 'probleme', label: 'Problème identifié', type: 'textarea', required: true },
    { key: 'situation_actuelle', label: 'Situation actuelle', type: 'textarea', required: true },
    { key: 'situation_visee', label: 'Situation visée', type: 'textarea', required: true },
  ] },
  { key: 'objectifs', numero: 4, label: 'Objectifs, résultats, bénéficiaires, effets', feuille: 2, fields: [
    { key: 'objectif_global', label: 'Objectif global', type: 'textarea', required: true },
    { key: 'objectifs_specifiques', label: 'Objectifs spécifiques', type: 'list', required: true, max: 3 },
    { key: 'resultats', label: 'Résultats attendus', type: 'list', required: true, max: 3 },
    { key: 'directs_descriptif', label: 'Bénéficiaires directs — descriptif', type: 'textarea', required: true },
    { key: 'directs_genre', label: 'Bénéficiaires directs — aspect genre', type: 'textarea' },
    { key: 'indirects_descriptif', label: 'Bénéficiaires indirects — descriptif', type: 'textarea' },
    { key: 'indirects_genre', label: 'Bénéficiaires indirects — aspect genre', type: 'textarea' },
    { key: 'effets', label: 'Effets / impacts', type: 'list', max: 3 },
  ] },
  { key: 'calendrier', numero: 5, label: 'Calendrier et indicateurs', feuille: 3, fields: [
    { key: 'date_debut', label: 'Date de début prévue', type: 'date', required: true },
    { key: 'date_fin', label: 'Date de fin prévue', type: 'date', required: true },
    { key: 'duree_mois', label: 'Durée prévue (en mois)', type: 'number', calcule: true, help: 'Calculée à partir des dates.' },
    { key: 'activites', label: 'Principales activités (planning par année)', type: 'table', required: true, help: 'Période de chaque année, par exemple « Janvier-Mars ». Année 1 = année de début.',
      columns: [{ key: 'activite', label: 'Activité' }, ...ANNEES(4, 'text')] },
    { key: 'indicateurs_resultats', label: 'Indicateurs de résultats', type: 'table',
      columns: [{ key: 'indicateur', label: 'Indicateur' }, ...ANNEES(3, 'text'), { key: 'autres', label: 'Autres' }] },
    { key: 'indicateurs_effets', label: 'Indicateurs d’effets / impacts (formule de calcul)', type: 'table',
      columns: [{ key: 'indicateur', label: 'Indicateur (formule de calcul)' }, { key: 'reference', label: 'Référence (année précédant le début)' }, ...ANNEES(3, 'text')] },
  ] },
  { key: 'financier', numero: 6, label: 'Aspect financier (en CDF)', feuille: 4, fields: [
    { key: 'couts', label: 'Répartition des coûts par grandes masses', type: 'table', required: true, lignesFixes: RUBRIQUES_COUTS,
      columns: [{ key: 'rubrique', label: 'Rubrique' }, ...ANNEES(4)] },
    { key: 'financement', label: 'Plan de financement', type: 'table', required: true, defaultRows: SOURCES,
      columns: [{ key: 'source', label: 'Source de financement' }, { key: 'pret_don', label: 'Prêt / don' }, ...ANNEES(3), { key: 'autres', label: 'Autres', type: 'number' }] },
    { key: 'recurrents', label: 'Coûts récurrents après mise en exploitation (par an)', type: 'table', defaultRows: RECURRENTS, help: 'Année 1 = première année d’exploitation.',
      columns: [{ key: 'rubrique', label: 'Rubrique' }, ...ANNEES(4), { key: 'standard', label: 'Année standard', type: 'number' }] },
  ] },
  { key: 'institutionnel', numero: 7, label: 'Aspects institutionnel, économique et environnemental', feuille: 4, fields: [
    { key: 'maitre_ouvrage', label: 'Maître d’ouvrage (pendant le projet)', type: 'text', required: true, default: 'Ministère de l’Économie Numérique' },
    { key: 'maitre_oeuvre', label: 'Maître d’œuvre (pendant le projet)', type: 'text' },
    { key: 'structure_responsable', label: 'Structure responsable (après le projet)', type: 'text', required: true, suggestions: 'SERVICES' },
    { key: 'emplois', label: 'Nombre d’emplois créés', type: 'number' },
    { key: 'emplois_femmes', label: 'dont femmes', type: 'number' },
    { key: 'gains', label: 'Gains économiques estimés (en CDF)', type: 'table',
      columns: [{ key: 'rubrique', label: 'Rubrique' }, ...ANNEES(3), { key: 'autres', label: 'Autres', type: 'number' }] },
    { key: 'impacts_environnementaux', label: 'Impacts environnementaux', type: 'table',
      columns: [{ key: 'impact', label: 'Impact' }, { key: 'mitigation', label: 'Si négatif, mitigation' }] },
    { key: 'risques', label: 'Risques portant sur la réalisation du projet', type: 'table', required: true,
      columns: [{ key: 'risque', label: 'Risque' }, { key: 'mitigation', label: 'Mitigation' }] },
  ] },
  { key: 'controle', numero: 8, label: 'Contrôle et signature', feuille: 6, fields: [
    { key: 'commentaire', label: 'Commentaire libre', type: 'textarea' },
    { key: 'etudes', label: 'Études réalisées (étape de Sélection)', type: 'table',
      columns: [{ key: 'nature', label: 'Nature de l’étude' }, { key: 'date_fin', label: 'Date de fin', type: 'date' }, { key: 'montant', label: 'Montant (CDF)', type: 'number' }] },
    { key: 'responsable', label: 'Responsable du dossier', type: 'text', required: true },
    { key: 'telephone', label: 'Téléphone', type: 'text' },
    { key: 'email', label: 'Courriel', type: 'text' },
    { key: 'date_fiche', label: 'Date', type: 'date' },
  ] },
];

const FIELDS = Object.fromEntries(SECTIONS.flatMap((s) => s.fields.map((f) => [`${s.key}.${f.key}`, f])));
const champ = (sk, fk) => FIELDS[`${sk}.${fk}`];

function isEmpty(v) {
  if (v === undefined || v === null) return true;
  if (typeof v === 'string') return v.trim() === '';
  if (Array.isArray(v)) return v.length === 0;
  return false;
}
const nombre = (x) => {
  if (x === undefined || x === null || x === '') return null;
  const n = typeof x === 'number' ? x : Number(String(x).replace(/[\s  ]/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};
const somme = (vals) => Math.round(vals.reduce((s, v) => s + (Number(v) || 0), 0) * 100) / 100;
const ligneVide = (r, cols) => cols.every((c) => isEmpty(r[c.key]));

/** Mois entre deux dates (AAAA-MM-JJ), fin incluse au mois près. */
function dureeMois(debut, fin) {
  if (!debut || !fin) return null;
  const [a1, m1] = String(debut).split('-').map(Number); const [a2, m2] = String(fin).split('-').map(Number);
  const n = (a2 - a1) * 12 + (m2 - m1) + 1;
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Totaux et années réelles (colonnes « Année 1… »), pour l’affichage et l’export. */
function synthese(d) {
  const f = d.financier || {};
  const annees = (k) => [1, 2, 3, 4].map((i) => somme((f[k] || []).map((r) => r[`annee${i}`])));
  const coutsParAnnee = annees('couts');
  const finParAnnee = [1, 2, 3].map((i) => somme((f.financement || []).map((r) => r[`annee${i}`])));
  const finAutres = somme((f.financement || []).map((r) => r.autres));
  const debut = d.calendrier?.date_debut ? Number(String(d.calendrier.date_debut).slice(0, 4)) : null;
  const fin = d.calendrier?.date_fin ? Number(String(d.calendrier.date_fin).slice(0, 4)) : null;
  return {
    anneeDebut: debut, anneeFin: fin,
    coutsParAnnee, coutTotal: somme(coutsParAnnee),
    financementParAnnee: [...finParAnnee, finAutres], financementTotal: somme([...finParAnnee, finAutres]),
    recurrentsParAnnee: annees('recurrents'),
  };
}

/**
 * Normalise la fiche : types, lignes vides retirées, durée calculée. Renvoie aussi les rubriques
 * obligatoires manquantes et les incohérences (bloquantes ou à vérifier) de la page de contrôle.
 */
function normalize(donnees = {}) {
  const out = {};
  const missing = [];
  for (const s of SECTIONS) {
    const src = (donnees && donnees[s.key]) || {};
    out[s.key] = {};
    for (const f of s.fields) {
      let v = src[f.key];
      if (f.type === 'list') v = Array.isArray(v) ? v.map((x) => String(x ?? '').slice(0, 2000)).filter((x) => x.trim()) : [];
      else if (f.type === 'table') {
        v = Array.isArray(v) ? v.slice(0, 100).map((r) => Object.fromEntries(f.columns.map((c) => {
          const x = r ? r[c.key] : null;
          if (c.type === 'number') return [c.key, nombre(x)];
          return [c.key, isEmpty(x) ? null : String(x).slice(0, 2000)];
        }))) : [];
        // Une ligne entièrement vide est retirée ; les rubriques prédéfinies du modèle sont gardées.
        const predefinies = f.lignesFixes || f.defaultRows || [];
        v = v.filter((r) => !ligneVide(r, f.columns) && (!ligneVide(r, f.columns.slice(1)) || predefinies.includes(r[f.columns[0].key]) || !predefinies.length));
      } else if (f.type === 'number') v = nombre(v);
      else if (f.type === 'select') v = f.options.includes(v) ? v : (f.default || '');
      else v = v === undefined || v === null ? (f.default || '') : String(v).slice(0, 50000);
      out[s.key][f.key] = v;
    }
  }
  const c = out.calendrier;
  c.duree_mois = dureeMois(c.date_debut, c.date_fin) ?? c.duree_mois;
  for (const s of SECTIONS) {
    for (const f of s.fields) {
      const v = out[s.key][f.key];
      const requis = f.required || (s.key === 'controle' && f.key === 'etudes' && out.identification.etape === 'Sélection');
      // Tableau à rubriques prédéfinies : vide tant qu’aucune valeur n’est saisie en regard des rubriques.
      const vide = f.type === 'table' ? (f.lignesFixes || f.defaultRows ? v.every((r) => ligneVide(r, f.columns.slice(1))) : !v.length) : isEmpty(v);
      if (requis && vide) missing.push(`${s.numero}. ${s.label} — ${f.label}`);
    }
  }
  const sy = synthese(out);
  const incoherences = [];
  if (c.date_debut && c.date_fin && c.date_fin < c.date_debut) incoherences.push({ bloquant: true, message: 'La date de fin prévue précède la date de début.' });
  if (sy.coutTotal && Math.abs(sy.coutTotal - sy.financementTotal) > 0.5) {
    incoherences.push({ bloquant: true, message: `Le plan de financement (${sy.financementTotal.toLocaleString('fr-FR')} CDF) ne couvre pas exactement le coût du projet (${sy.coutTotal.toLocaleString('fr-FR')} CDF).` });
  }
  [0, 1, 2].forEach((i) => {
    if (Math.abs(sy.coutsParAnnee[i] - sy.financementParAnnee[i]) > 0.5 && (sy.coutsParAnnee[i] || sy.financementParAnnee[i])) {
      incoherences.push({ bloquant: false, message: `Année ${i + 1}${sy.anneeDebut ? ` (${sy.anneeDebut + i})` : ''} : coûts ${sy.coutsParAnnee[i].toLocaleString('fr-FR')} CDF, financement ${sy.financementParAnnee[i].toLocaleString('fr-FR')} CDF.` });
    }
  });
  if (sy.anneeDebut && sy.anneeFin && sy.anneeFin - sy.anneeDebut > 3) incoherences.push({ bloquant: false, message: 'Le projet dépasse quatre années : le modèle du Ministère du Plan n’en présente que quatre.' });
  if (out.institutionnel.emplois_femmes !== null && out.institutionnel.emplois !== null && out.institutionnel.emplois_femmes > out.institutionnel.emplois) {
    incoherences.push({ bloquant: true, message: 'Le nombre d’emplois occupés par des femmes dépasse le nombre d’emplois créés.' });
  }
  return { donnees: out, missing, incoherences, synthese: sy, coutTotal: sy.coutTotal };
}

/** Fiche vide, avec les valeurs par défaut et les lignes prédéfinies des tableaux. */
function ficheVide() {
  const d = {};
  for (const s of SECTIONS) {
    d[s.key] = {};
    for (const f of s.fields) {
      const lignes = f.lignesFixes || f.defaultRows;
      if (lignes) d[s.key][f.key] = lignes.map((l) => ({ [f.columns[0].key]: l }));
      else if (f.default !== undefined) d[s.key][f.key] = f.default;
    }
  }
  return d;
}

module.exports = { SECTIONS, normalize, synthese, ficheVide, champ, dureeMois, RUBRIQUES_COUTS, SOURCES, RECURRENTS, ETAPES };

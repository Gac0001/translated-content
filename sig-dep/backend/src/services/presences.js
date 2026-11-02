'use strict';
/**
 * Présences journalières (cahier des charges, sections 25 et 46, annexe 11) : agents de la
 * Direction regroupés par structure dans l’ordre de l’organigramme (I. Direction, I.1 Secrétariat
 * de Direction, I.2 première Division puis I.2.1, I.2.2 ses Bureaux…), répartis entre la liste
 * des Cadres (Chef de Bureau et au-dessus) et celle des Agents ; retards calculés d’après les
 * horaires de référence ; valeurs effectives après rectificatifs validés.
 */
const db = require('../db/knex');

const JOURS = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi'];
const MOTIFS = {
  MISSION: 'Mission', CONGE: 'Congé', MALADIE: 'Maladie', PERMISSION: 'Permission', FORMATION: 'Formation', ABSENT_NON_JUSTIFIE: 'Absent non justifié',
};
const CATEGORIES = { CADRES: 'Cadres', AGENTS: 'Agents' };
const NIVEAU_CADRE = 70; // Chef de Bureau

/** Date ISO (AAAA-MM-JJ) → objet Date à midi UTC (sans effet de fuseau). */
const enDate = (iso) => new Date(`${String(iso).slice(0, 10)}T12:00:00Z`);
const iso = (d) => d.toISOString().slice(0, 10);
const ajouterJours = (isoDate, n) => { const d = enDate(isoDate); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
/** Date du jour à Kinshasa. */
const aujourdhui = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Kinshasa' });

function lundiDe(isoDate) {
  const d = enDate(isoDate);
  const j = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() - (j - 1));
  return iso(d);
}
const joursOuvrables = (lundi) => [0, 1, 2, 3, 4].map((k) => ajouterJours(lundi, k));
function semaineIso(lundi) {
  const d = enDate(ajouterJours(lundi, 3)); // jeudi de la semaine
  const debutAnnee = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return { annee: d.getUTCFullYear(), numero: Math.ceil(((d - debutAnnee) / 86400000 + 1) / 7) };
}
const estOuvrable = (isoDate) => { const j = enDate(isoDate).getUTCDay(); return j >= 1 && j <= 5; };

async function horaires(trx = db) {
  const rows = await trx('parametres').whereIn('cle', ['presence_heure_arrivee', 'presence_heure_depart', 'presence_tolerance_minutes']);
  const v = Object.fromEntries(rows.map((r) => [r.cle, r.valeur]));
  return { arrivee: v.presence_heure_arrivee || '08:00', depart: v.presence_heure_depart || '15:30', tolerance: Number(v.presence_tolerance_minutes ?? 15) };
}

async function feries(debut, fin, trx = db) {
  const rows = await trx('jours_feries').whereBetween('date', [debut, fin]);
  return Object.fromEntries(rows.map((r) => [iso(new Date(r.date)), r.libelle]));
}

const minutes = (h) => { const [a, b] = String(h).split(':').map(Number); return a * 60 + b; };
/** Retard en minutes : arrivée au-delà de l’heure normale augmentée de la tolérance (compté depuis l’heure normale). */
function retard(arrivee, ref, tolerance) {
  if (!arrivee) return 0;
  const ecart = minutes(arrivee) - minutes(ref);
  return ecart > tolerance ? ecart : 0;
}

/** État d’une ligne : NON_RENSEIGNE, INCOMPLET (heure de départ manquante), ABSENT, RETARD, PRESENT. */
function etat(l) {
  if (l.motif) return 'ABSENT';
  if (!l.heure_arrivee) return 'NON_RENSEIGNE';
  if (!l.heure_depart) return 'INCOMPLET';
  return l.retard_minutes > 0 ? 'RETARD' : 'PRESENT';
}

/**
 * Agents en fonction à la Direction, avec leur regroupement (annexe 11) et leur catégorie.
 * Renvoie [{ agent_id, nom, grade_code, categorie, structure_code, structure_libelle, ordre_structure, division_id, bureau_id }].
 */
async function agentsEligibles(trx = db) {
  const dep = await trx('directions').where({ code: 'DEP' }).first();
  const [divisions, bureaux] = await Promise.all([trx('divisions').orderBy(['ordre', 'id']), trx('bureaux').orderBy(['ordre', 'id'])]);
  const groupes = new Map();
  groupes.set('DIR', { code: 'I', libelle: 'Direction', rang: [0] });
  const bsd = bureaux.find((b) => b.est_secretariat_direction);
  if (bsd) groupes.set(`B${bsd.id}`, { code: 'I.1', libelle: bsd.nom, rang: [1] });
  divisions.forEach((d, i) => {
    groupes.set(`D${d.id}`, { code: `I.${i + 2}`, libelle: d.nom, rang: [i + 2, 0] });
    bureaux.filter((b) => b.division_id === d.id && !b.est_secretariat_direction).forEach((b, j) => groupes.set(`B${b.id}`, { code: `I.${i + 2}.${j + 1}`, libelle: b.nom, rang: [i + 2, j + 1] }));
  });
  const autres = bureaux.filter((b) => !b.est_secretariat_direction && !b.division_id);
  autres.forEach((b, j) => groupes.set(`B${b.id}`, { code: `I.${divisions.length + 2 + j}`, libelle: b.nom, rang: [divisions.length + 2 + j] }));
  const rows = await trx('affectations as a').join('agents as ag', 'ag.id', 'a.agent_id').leftJoin('grades as g', 'g.id', 'ag.grade_id')
    .where('a.est_active', true).whereNull('ag.archived_at').modify((q) => { if (dep) q.where('a.direction_id', dep.id); })
    .select('ag.id as agent_id', 'ag.matricule', 'ag.nom', 'ag.postnom', 'ag.prenom', 'g.code as grade_code', 'g.niveau as grade_niveau', 'a.division_id', 'a.bureau_id');
  const vus = new Set();
  const out = [];
  for (const r of rows) {
    if (vus.has(r.agent_id)) continue;
    vus.add(r.agent_id);
    const g = (r.bureau_id && groupes.get(`B${r.bureau_id}`)) || (r.division_id && groupes.get(`D${r.division_id}`)) || groupes.get('DIR');
    out.push({
      ...r, categorie: (r.grade_niveau || 0) >= NIVEAU_CADRE ? 'CADRES' : 'AGENTS', structure_code: g.code, structure_libelle: g.libelle, rang: g.rang,
      nom_complet: [r.nom, r.postnom, r.prenom].filter(Boolean).join(' '),
    });
  }
  const cmp = (a, b) => { for (let k = 0; k < Math.max(a.length, b.length); k += 1) { const d = (a[k] ?? -1) - (b[k] ?? -1); if (d) return d; } return 0; };
  return out.sort((a, b) => cmp(a.rang, b.rang) || (b.grade_niveau || 0) - (a.grade_niveau || 0) || a.nom_complet.localeCompare(b.nom_complet, 'fr'));
}

/** Lignes d’une liste, avec nom et grade, dans l’ordre de l’annexe 11. */
async function lignesListe(listeId, trx = db) {
  return trx('presence_lignes as l').join('agents as ag', 'ag.id', 'l.agent_id').where('l.liste_id', listeId)
    .orderBy(['l.ordre', 'l.id'])
    .select('l.*', 'ag.matricule', db.raw(`concat_ws(' ', ag.nom, ag.postnom, ag.prenom) as nom_complet`));
}

/** Valeurs effectives : rectificatifs validés appliqués, dans l’ordre de leur validation. */
function appliquerRectificatifs(lignes, rectificatifs) {
  const valides = rectificatifs.filter((r) => r.statut === 'VALIDE').sort((a, b) => new Date(a.decide_at) - new Date(b.decide_at));
  if (!valides.length) return lignes;
  const parAgent = new Map(lignes.map((l) => [l.agent_id, { ...l }]));
  for (const r of valides) {
    for (const x of r.lignes) {
      const l = parAgent.get(x.agent_id);
      if (l) Object.assign(l, { heure_arrivee: x.heure_arrivee, heure_depart: x.heure_depart, motif: x.motif, piece_id: x.piece_id ?? null, observation: x.observation ?? l.observation, retard_minutes: x.retard_minutes, rectifiee: r.reference });
    }
  }
  return [...parAgent.values()];
}

/** Bilan d’une liste : total, renseignés, absents par motif, retards. */
function bilan(lignes) {
  const b = { total: lignes.length, renseignes: 0, presents: 0, retards: 0, absents: 0, non_renseignes: 0, incomplets: 0, motifs: {} };
  for (const l of lignes) {
    const e = etat(l);
    if (e === 'NON_RENSEIGNE') b.non_renseignes += 1;
    else if (e === 'INCOMPLET') b.incomplets += 1;
    else b.renseignes += 1;
    if (e === 'ABSENT') { b.absents += 1; b.motifs[l.motif] = (b.motifs[l.motif] || 0) + 1; }
    if (e === 'PRESENT' || e === 'RETARD' || e === 'INCOMPLET') b.presents += 1;
    if (l.retard_minutes > 0 && !l.motif) b.retards += 1;
  }
  return b;
}

/** Lignes effectives (rectificatifs validés appliqués) des listes données, filtrées par structure. */
async function lignesEffectives(listeIds, { divisionId = null, bureauId = null } = {}, trx = db) {
  if (!listeIds.length) return [];
  const [lignes, rects] = await Promise.all([
    trx('presence_lignes').whereIn('liste_id', listeIds),
    trx('presence_rectificatifs').whereIn('liste_id', listeIds).where({ statut: 'VALIDE' }),
  ]);
  let out = listeIds.flatMap((id) => appliquerRectificatifs(lignes.filter((l) => l.liste_id === id), rects.filter((r) => r.liste_id === id)));
  if (divisionId) out = out.filter((l) => l.division_id === divisionId);
  if (bureauId) out = out.filter((l) => l.bureau_id === bureauId);
  return out;
}

/** Répartition des agent-jours (présents à l’heure, retards, absences par motif) et taux de présence (présents sur renseignés). */
function synthese(lignes) {
  const b = bilan(lignes);
  return { repartition: { PRESENT: b.presents - b.retards, RETARD: b.retards, ...b.motifs }, bilan: b, tauxPresence: b.renseignes ? Math.round((b.presents / b.renseignes) * 100) : null };
}

/** Synthèse du dernier rapport hebdomadaire transmis, éventuellement limitée à une Division ou un Bureau. */
async function syntheseDerniereSemaine(filtre = {}, trx = db) {
  const s = await trx('presence_semaines').whereNot('statut', 'EN_PREPARATION').orderBy('semaine_debut', 'desc').first();
  if (!s) return null;
  const ids = await trx('presence_listes').where({ semaine_id: s.id }).pluck('id');
  return { id: s.id, semaine: iso(new Date(s.semaine_debut)), reference: s.reference, statut: s.statut, ...synthese(await lignesEffectives(ids, filtre, trx)) };
}

/** Synthèse des listes transmises d’une période (rapports d’activités). */
async function synthesePeriode({ du, au, divisionId = null, bureauId = null }, trx = db) {
  const ids = await trx('presence_listes').whereBetween('date', [du, au]).whereNot('statut', 'BROUILLON').pluck('id');
  return synthese(await lignesEffectives(ids, { divisionId, bureauId }, trx));
}

/** Agrégat d’agent-jours : présents (dont retards), minutes de retard, absences par motif, taux de présence. */
function agreger(lignes) {
  const a = { jours: 0, renseignes: 0, presents: 0, retards: 0, minutes_retard: 0, absents: 0, motifs: {} };
  for (const l of lignes) {
    a.jours += 1;
    const e = etat(l);
    if (e === 'NON_RENSEIGNE') continue;
    a.renseignes += 1;
    if (e === 'ABSENT') { a.absents += 1; a.motifs[l.motif] = (a.motifs[l.motif] || 0) + 1; continue; }
    a.presents += 1;
    if (l.retard_minutes > 0) { a.retards += 1; a.minutes_retard += l.retard_minutes; }
  }
  a.taux = a.renseignes ? Math.round((a.presents / a.renseignes) * 1000) / 10 : null;
  a.taux_ponctualite = a.presents ? Math.round(((a.presents - a.retards) / a.presents) * 1000) / 10 : null;
  return a;
}

/**
 * Synthèse mensuelle des présences (listes transmises, valeurs effectives) : ensemble de la
 * Direction, par structure (regroupement de l’annexe 11), par agent (si `nominatif`) et par jour.
 * `divisionId` / `bureauId` limitent la synthèse à une structure (consultation des Chefs).
 */
async function syntheseMensuelle({ mois, divisionId = null, bureauId = null, nominatif = true }, trx = db) {
  const du = `${mois}-01`;
  const fin = new Date(Date.UTC(Number(mois.slice(0, 4)), Number(mois.slice(5, 7)), 0));
  const au = iso(fin);
  const [listes, feriesMois] = await Promise.all([
    trx('presence_listes').whereBetween('date', [du, au]).whereNot('statut', 'BROUILLON').select('id', 'date', 'categorie'),
    feries(du, au, trx),
  ]);
  const dateListe = new Map(listes.map((l) => [l.id, iso(new Date(l.date))]));
  const lignes = await lignesEffectives(listes.map((l) => l.id), { divisionId, bureauId }, trx);
  let ouvrables = 0;
  for (let d = du; d <= au; d = ajouterJours(d, 1)) if (estOuvrable(d) && !feriesMois[d]) ouvrables += 1;
  const grouper = (cle) => {
    const m = new Map();
    for (const l of lignes) { const k = cle(l); if (!m.has(k)) m.set(k, []); m.get(k).push(l); }
    return m;
  };
  const structures = [...grouper((l) => `${l.structure_code}|${l.structure_libelle}`).entries()]
    .map(([k, ls]) => { const [code, libelle] = k.split('|'); return { code, libelle, effectif: new Set(ls.map((x) => x.agent_id)).size, ...agreger(ls) }; })
    .sort((a, b) => a.code.localeCompare(b.code, 'fr', { numeric: true }));
  const jours = [...grouper((l) => dateListe.get(l.liste_id)).entries()].map(([date, ls]) => ({ date, ...agreger(ls) })).sort((a, b) => a.date.localeCompare(b.date));
  let agents = null;
  if (nominatif) {
    const parAgent = grouper((l) => l.agent_id);
    const noms = parAgent.size ? await trx('agents').whereIn('id', [...parAgent.keys()]).select('id', db.raw(`concat_ws(' ', nom, postnom, prenom) as nom_complet`)) : [];
    const nom = new Map(noms.map((x) => [x.id, x.nom_complet]));
    agents = [...parAgent.entries()].map(([id, ls]) => {
      const der = ls[ls.length - 1];
      return { agent_id: id, nom_complet: nom.get(id), grade_code: der.grade_code, structure_code: der.structure_code, structure_libelle: der.structure_libelle, ordre: der.ordre, ...agreger(ls) };
    }).sort((a, b) => a.structure_code.localeCompare(b.structure_code, 'fr', { numeric: true }) || a.ordre - b.ordre);
  }
  return { mois, du, au, jours_ouvrables: ouvrables, feries: feriesMois, jours_couverts: new Set(listes.map((l) => dateListe.get(l.id))).size, global: agreger(lignes), structures, jours, agents };
}

module.exports = {
  syntheseMensuelle, agreger,
  syntheseDerniereSemaine, synthesePeriode, lignesEffectives, synthese,
  JOURS, MOTIFS, CATEGORIES, NIVEAU_CADRE, lundiDe, joursOuvrables, semaineIso, estOuvrable, ajouterJours, aujourdhui, iso,
  horaires, feries, retard, etat, agentsEligibles, lignesListe, appliquerRectificatifs, bilan,
};

'use strict';
/**
 * Effectif organique de référence et effectif réel (cahier des charges, § 8).
 * La référence (20 postes) ne bloque jamais l’enregistrement des Agents : elle sert à mesurer
 * les écarts, les vacances et les sureffectifs.
 *
 * Effectif réel : Agents non archivés, hors autorités (Secrétaire Général), en activité, en congé
 * ou suspendus, ayant une affectation active dans la Direction. Chaque Agent est compté une seule
 * fois : d’abord par sa fonction (ex. Huissier), sinon par son grade.
 */
const db = require('../db/knex');

const STATUTS_EFFECTIF = ['ACTIF', 'CONGE', 'SUSPENDU'];

function situation(ecart) {
  if (ecart === 0) return 'CONFORME';
  return ecart < 0 ? 'VACANCE' : 'SUREFFECTIF';
}

async function effectifReel() {
  return db('agents as ag')
    .join('affectations as a', function j() { this.on('a.agent_id', 'ag.id').andOn('a.est_active', db.raw('true')); })
    .leftJoin('grades as g', 'g.id', 'ag.grade_id')
    .leftJoin('fonctions as f', 'f.id', 'ag.fonction_id')
    .whereNull('ag.archived_at').where('ag.est_autorite', false).whereIn('ag.statut', STATUTS_EFFECTIF)
    .select('ag.id', 'g.code as grade_code', 'g.libelle as grade', 'f.code as fonction_code');
}

/** Postes de commandement sans titulaire en fonction. */
async function postesVacants() {
  const postes = await db('postes_organiques as p')
    .leftJoin('divisions as d', 'd.id', 'p.division_id')
    .leftJoin('bureaux as b', 'b.id', 'p.bureau_id')
    .leftJoin('directions as r', 'r.id', 'p.direction_id')
    .where('p.actif', true).whereIn('p.role_associe', ['DIRECTEUR', 'CHEF_DIVISION', 'CHEF_BUREAU'])
    .where((q) => q.whereNull('p.bureau_id').orWhere('b.actif', true))
    .where((q) => q.whereNull('p.division_id').orWhereNotNull('p.bureau_id').orWhere('d.actif', true))
    .select('p.id', 'p.code', 'p.libelle', 'p.role_associe', 'p.niveau',
      db.raw('COALESCE(b.code_organique, CASE WHEN p.bureau_id IS NULL THEN d.code_organique END, CASE WHEN p.division_id IS NULL AND p.bureau_id IS NULL THEN r.code_organique END) as code_organique'),
      db.raw('COALESCE(b.nom, d.nom, r.nom) as structure'));
  const occupes = new Set((await db('affectations').where({ est_active: true }).whereNotNull('poste_id').select('poste_id')).map((r) => r.poste_id));
  return postes.filter((p) => !occupes.has(p.id))
    .map((p) => ({ posteId: p.id, poste: p.libelle, role: p.role_associe, structure: p.structure, codeOrganique: p.code_organique }))
    .sort((a, b) => String(a.codeOrganique || '').localeCompare(String(b.codeOrganique || ''), 'fr', { numeric: true }));
}

/** Structures dans l’ordre de l’organigramme : Direction, Secrétariat de Direction, chaque Division puis ses Bureaux. */
async function structures(trx = db) {
  const [divisions, bureaux] = await Promise.all([
    trx('divisions').where({ actif: true }).orderBy(['ordre', 'id']).select('id', 'code', 'nom', 'code_organique'),
    trx('bureaux').where({ actif: true }).orderBy(['ordre', 'id']).select('id', 'code', 'nom', 'code_organique', 'division_id', 'est_secretariat_direction'),
  ]);
  const out = [{ code: 'DIRECTION', nom: 'Direction (Directeur)', type: 'DIRECTION', niveau: 0 }];
  for (const b of bureaux.filter((x) => x.est_secretariat_direction || !x.division_id)) out.push({ code: b.code, nom: b.nom, code_organique: b.code_organique, type: 'BUREAU', bureau_id: b.id, niveau: 1 });
  for (const d of divisions) {
    out.push({ code: d.code, nom: d.nom, code_organique: d.code_organique, type: 'DIVISION', division_id: d.id, niveau: 1 });
    for (const b of bureaux.filter((x) => x.division_id === d.id && !x.est_secretariat_direction)) out.push({ code: b.code, nom: b.nom, code_organique: b.code_organique, type: 'BUREAU', bureau_id: b.id, division_id: d.id, niveau: 2 });
  }
  return out;
}

/**
 * Effectif par structure et par grade (cahier, §§ 10 et 11) : effectif organique (postes d’emploi)
 * et effectif réel de chaque structure, par grade ; vacances et sureffectifs ; promus en attente
 * de poste et intérims actifs. Les groupes de travail ne comptent jamais dans l’effectif.
 */
async function parStructure(trx = db) {
  const [liste, organique, grades, agents, interims, promus] = await Promise.all([
    structures(trx),
    trx('effectif_structure').select('structure_code', 'critere_type', 'critere_code', 'nombre'),
    trx('grades').orderBy('niveau', 'desc').select('code', 'code_officiel', 'abreviation', 'libelle'),
    trx('agents as ag')
      .join('affectations as a', function j() { this.on('a.agent_id', 'ag.id').andOn('a.est_active', trx.raw('true')); })
      .leftJoin('grades as g', 'g.id', 'ag.grade_id').leftJoin('fonctions as f', 'f.id', 'ag.fonction_id')
      .whereNull('ag.archived_at').where('ag.est_autorite', false).whereIn('ag.statut', STATUTS_EFFECTIF)
      .select('ag.id', 'g.code as grade_code', 'f.code as fonction_code', 'a.niveau', 'a.division_id', 'a.bureau_id'),
    require('./interims').interimsEnVigueur(trx),
    require('./carriere').promusEnAttente(trx),
  ]);
  const cleStructure = (a) => {
    if (a.bureau_id) return liste.find((s) => s.bureau_id === a.bureau_id)?.code;
    if (a.division_id) return liste.find((s) => s.type === 'DIVISION' && s.division_id === a.division_id)?.code;
    return 'DIRECTION';
  };
  // Une ligne par structure et par catégorie d’emploi (grade, ou fonction pour le Huissier)
  const critere = (a) => (a.fonction_code === 'F-HUI' ? 'F-HUI' : a.grade_code || 'SANS_GRADE');
  const libelle = (c) => (c === 'F-HUI' ? 'HUI — Huissier' : c === 'SANS_GRADE' ? 'Grade non renseigné' : (() => { const g = grades.find((x) => x.code === c); return g ? `${g.code_officiel} — ${g.libelle}` : c; })());
  const rang = (c) => (c === 'F-HUI' ? 98 : c === 'SANS_GRADE' ? 99 : grades.findIndex((x) => x.code === c));
  const reel = new Map();
  for (const a of agents) {
    const k = `${cleStructure(a) || 'DIRECTION'}|${critere(a)}`;
    reel.set(k, (reel.get(k) || 0) + 1);
  }
  const lignes = [];
  for (const s of liste) {
    const prevu = new Map(organique.filter((o) => o.structure_code === s.code).map((o) => [o.critere_code, o.nombre]));
    const criteres = new Set([...prevu.keys(), ...[...reel.keys()].filter((k) => k.startsWith(`${s.code}|`)).map((k) => k.split('|')[1])]);
    const detail = [...criteres].sort((a, b) => rang(a) - rang(b)).map((c) => {
      const p = prevu.get(c) || 0; const r = reel.get(`${s.code}|${c}`) || 0;
      return { critere: c, libelle: libelle(c), prevu: p, reel: r, ecart: r - p, situation: situation(r - p) };
    });
    const tot = (k) => detail.reduce((t, d) => t + d[k], 0);
    lignes.push({
      ...s, detail, prevu: tot('prevu'), reel: tot('reel'),
      vacances: detail.reduce((t, d) => t + Math.max(0, -d.ecart), 0), sureffectifs: detail.reduce((t, d) => t + Math.max(0, d.ecart), 0),
    });
  }
  // Tableau croisé structure × grade
  const colonnes = [...new Set(lignes.flatMap((l) => l.detail.map((d) => d.critere)))].sort((a, b) => rang(a) - rang(b)).map((c) => ({ critere: c, libelle: libelle(c) }));
  const total = (k) => lignes.reduce((t, l) => t + l[k], 0);
  return {
    structures: lignes, colonnes,
    totaux: { prevu: total('prevu'), reel: total('reel'), vacances: total('vacances'), sureffectifs: total('sureffectifs'), promus: promus.length, interims: interims.length },
    promusEnAttente: promus,
    interimsActifs: interims.map((i) => ({ acteId: i.acte_id, numero: i.numero, poste: i.poste_libelle, interimaire: i.interimaire, dateFin: i.date_fin })),
  };
}

async function synthese() {
  const [reference, agents, vacants] = await Promise.all([
    db('effectif_reference').orderBy('ordre'),
    effectifReel(),
    postesVacants(),
  ]);
  const comptes = new Map(reference.map((r) => [r.id, 0]));
  const horsReference = new Map();
  const parFonction = reference.filter((r) => r.critere_type === 'FONCTION');
  const parGrade = reference.filter((r) => r.critere_type === 'GRADE');
  for (const a of agents) {
    const ligne = parFonction.find((r) => r.critere_code === a.fonction_code) || parGrade.find((r) => r.critere_code === a.grade_code);
    if (ligne) comptes.set(ligne.id, comptes.get(ligne.id) + 1);
    else {
      const cle = a.grade || 'Grade non renseigné';
      horsReference.set(cle, (horsReference.get(cle) || 0) + 1);
    }
  }
  const lignes = reference.map((r) => {
    const reel = comptes.get(r.id);
    return {
      id: r.id, code: r.code, libelle: r.libelle, critereType: r.critere_type, critereCode: r.critere_code,
      prevu: r.nombre, reel, ecart: reel - r.nombre, situation: situation(reel - r.nombre),
    };
  });
  const prevu = lignes.reduce((s, l) => s + l.prevu, 0);
  const dansReference = lignes.reduce((s, l) => s + l.reel, 0);
  const hors = [...horsReference.entries()].map(([grade, nombre]) => ({ grade, nombre })).sort((a, b) => b.nombre - a.nombre);
  return {
    lignes,
    horsReference: hors,
    totaux: {
      prevu,
      reel: agents.length,
      dansReference,
      horsReference: agents.length - dansReference,
      ecart: agents.length - prevu,
      vacances: lignes.reduce((s, l) => s + Math.max(0, -l.ecart), 0),
      sureffectifs: lignes.reduce((s, l) => s + Math.max(0, l.ecart), 0),
    },
    postesVacants: vacants,
    source: reference[0]?.source || null,
  };
}

module.exports = { synthese, parStructure, structures, postesVacants, situation, STATUTS_EFFECTIF };

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

module.exports = { synthese, postesVacants, situation, STATUTS_EFFECTIF };

'use strict';
/**
 * Seed 01 — Organigramme de la Direction d’Études et Planification, grades, fonctions,
 * postes organiques, missions et attributions. Idempotent (peut être relancé sans perte).
 */
const { DIRECTION, SECRETARIAT, DIVISIONS, MISSIONS_DEP, RESPONSABILITES, GRADES, FONCTIONS } = require('../seed-data/organisation');

async function upsert(knex, table, row, key = 'code') {
  const [r] = await knex(table).insert(row).onConflict(key).merge().returning('*');
  return r;
}

async function attribution(knex, row) {
  const exists = await knex('attributions').where({
    cible_type: row.cible_type, categorie: row.categorie, libelle: row.libelle,
    direction_id: row.direction_id ?? null, division_id: row.division_id ?? null,
    bureau_id: row.bureau_id ?? null, role_code: row.role_code ?? null,
  }).first();
  if (!exists) await knex('attributions').insert(row);
}

exports.seed = async function seed(knex) {
  const dep = await upsert(knex, 'directions', DIRECTION);

  for (const g of GRADES) await upsert(knex, 'grades', g);
  const grades = Object.fromEntries((await knex('grades')).map((g) => [g.code, g.id]));
  for (const f of FONCTIONS) {
    await upsert(knex, 'fonctions', { code: f.code, libelle: f.libelle, grade_id: grades[f.grade] });
  }

  // Poste de Directeur
  await upsert(knex, 'postes_organiques', {
    code: 'P-DIR', libelle: 'Directeur de la Direction d’Études et Planification', niveau: 'DIRECTION',
    role_associe: 'DIRECTEUR', direction_id: dep.id, grade_minimum_id: grades.DIR,
  });

  // Bureau Secrétariat de Direction : rang BUREAU, rattaché directement à la Direction
  const bsd = await upsert(knex, 'bureaux', {
    code: SECRETARIAT.code, nom: SECRETARIAT.nom, direction_id: dep.id, division_id: null,
    type_structure: 'BUREAU', rang_organique: 'BUREAU', parent_type: 'DIRECTION',
    responsable_role: 'CHEF_BUREAU', perimetre_acces: 'BUREAU', superieur_direct: 'DIRECTEUR',
    est_secretariat_direction: true, missions: SECRETARIAT.missions, ordre: 0,
  });
  await upsert(knex, 'postes_organiques', { code: 'P-CB-BSD', libelle: 'Chef du Bureau Secrétariat de Direction', niveau: 'BUREAU', role_associe: 'CHEF_BUREAU', direction_id: dep.id, bureau_id: bsd.id, grade_minimum_id: grades.CB });
  await upsert(knex, 'postes_organiques', { code: 'P-AG-BSD', libelle: 'Agent du Bureau Secrétariat de Direction', niveau: 'BUREAU', role_associe: 'AGENT', direction_id: dep.id, bureau_id: bsd.id });
  for (const [i, a] of SECRETARIAT.attributions.entries()) {
    await attribution(knex, { cible_type: 'BUREAU', direction_id: dep.id, bureau_id: bsd.id, categorie: 'ATTRIBUTION', libelle: a, ordre: i });
  }

  for (const [di, d] of DIVISIONS.entries()) {
    const div = await upsert(knex, 'divisions', {
      code: d.code, nom: d.nom, direction_id: dep.id, missions: d.missions, ordre: di + 1,
    });
    await upsert(knex, 'postes_organiques', { code: `P-CD-${d.code}`, libelle: `Chef de ${d.nom}`, niveau: 'DIVISION', role_associe: 'CHEF_DIVISION', direction_id: dep.id, division_id: div.id, grade_minimum_id: grades.CD });
    for (const [i, a] of d.attributions.entries()) {
      await attribution(knex, { cible_type: 'DIVISION', direction_id: dep.id, division_id: div.id, categorie: 'ATTRIBUTION', libelle: a, ordre: i });
    }
    for (const [bi, b] of d.bureaux.entries()) {
      const bur = await upsert(knex, 'bureaux', {
        code: b.code, nom: b.nom, direction_id: dep.id, division_id: div.id,
        type_structure: 'BUREAU', rang_organique: 'BUREAU', parent_type: 'DIVISION',
        responsable_role: 'CHEF_BUREAU', perimetre_acces: 'BUREAU', superieur_direct: 'CHEF_DIVISION',
        est_secretariat_direction: false, missions: b.missions, ordre: bi + 1,
      });
      await upsert(knex, 'postes_organiques', { code: `P-CB-${b.code}`, libelle: `Chef du ${b.nom}`, niveau: 'BUREAU', role_associe: 'CHEF_BUREAU', direction_id: dep.id, division_id: div.id, bureau_id: bur.id, grade_minimum_id: grades.CB });
      await upsert(knex, 'postes_organiques', { code: `P-AG-${b.code}`, libelle: `Agent du ${b.nom}`, niveau: 'BUREAU', role_associe: 'AGENT', direction_id: dep.id, division_id: div.id, bureau_id: bur.id });
      for (const [i, a] of b.attributions.entries()) {
        await attribution(knex, { cible_type: 'BUREAU', direction_id: dep.id, division_id: div.id, bureau_id: bur.id, categorie: 'ATTRIBUTION', libelle: a, ordre: i });
      }
    }
  }

  for (const [i, m] of MISSIONS_DEP.entries()) {
    await attribution(knex, { cible_type: 'DIRECTION', direction_id: dep.id, categorie: 'MISSION', libelle: m, ordre: i });
  }
  for (const [role, list] of Object.entries(RESPONSABILITES)) {
    for (const [i, r] of list.entries()) {
      await attribution(knex, { cible_type: 'ROLE', direction_id: dep.id, role_code: role, categorie: 'RESPONSABILITE', libelle: r, ordre: i });
    }
  }

  const params = [
    ['pays', 'République Démocratique du Congo', 'Pays'],
    ['autorite_tutelle', 'Secrétariat Général à l’Économie Numérique', 'Autorité de tutelle'],
    ['direction_nom', 'Direction d’Études et Planification', 'Appellation officielle de la Direction'],
    ['direction_sigle', 'DEP', 'Sigle'],
    ['ville', 'Kinshasa', 'Ville'],
    ['heure_arrivee', '08:00', 'Heure officielle d’arrivée'],
    ['delai_rappel_echeance_heures', '48', 'Délai de rappel avant échéance (heures)'],
  ];
  for (const [cle, valeur, libelle] of params) {
    await knex('parametres').insert({ cle, valeur, libelle }).onConflict('cle').ignore();
  }
};

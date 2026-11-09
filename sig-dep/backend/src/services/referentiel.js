'use strict';
/**
 * Référentiel versionné (cahier des charges, § 24) : grades, postes d’emploi et effectif organique.
 * Chaque version consignée est un instantané intangible, avec sa source et sa date d’application.
 */
const db = require('../db/knex');

/** État courant du référentiel. */
async function instantane(trx = db) {
  return {
    grades: await trx('grades').orderBy('niveau', 'desc').select('code', 'code_officiel', 'abreviation', 'libelle', 'categorie', 'niveau', 'actif'),
    postes: await trx('postes_organiques as p').leftJoin('grades as g', 'g.id', 'p.grade_minimum_id').orderBy('p.id')
      .select('p.code', 'p.libelle', 'p.niveau', 'p.role_associe', 'g.code_officiel as grade_requis', 'p.actif'),
    effectif_reference: await trx('effectif_reference').orderBy('ordre').select('code', 'libelle', 'nombre', 'critere_type', 'critere_code'),
    effectif_structure: await trx('effectif_structure').orderBy('id').select('structure_code', 'critere_type', 'critere_code', 'nombre'),
  };
}

/** Sérialisation à clés triées (PostgreSQL réordonne les clés des objets jsonb). */
const stable = (o) => JSON.stringify(Object.keys(o).sort().map((k) => [k, o[k]]));

/** Différences entre deux contenus du référentiel (éléments ajoutés, retirés ou modifiés). */
function differences(avant, apres) {
  const cles = { grades: (x) => x.code, postes: (x) => x.code, effectif_reference: (x) => x.code, effectif_structure: (x) => `${x.structure_code}/${x.critere_code}` };
  const out = [];
  for (const [partie, cle] of Object.entries(cles)) {
    const a = new Map((avant?.[partie] || []).map((x) => [cle(x), x]));
    const b = new Map((apres?.[partie] || []).map((x) => [cle(x), x]));
    for (const [k, x] of b) {
      if (!a.has(k)) out.push({ partie, element: k, nature: 'AJOUT', apres: x });
      else if (stable(a.get(k)) !== stable(x)) out.push({ partie, element: k, nature: 'MODIFICATION', avant: a.get(k), apres: x });
    }
    for (const [k, x] of a) if (!b.has(k)) out.push({ partie, element: k, nature: 'RETRAIT', avant: x });
  }
  return out;
}

const SOURCE_INITIALE = 'Cadre organique de la Direction d’Études et Planification (cahier des charges fonctionnel v2, §§ 9 et 10)';

/** Version 1 consignée au chargement initial du référentiel (si aucune version n’existe). */
async function versionInitiale(trx = db) {
  if (await trx('referentiel_versions').first('id')) return null;
  if (!(await trx('postes_organiques').first('id'))) return null;
  const [v] = await trx('referentiel_versions').insert({
    numero: 1, source: SOURCE_INITIALE, date_application: '2026-10-09', observation: 'Version initiale chargée au démarrage.', contenu: JSON.stringify(await instantane(trx)),
  }).returning('*');
  return v;
}

module.exports = { instantane, differences, versionInitiale, SOURCE_INITIALE };

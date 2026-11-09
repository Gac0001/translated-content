'use strict';
/**
 * Vérification de l’intégrité du journal d’audit chaîné.
 * Recalcule l’empreinte de chaque entrée et contrôle l’enchaînement : une modification,
 * une suppression ou une insertion directe en base est détectée. Une ancre (dernier maillon
 * vérifié) est conservée pour détecter aussi la disparition d’entrées en fin de chaîne.
 */
const db = require('../db/knex');

async function verifier() {
  const [{ total, dernier }] = (await db.raw(`select count(*)::int as total, coalesce(max(maillon), 0)::int as dernier from audit_logs`)).rows;
  const ruptures = (await db.raw(`
    select maillon, id, created_at,
      case when empreinte is distinct from audit_empreinte(a) then 'Contenu modifié'
           when empreinte_precedente is distinct from coalesce(lag(empreinte) over (order by maillon), repeat('0', 64)) then 'Chaînage rompu (entrée supprimée ou insérée)'
      end as raison
    from audit_logs a where maillon is not null order by maillon`)).rows.filter((r) => r.raison);
  const problemes = ruptures.slice(0, 20).map((r) => ({ maillon: Number(r.maillon), id: Number(r.id), date: r.created_at, raison: r.raison }));
  if (total !== dernier) problemes.push({ raison: `Numérotation discontinue : ${dernier} maillons attendus, ${total} présents (suppression d’entrées).` });
  // Ancre de la vérification précédente : la chaîne doit toujours la contenir.
  const ancre = await db('parametres').where({ cle: 'audit_ancre' }).first();
  if (ancre && ancre.valeur) {
    const a = JSON.parse(ancre.valeur);
    const row = await db('audit_logs').where({ maillon: a.maillon }).first('empreinte');
    if (!row || row.empreinte !== a.empreinte) problemes.push({ maillon: a.maillon, raison: 'Le dernier maillon vérifié précédemment a disparu ou a changé (troncature du journal).' });
  }
  const integre = problemes.length === 0;
  if (integre && dernier) {
    const last = await db('audit_logs').where({ maillon: dernier }).first('empreinte');
    await db('parametres').insert({ cle: 'audit_ancre', valeur: JSON.stringify({ maillon: dernier, empreinte: last.empreinte, verifie_at: new Date().toISOString() }), libelle: 'Audit : dernier maillon vérifié' })
      .onConflict('cle').merge(['valeur', 'updated_at']);
  }
  return { integre, entrees: total, dernierMaillon: dernier, problemes, verifieAt: new Date().toISOString() };
}

module.exports = { verifier };

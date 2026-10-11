#!/usr/bin/env node
'use strict';
/**
 * Contrôle de préparation à la mise en production, à lancer sur le serveur avant l’ouverture puis après
 * chaque mise à jour :
 *   npm run verifier-production            → rapport lisible
 *   npm run verifier-production -- --json  → rapport JSON (supervision)
 * Code de sortie : 0 si aucun point bloquant, 1 sinon.
 */
const db = require('../src/db/knex');
const { verifier } = require('../src/services/preparation');

const SYMBOLES = { OK: '[ OK ]', ATTENTION: '[ !! ]', BLOQUANT: '[ KO ]', INFO: '[ -- ]' };
const couleur = process.stdout.isTTY && !process.env.NO_COLOR
  ? { OK: '\x1b[32m', ATTENTION: '\x1b[33m', BLOQUANT: '\x1b[31m', INFO: '\x1b[36m', fin: '\x1b[0m' }
  : { OK: '', ATTENTION: '', BLOQUANT: '', INFO: '', fin: '' };

(async () => {
  let code = 0;
  try {
    const r = await verifier();
    if (process.argv.includes('--json')) {
      console.log(JSON.stringify(r, null, 2));
    } else {
      console.log(`\nSIG-DEP ${r.version} — contrôle de préparation à la mise en production\n`);
      for (const [cle, titre] of Object.entries(r.groupes)) {
        const items = r.controles.filter((c) => c.groupe === cle);
        if (!items.length) continue;
        console.log(titre);
        for (const c of items) {
          console.log(`  ${couleur[c.statut]}${SYMBOLES[c.statut]}${couleur.fin} ${c.libelle} — ${c.detail}`);
          if (c.conseil) console.log(`         → ${c.conseil}`);
        }
        console.log('');
      }
      console.log(`Bilan : ${r.totaux.OK} conforme(s), ${r.totaux.ATTENTION} à surveiller, ${r.totaux.BLOQUANT} bloquant(s).`);
      console.log(r.pret ? 'Prêt pour la mise en service (corriger les points à surveiller dès que possible).' : 'NON PRÊT : corriger les points bloquants puis relancer ce contrôle.');
    }
    code = r.pret ? 0 : 1;
  } catch (e) {
    console.error('Contrôle impossible :', e.message);
    code = 2;
  } finally {
    await db.destroy();
  }
  process.exit(code);
})();

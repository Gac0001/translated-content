'use strict';
/**
 * Réinitialise l’environnement de démonstration : base vidée, migrations, données de démonstration
 * et scénario complet (réunions, PTBA, données sectorielles…), dates recalculées au jour même.
 * Usage : npm run demo:reset          (exige DEMO_MODE=true dans backend/.env)
 * Interdit en production. Toutes les données de la base sont effacées.
 */
process.env.SEED_DEMO = 'true';
const config = require('../src/config/env');

(async () => {
  if (config.isProd) { console.error('Refusé : la démonstration ne se réinitialise jamais en production.'); process.exit(1); }
  if (!config.demo) { console.error('Refusé : ajoutez DEMO_MODE=true dans backend/.env (environnement de démonstration uniquement).'); process.exit(1); }
  const knex = require('knex')(require('../knexfile')[config.env] || require('../knexfile').development);
  const t0 = Date.now();
  try {
    console.log('1/3 Effacement de la base…');
    await knex.migrate.rollback(undefined, true);
    console.log('2/3 Migrations…');
    await knex.migrate.latest();
    console.log('3/3 Données et scénario de démonstration (quelques secondes)…');
    await knex.seed.run();
    console.log(`Démonstration prête en ${Math.round((Date.now() - t0) / 1000)} s. Mot de passe de tous les comptes : Demo@2026 ; le code de double authentification s’affiche sur la page de connexion.`);
  } catch (e) {
    console.error('Échec :', e.message);
    process.exitCode = 1;
  } finally {
    await knex.destroy().catch(() => {});
  }
})();

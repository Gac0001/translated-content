#!/usr/bin/env node
'use strict';
/**
 * Opérations sur la base lancées par l’installateur (installer-serveur.js) depuis le dossier de la
 * version concernée, avec la configuration du serveur (SIGDEP_ENV_FILE). Réponse : une ligne JSON.
 *   etat                 → base joignable, migrations appliquées et en attente, dernier lot
 *   sauvegarder <motif>  → sauvegarde complète (chiffrée si BACKUP_ENC_KEY), enregistrée dans l’application
 *   migrer               → applique les migrations ; en cas d’échec, annule le lot entamé
 *   amorcer              → données de référence d’une base neuve (organigramme, rôles, compte Admin)
 *   annuler-lot <n>      → annule le lot de migrations n s’il est le dernier (retour à la version précédente)
 */
const db = require('../src/db/knex');

const repondre = (o) => process.stdout.write(`${JSON.stringify(o)}\n`);
const dernierLot = async () => {
  if (!(await db.schema.hasTable('knex_migrations'))) return 0;
  return Number((await db('knex_migrations').max('batch as b').first()).b || 0);
};

async function main() {
  const [commande, arg] = process.argv.slice(2);
  switch (commande) {
    case 'etat': {
      await db.raw('select 1');
      const [faites, attente] = await db.migrate.list();
      repondre({ ok: true, appliquees: faites.length, enAttente: attente.length, lot: await dernierLot(), neuve: faites.length === 0 });
      return 0;
    }
    case 'sauvegarder': {
      const { creerSauvegarde } = require('../src/services/sauvegarde');
      const r = await creerSauvegarde(arg || '-avant-mise-a-jour', { origine: 'MANUELLE' });
      repondre({ ok: true, fichier: r.fichier, chiffre: !!r.chiffre });
      return 0;
    }
    case 'migrer': {
      const avant = await dernierLot();
      try {
        const [lot, fichiers] = await db.migrate.latest();
        repondre({ ok: true, lot: fichiers.length ? lot : null, appliquees: fichiers });
        return 0;
      } catch (e) {
        // Chaque migration est dans sa transaction : celle qui échoue est annulée par PostgreSQL ; on
        // annule aussi celles du même lot déjà appliquées, pour revenir exactement à l’état d’avant.
        let annule = false;
        try {
          if ((await dernierLot()) > avant) { await db.migrate.rollback(); annule = true; }
        } catch (e2) {
          repondre({ ok: false, erreur: e.message, annulation: `impossible : ${e2.message}` });
          return 1;
        }
        repondre({ ok: false, erreur: e.message, annulation: annule ? 'lot annulé' : 'rien à annuler' });
        return 1;
      }
    }
    case 'amorcer': {
      const [fichiers] = await db.seed.run();
      repondre({ ok: true, seeds: fichiers.length });
      return 0;
    }
    case 'annuler-lot': {
      const n = Number(arg);
      if (!n || n !== (await dernierLot())) { repondre({ ok: false, erreur: `Le lot ${arg} n’est pas le dernier appliqué : annulation refusée.` }); return 1; }
      const [, fichiers] = await db.migrate.rollback();
      repondre({ ok: true, annulees: fichiers });
      return 0;
    }
    default:
      repondre({ ok: false, erreur: `Commande inconnue : ${commande || '(aucune)'}` });
      return 1;
  }
}

main()
  .catch((e) => { repondre({ ok: false, erreur: e.message }); return 1; })
  .then(async (code) => { await db.destroy().catch(() => {}); process.exit(code); });

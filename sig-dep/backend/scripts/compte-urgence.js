#!/usr/bin/env node
'use strict';
/**
 * Compte d’urgence du SIG-DEP — procédure serveur (dernier recours, lorsque ni le Directeur ni le
 * Secrétaire Général ne peuvent l’activer depuis l’application).
 *   npm run urgence -- activer 4 "Motif de l’intervention"   → active pour 4 heures (24 au plus)
 *   npm run urgence -- fermer                                 → referme et scelle le compte
 *   npm run urgence -- etat
 * Toute activation déclenche une alerte critique adressée à l’Admin, au Directeur et au SG,
 * et est inscrite dans le journal d’audit.
 */
const os = require('os');
const db = require('../src/db/knex');
const g = require('../src/services/gouvernance');

(async () => {
  const [action, heures, ...motif] = process.argv.slice(2);
  const par = `procédure serveur (${os.userInfo().username}@${os.hostname()})`;
  try {
    if (action === 'activer') {
      const r = await g.activerUrgence({ par, motif: motif.join(' '), heures: Number(heures) });
      await db('audit_logs').insert({ username: 'script', role: 'SYSTEME', action: 'ACTIVATION_URGENCE', module: 'gouvernance', entite: 'user', resultat: 'SUCCES', message: `Activation par ${par} : ${motif.join(' ')}` });
      console.log('Compte d’urgence activé.');
      console.log(`  Nom d’utilisateur : ${r.username}`);
      console.log(`  Mot de passe temporaire : ${r.motDePasseTemporaire}`);
      console.log(`  Fermeture automatique : ${new Date(r.jusqua).toLocaleString('fr-FR', { timeZone: 'Africa/Kinshasa' })}`);
      console.log('  À la connexion : nouveau mot de passe puis double authentification.');
    } else if (action === 'fermer') {
      const ok = await g.fermerUrgence({ par, motif: 'Fermeture par la procédure serveur' });
      console.log(ok ? 'Compte d’urgence refermé et scellé.' : 'Le compte d’urgence était déjà scellé.');
    } else if (action === 'etat') {
      const e = await g.etatUrgence();
      console.log(e.actif ? `Actif jusqu’au ${new Date(e.jusqua).toLocaleString('fr-FR', { timeZone: 'Africa/Kinshasa' })}` : 'Scellé (désactivé).');
    } else {
      console.log('Usage : npm run urgence -- activer <heures> "<motif>" | fermer | etat');
      process.exitCode = 1;
    }
  } catch (e) {
    console.error(`Échec : ${e.message}`);
    process.exitCode = 1;
  } finally {
    await db.destroy();
  }
})();

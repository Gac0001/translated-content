# SIG-DEP — consignes pour Claude Code

Ce fichier est lu par Claude Code à chaque session, sur le poste local (Windows) comme dans le cloud.
Il fixe la logique commune : toute session doit produire un travail compatible avec les autres.

## Le projet

Application web de la **Direction d’Études et Planification** (DEP, code 5.3.3) du Secrétariat
Général au Numérique (RDC). Interface et documentation **en français** ; répondre en français.

- `backend/` : Node.js 22, Express 5, Knex + PostgreSQL, Zod 4, JWT, TOTP (otplib). Modules dans
  `src/modules/<module>/routes.js`, logique partagée dans `src/services/`, migrations datées dans
  `src/db/migrations/`, seeds dans `src/db/seeds/`.
- `frontend/` : React 18, Vite, Tailwind, React Router, Zustand. Pages dans `src/pages/<module>/`,
  composants communs dans `src/components/ui` (DataTable, Card, Modal, Field, StatusBadge, Tabs…),
  libellés dans `src/lib/labels.js`.
- Version courante et historique : `CHANGELOG.md` ; documentation : `README.md`, `docs/`.

## Commandes (depuis `backend/` ; sous Windows dans Git Bash ou PowerShell)

| Besoin | Commande |
|---|---|
| Mettre à jour la copie locale (git, dépendances, migrations) | `npm run mise-a-jour` (ajouter `-- --demo` pour recharger la démonstration, `-- --tests` pour lancer les tests) |
| Démarrer l’API / l’interface | `npm run dev` (backend), `npm run dev` (frontend) |
| Migrations | `npm run migrate` |
| Recharger la démonstration complète | `npm run demo:reset` (exige `DEMO_MODE=true` dans `backend/.env`) |
| Tests | `npm test` (base `sig_dep_test`, recréée à chaque lancement) |
| Construire l’interface | `npm run build` (frontend) |

## Règles impératives

1. **Données personnelles** : le dépôt est public. Ne jamais y mettre de vrais noms, matricules,
   photos, signatures, ni le contenu réel des documents du Ministère (PAP, PTBA, montants, noms de
   responsables). Les fichiers réels restent hors du dépôt et ne servent qu’à des essais locaux.
   Les données de démonstration sont **fictives** et le restent. Avant chaque commit, relire le diff
   (`git diff --cached`) pour s’en assurer.
2. **Cadre organique** : appellation officielle « Direction d’Études et Planification ». Le
   **Bureau Secrétariat de Direction** (BSD) est de **rang Bureau**, rattaché au Directeur ; ce
   n’est jamais une Division. Les permissions liées à une structure sont accordées dans
   `src/services/context.js` (ex. Bureau Programme → PTBA, Bureau Documentation et Information →
   annuaire et contrôle des données) ; les permissions de rôle dans une migration **et** dans
   `src/db/seed-data/permissions.js` (MATRICE).
3. **Base de données** : toute évolution passe par une **nouvelle migration** (jamais modifier une
   migration déjà publiée). Les éléments validés sont intangibles par déclencheur (cartes, comptes
   rendus, PTBA, documents de programmation, campagnes et bulletins) ; les historiques sont en ajout
   seul. Ajouter les tables de référentiel à conserver dans `CONSERVEES`
   (`src/services/reinitialisation.js`).
4. **Circuits** : chaque action d’un circuit vérifie le droit côté API, écrit l’historique
   (`addHistory`), le journal d’audit (`audit`) et notifie (`notify`, type déclaré dans
   `services/notifications.js` et `services/mailer.js`).
5. **Démonstration** : `DEMO_MODE=true` uniquement hors production (refusé au démarrage sinon).
   Tout nouveau module doit enrichir le scénario `src/db/seeds/07_demo_scenario.js` (au travers de
   l’API) pour rester démontrable et servir à la formation.
6. **Consulter avant d’améliorer** : présenter à l’utilisateur toute amélioration ou tout nouveau
   lot (contenu, rôles, choix) et attendre son accord avant de l’implémenter.

## Vérifier avant de publier

1. `npm test` (backend) — tous les tests passent ; ajouter des tests pour toute fonctionnalité.
2. `npm run build` (frontend) — sans erreur.
3. Essai dans le navigateur des écrans modifiés (comptes de démonstration, mot de passe `Demo@2026`).
4. Mettre à jour `CHANGELOG.md`, `README.md` et la version (`backend/package.json`,
   `frontend/package.json` et les deux `package-lock.json`).
5. Relire le diff (données personnelles, secrets, fichiers d’essai).

## Git : travailler à plusieurs sessions (poste local et cloud)

- Branche de travail commune : `claude/determined-maxwell-jl0avn`. Avant de commencer :
  `npm run mise-a-jour` (s’arrête si des modifications locales ne sont pas enregistrées).
- Après le travail : `git commit` puis `git push`. Si le push est refusé, `git pull` (fusion,
  **jamais de rebase ni de force-push**), résoudre les conflits, relancer les tests, puis pousser.
- Messages de commit en français : « SIG-DEP x.y.z — lot … : résumé », puis le détail.
- Ne jamais versionner `backend/.env`, `storage/`, les sauvegardes ni des fichiers réels.

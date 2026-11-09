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
| Démarrer l’API / l’interface | `npm run dev` (backend), `npm run dev` (frontend) ; ou les deux, détachées : `npm run dev:tout` (backend ; `-- --relancer`, `-- --arret` ; journaux dans le dossier temporaire `sigdep-dev`) |
| Migrations | `npm run migrate` |
| Recharger la démonstration complète | `npm run demo:reset` (exige `DEMO_MODE=true` dans `backend/.env`) |
| Tests | `npm test` (base `sig_dep_test`, recréée à chaque lancement) |
| Construire l’interface | `npm run build` (frontend) |
| Analyse statique de l’interface | `npm run lint` (frontend) — aucune erreur tolérée |
| Paquet d’installation pour le serveur | `npm run paquet` (→ `paquets/`, non versionné) ; installation et mises à jour : `docs/MISE-EN-SERVICE.md` |
| Contrôle de préparation à la production | `npm run verifier-production` (à compléter pour tout nouveau réglage sensible : `src/services/preparation.js`) |
| Tests de non-régression de l’interface | `npm run test:e2e` (frontend ; API en mode démonstration démarrée, `LOGIN_RATE_LIMIT_MAX` relevé ; sous Windows, une fois : `npx playwright install chromium`) |

## Règles impératives

1. **Données personnelles** : le dépôt est public. Ne jamais y mettre de vrais noms, matricules,
   photos, signatures, ni le contenu réel des documents du Ministère (PAP, PTBA, montants, noms de
   responsables). Les fichiers réels restent hors du dépôt et ne servent qu’à des essais locaux.
   Les données de démonstration sont **fictives** et le restent. Avant chaque commit, relire le diff
   (`git diff --cached`) pour s’en assurer. Le hook git `sig-dep/outils/git-hooks/pre-commit` (activé par
   `npm run mise-a-jour` et par le hook de session cloud) refuse tout commit contenant un terme de la liste
   locale `sig-dep/.termes-sensibles` (jamais versionnée ; une ligne par terme) ou un nouveau fichier binaire
   (exception volontaire : `SIGDEP_AUTORISER_BINAIRE=1 git commit …`). Ne jamais le contourner (`--no-verify`).
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
7. **Documents produits** : tout export PDF passe par `createPdf` (`services/pdf.js`), tout Word par
   `documentWord` / `buildDocx` (`services/word.js`), toute feuille Excel par `addSheet` / `sendWorkbook`
   (`services/excel.js`) ou `feuilleOfficielle` (`services/entete.js`) : en-tête et pied de page
   officiels, d’après l’identité du Ministère en vigueur (`services/identite.js`). Le sceau n’est
   jamais versionné : l’Admin le dépose dans l’application.

## Refonte de l’interface (terminée)

Plan validé par l’utilisateur, livré par étapes de 1.20.1 à 1.31.0 : 0 filet de sécurité → 1 fondations
(jetons, formats, badges, boutons) → 2 nouveaux composants → 3 migration des modules récents vers les
composants communs (Planification, Données, Réunions/Décisions/Agenda, Actes/Cartes, Système) →
4 navigation → 5 tableaux de bord « À traiter » → 6 accessibilité et responsive → 7 performance.
Style retenu : **« Bleu État »** conforme à la charte graphique du Gouvernement, dans sa **direction B
« Portail clair »** (validée en 1.47.0, maquettes Figma « SIG-DEP — Propositions de design ») — fond
`#f7f8fb`, menu blanc (entrée active sur fond `dep-50` avec repère bleu institutionnel `#17418a`,
compteurs bleus), cartes blanches arrondies (`rounded-2xl`, bordure `#e9edf3`, ombre douce), indicateurs
à pastille de couleur, tricolore officiel `#0095c9` / `#fff24b` / `#db3832`, en-têtes de tableaux en majuscules ; **titres en
Cooper Hewitt** (police de la charte, embarquée ; classe `font-display`), texte courant et tableaux en Source Sans 3.
Composants à employer pour tout écran nouveau ou repris (catalogue vivant : page `/composants`) :
`NumberInput` / `MoneyInput` pour les nombres et montants, `EditableGrid` pour les grilles chiffrées,
`FormModal` + `FormSection` pour les fenêtres de saisie, `ActionBar` pour les formulaires de page,
`SimpleTable` pour les tableaux sans recherche (jamais de `<table>` brute), `FormulaireEtapes` + `PageControle` pour toute saisie d’un document (même mode de remplissage que la fiche PIP ; aperçu à droite pour la correspondance), `EmptyState`, `KpiTile`,
`WorkQueue`, `FilterBar`, onglets par `useOnglet` (dans l’adresse), actions secondaires par `menu` de
`PageHeader`, circuits par `WorkflowPanel` et `lib/workflows.js` ; formats et dates par `lib/format.js`
uniquement (jamais `toISOString().slice(0, 10)` pour une date du jour : c’est la date UTC).
Ne jamais casser : renouvellement de session et redirections 401/403/503, première connexion,
double authentification, inactivité, routeur « données » (protection des saisies), convention
`dejaSignale` de `runAction`, téléchargements, impression, droits renvoyés par l’API (`actions` /
`droits`), rang Bureau du BSD, cartes de service et vérification publique, absence de violation d’accessibilité
(`e2e/accessibilite.spec.js` : ne pas employer `text-slate-400` pour du texte), un seul appel périodique
(`/dashboard/compteurs`, jamais à chaque changement de page), référentiels en cache (`REFERENTIELS` de
`lib/api.js`, lus par `useApi`).

## Vérifier avant de publier

Raccourcis Claude Code (compétences du dépôt, `.claude/skills/`) : **`/verifier`** lance
`sig-dep/outils/verifier.sh` (contrôles adaptés aux fichiers modifiés ; `--tout`, ou `--complet` pour la suite complète
de l’interface et l’accessibilité) ; **`/publier-version x.y.z`** enchaîne CHANGELOG, numéros de version
(`sig-dep/outils/publier-version.js`), vérifications, commit et push. Les points ci-dessous restent la référence.


1. `npm test` (backend) — tous les tests passent ; ajouter des tests pour toute fonctionnalité.
2. `npm run lint` et `npm run build` (frontend) — sans erreur ; `npm run test:e2e` pour toute modification de l’interface.
3. Essai dans le navigateur des écrans modifiés (comptes de démonstration, mot de passe `Demo@2026`).
4. Mettre à jour `CHANGELOG.md`, `README.md` et la version (`backend/package.json`,
   `frontend/package.json` et les deux `package-lock.json`).
5. Relire le diff (données personnelles, secrets, fichiers d’essai).

## Git : travailler à plusieurs sessions (poste local et cloud)

- Session cloud : le hook `.claude/hooks/session-start.sh` (à la racine du dépôt) remet le conteneur en état à
  chaque démarrage — dépendances, PostgreSQL (rôle `sigdep`, bases `sig_dep_demo` et `sig_dep_test`), `backend/.env`
  de démonstration, migrations, démonstration si absente, navigateur Playwright, contrôle avant commit, API (4000)
  et interface (5173) ; journaux dans `/tmp/sigdep-session`. Tests du serveur en session : `DEMO_MODE=false npm test`.
  La liste `sig-dep/.termes-sensibles` est perdue avec le conteneur : la recréer en début de session cloud.
  Playwright y emploie le navigateur de la machine (`SIGDEP_CHROMIUM`, lu par `playwright.config.js`).
- Après chaque modification d’un fichier de l’interface par Claude Code, le hook `.claude/hooks/lint-apres-modif.sh`
  lance eslint sur ce fichier et signale aussitôt les erreurs (les avertissements sont tolérés).

- Branche de travail commune : `claude/determined-maxwell-jl0avn`. Avant de commencer :
  `npm run mise-a-jour` (s’arrête si des modifications locales ne sont pas enregistrées).
- Après le travail : `git commit` puis `git push`. Si le push est refusé, `git pull` (fusion,
  **jamais de rebase ni de force-push**), résoudre les conflits, relancer les tests, puis pousser.
- Messages de commit en français : « SIG-DEP x.y.z — lot … : résumé », puis le détail.
- Ne jamais versionner `backend/.env`, `storage/`, les sauvegardes ni des fichiers réels.

# SIG-DEP — Système Intégré de Gestion de la Direction d’Études et Planification

Application web de gestion de la **Direction d’Études et Planification (DEP)** du Secrétariat Général au Numérique — République Démocratique du Congo.

Elle couvre l’organisation, le personnel et les affectations, les comptes, les présences hebdomadaires, les courriers, les instructions et tâches, les documents de service, les fiches de projets PIP, les notifications, le journal d’audit, les tableaux de bord et les rapports, avec des exports PDF, Excel et Word.

```
sig-dep/
├── backend/     API REST : Node.js, Express, PostgreSQL (Knex), JWT, Zod
├── frontend/    Interface web : React, Vite, Tailwind CSS, React Router, Axios, Zustand, React Hook Form
└── README.md
```

---

## 1. Démarrage rapide (Windows avec Git Bash)

### Prérequis

| Outil | Version | Remarque |
|---|---|---|
| Node.js | **22 LTS** (ou ≥ 20.19) | https://nodejs.org — cocher « Add to PATH » |
| PostgreSQL | 14 à 17 | https://www.postgresql.org/download/windows/ — noter le mot de passe de `postgres` |
| Git pour Windows | récent | fournit **Git Bash** |

Ajoutez les outils PostgreSQL au `PATH` de Git Bash (adapter la version) :

```bash
echo 'export PATH="$PATH:/c/Program Files/PostgreSQL/16/bin"' >> ~/.bashrc && source ~/.bashrc
```

### Création de la base de données

```bash
psql -U postgres -c "CREATE USER sigdep WITH PASSWORD 'sigdep' CREATEDB;"
psql -U postgres -c "CREATE DATABASE sig_dep OWNER sigdep;"
psql -U postgres -c "CREATE DATABASE sig_dep_test OWNER sigdep;"   # pour les tests
```

> En production, choisissez un mot de passe fort et reportez-le dans `DATABASE_URL`.

### Backend (http://localhost:4000)

```bash
cd backend
npm install
cp .env.example .env
npm run migrate
npm run seed
npm run dev
```

### Frontend (http://localhost:5173)

Dans un second terminal Git Bash :

```bash
cd frontend
npm install
cp .env.example .env
npm run dev
```

Ouvrez **http://localhost:5173**. Le serveur Vite relaie `/api` vers `http://localhost:4000` : le navigateur voit une seule origine, ce qui permet au cookie `httpOnly` du refresh token (SameSite=Strict) de fonctionner.

### Compte Admin initial

| Nom d’utilisateur | Mot de passe temporaire |
|---|---|
| `admin` | `dep@2026` |

Le compte `admin` porte le rôle **Admin Système** (`ADMIN_SYSTEME`, périmètre `SYSTEME`) : il assure le fonctionnement technique, la sécurité et la disponibilité du SIG-DEP, sans aucune autorité administrative. Il ne remplace jamais le Directeur, un Chef de Division ou un Chef de Bureau.

À la **première connexion**, un assistant impose, dans l’ordre, avant tout accès (l’API renvoie `CONFIGURATION_SECURITE_REQUISE` à toute autre requête) :

1. le **changement du mot de passe**, selon la politique en vigueur ;
2. la **double authentification** : scanner le QR code avec une application d’authentification (Google Authenticator, Microsoft Authenticator, FreeOTP…), confirmer un code, puis conserver les **10 codes de secours** à usage unique ;
3. l’**adresse électronique de récupération** (vérifiée par un code lorsque la messagerie est active) ;
4. l’**acceptation des règles de sécurité**.

Ensuite, chaque connexion demande le mot de passe **puis** le code de l’application (ou un code de secours). « Mot de passe oublié ? » envoie un code à l’adresse de récupération vérifiée ; le second facteur est aussi exigé. En dernier recours : `npm run reset-admin` sur le serveur.

### Comptes de démonstration (`SEED_DEMO=true`)

Mot de passe commun : **`Demo@2026`**. Désactivez-les en production avec `SEED_DEMO=false` avant `npm run seed`.

| Utilisateur | Rôle | Affectation |
|---|---|---|
| `sg` | Secrétaire Général | Autorité hors DEP (supervision) |
| `directeur` | Directeur | Direction |
| `cb.secretariat` | Chef de Bureau | **Bureau Secrétariat de Direction** (rattaché au Directeur) |
| `ag.secretariat1`, `ag.secretariat2` | Agent | Bureau Secrétariat de Direction |
| `cd.edi`, `cd.sci`, `cd.ps` | Chef de Division | Études, Documentation et Information ; Stratégies et Coopération Internationale ; Programme et Suivi |
| `cb.eap`, `cb.doi`, `cb.str`, `cb.coi`, `cb.prg`, `cb.sev` | Chef de Bureau | Bureaux des Divisions |
| `ag.eap1`, `ag.eap2`, `ag.doi1`, … `ag.sev2` | Agent | Bureaux des Divisions |

Les comptes **`directeur`** et **`sg`** configurent leur **double authentification** à la première connexion (application d’authentification sur téléphone, adresse de récupération, règles de sécurité), comme l’Admin Système.

La liste déclarative de démonstration est **déjà validée** par le Directeur. Trois agents fictifs y figurent **sans compte**, pour essayer l’enrôlement : un agent du Bureau Secrétariat de Direction (enrôlable par l’Admin), un agent du Bureau Stratégies et un agent sans affectation (enrôlables par le Secrétariat).

Le seed `05_demo_activites.js` ajoute aussi une activité de démonstration, avec des dates relatives au jour du seed : instructions, tâches (dont une en retard), courriers, documents avec visas, présences de la semaine précédente et fiches PIP. Les tableaux de bord et les rapports sont ainsi parlants dès l’installation.

L’organigramme créé par le seed est **celui de la DEP** (liste officielle des agents, 2026) :

| Code | Structure | Supérieur direct |
|---|---|---|
| 5.3.3 | Direction d’Études et Planification | Secrétariat Général |
| 5.3.3.0 | Bureau Secrétariat de Direction (rang Bureau) | Directeur |
| 5.3.3.1 | Division Études, Documentation et Information | Directeur |
| 5.3.3.1.1 | Bureau Études, Analyses et Prospective | Division 5.3.3.1 |
| 5.3.3.1.2 | Bureau Documentation et Information | Division 5.3.3.1 |
| 5.3.3.2 | Division Stratégies et Coopération Internationale | Directeur |
| 5.3.3.2.1 | Bureau Stratégies | Division 5.3.3.2 |
| 5.3.3.2.2 | Bureau Coopération Internationale | Division 5.3.3.2 |
| 5.3.3.3 | Division Programme et Suivi | Directeur |
| 5.3.3.3.1 | Bureau Programme | Division 5.3.3.3 |
| 5.3.3.3.2 | Bureau Suivi-Évaluation | Division 5.3.3.3 |

Les **codes organiques** (section 5.3.3 du cadre organique du Secrétariat Général au Numérique) complètent les codes internes (`BSD`, `DIV-EDI`, `BUR-EAP`…). Le code d’une structure prolonge celui de sa structure de rattachement ; le suffixe `.0` est réservé au Bureau Secrétariat de Direction. Déplacer un Bureau vers une autre Division impose de mettre à jour son code.

**Effectif organique de référence** (Cadre organique → Effectif) : 1 Directeur, 3 Chefs de Division, 7 Chefs de Bureau, 7 Attachés d’Administration de 1re classe, 1 Attaché de 2e classe, 1 Huissier, soit 20 postes. Cette référence **ne limite pas** l’enregistrement des Agents : l’application compare l’effectif réel (Agents en activité, en congé ou suspendus, ayant une affectation active, hors Secrétaire Général), indique les écarts, vacances, sureffectifs, Agents hors cadre de référence et postes de commandement sans titulaire. Le Directeur peut ajuster la référence sur la base d’un acte (audité). Ces indicateurs figurent aussi sur son tableau de bord.

Les **missions et attributions** de ces structures sont déduites de leurs intitulés et restent **à valider** par le Directeur (Cadre organique). Les structures se gèrent dans l’application (Organigramme → « Nouvelle Division », « Nouveau Bureau », crayon et archivage sur chaque structure) ou dans `backend/src/db/seed-data/organisation.js`.

Les **comptes de démonstration** reposent sur des personnes fictives. Le personnel réel ne figure pas dans le code : il se charge par **l’import** (section suivante).

### Mise en service : retirer les données fictives

Tant que la base contient les données fictives, l’Admin voit dès sa connexion un bandeau « La base contient des données fictives de démonstration » avec le bouton **Réinitialiser la base** (aussi accessible par le menu Administration → Réinitialisation, et depuis la page Système).

| Type | Effet |
|---|---|
| **Base vierge — mise en service** | Supprime agents, comptes, instructions, tâches, courriers, documents, PIP, présences, pièces jointes (fichiers compris), notifications et journaux. Conserve l’organigramme, les grades, les fonctions, les rôles et permissions, les paramètres et le compte Admin (même mot de passe, session conservée). |
| **Données fictives — formation** | Même nettoyage, puis rechargement des données de démonstration (comptes `Demo@2026`). |

Garde-fous : réservé à l’Admin (`systeme.maintenir`), saisie de `REINITIALISER` et du mot de passe Admin, **sauvegarde automatique préalable** (`storage/backups/sig-dep-…-avant-reinitialisation.dump`) ; si la sauvegarde échoue, rien n’est supprimé. Tout se fait en une seule transaction et l’opération est inscrite au journal d’audit. Les autres utilisateurs sont déconnectés.

Après une réinitialisation « base vierge », le tableau de bord guide la mise en service : 1) l’Admin crée le compte du Directeur ; 2) le Directeur importe la liste officielle (section suivante), la vérifie et la valide, puis la **génère en PDF** (« Liste officielle (PDF) », avec bloc de signature ; tant qu’elle n’est pas validée, le document est intitulé « Projet de liste déclarative ») ; 3) l’Admin enrôle le Bureau Secrétariat de Direction ; 4) le Secrétariat enrôle les agents des Divisions.

### Import du personnel réel

1. Partir d’une base sans données fictives : réinitialisation « base vierge » (ci-dessus) ou, pour une nouvelle installation, `SEED_DEMO=false` dans `backend/.env`, puis `npm run migrate` et `npm run seed`.
2. L’Admin crée le compte du Directeur (Comptes → « Compte institutionnel »).
3. Le Directeur ouvre **Personnel → Importer une liste** et dépose la liste officielle : document **Word** (tableau « N° / NOM, POSTNOM & PRENOM / MATRICULE / FONCTION » avec lignes de section « 1. Bureau Secrétariat de Direction », « 2.1. Bureau … »), **Excel** ou **CSV**. Un modèle Excel prérempli avec les structures est téléchargeable depuis la même page.
4. L’**analyse** n’enregistre rien. Elle rattache chaque ligne à sa structure (sans tenir compte des accents ni de la numérotation), découpe nom / postnom / prénom et normalise les matricules (`1.234.567` → `1234567`). Elle propose aussi le poste (grade CD au niveau d’une Division → Chef de Division ; grade CB dans un Bureau → Chef de Bureau) et signale les anomalies : doublons, grade inconnu, structure non reconnue, responsable déjà en poste, structures sans responsable.
5. Chaque ligne peut être corrigée ou exclue, puis **l’import s’exécute en une seule transaction** (tout ou rien, revalidé par le serveur). Les Agents sont créés avec leurs affectations et l’opération est auditée. Les matricules déjà présents sont ignorés, ou mis à jour et réaffectés au choix, avec clôture de l’ancienne affectation.
6. Les agents importés sont inscrits sur la **liste déclarative**, que le Directeur valide ensuite (section suivante). Désigner les responsables manquants avant la validation.
7. Les informations complémentaires (sexe, date de naissance, date de mise en service, carte IGAP, fonction, photo, commission d’affectation, téléphone, adresse électronique) sont saisies à l’**enrôlement**.

Le Bureau Secrétariat de Direction peut importer les fiches sur désignation (`personnel.suivre`) ; les affectations restent réservées au Directeur. Le fichier importé n’est jamais conservé sur le serveur.

### Création des comptes : liste déclarative et enrôlement

Les comptes des agents ne se créent plus librement : ils sont **enrôlés** à partir de la liste déclarative validée.

1. **L’Admin crée le compte du Directeur** (Comptes → « Compte institutionnel »).
2. **Le Directeur valide la liste déclarative** (menu « Liste déclarative », bouton « Valider la liste »). Seuls le Directeur et l’Admin voient et peuvent utiliser ce bouton. La validation enregistre un instantané daté et non modifiable (matricule, grade, Division, Bureau de chaque agent), exportable en PDF (avec bloc de signature) ou en Excel.
3. **L’Admin enrôle les agents du Bureau Secrétariat de Direction** (menu « Enrôlement des agents »). Il peut techniquement enrôler tous les agents, mais l’écran lui propose de commencer par le Secrétariat.
4. **Les membres du Bureau Secrétariat de Direction** (quel que soit leur rôle) reçoivent alors l’option d’enrôlement et créent les comptes des agents **des Divisions et des autres Bureaux**. Les comptes du Secrétariat restent réservés à l’Admin. Les agents des autres structures n’ont ni l’option ni l’accès, qui est refusé par l’API (403).

**Enrôlement, en cinq étapes :**

1. **Identification** : on saisit le matricule (avec ou sans points) ou le nom. Le système cherche dans toute la base et indique pour chaque agent s’il est enrôlable, absent de la liste, en attente de revalidation, déjà doté d’un compte ou hors de la portée de l’utilisateur.
2. **Fiche de la liste** : la fiche est générée à partir de la liste validée (nom, postnom, prénom, matricule, grade). L’enrôleur atteste avoir vérifié l’identité de l’agent ; en cas d’erreur, il ne poursuit pas et la signale au Directeur.
3. **Affectation** : la Division, le Bureau et le poste sont repris de la liste (non modifiables) ou, si l’agent n’est pas affecté, choisis. L’enrôleur joint la **commission d’affectation** et confirme que l’affectation lui correspond.
4. **Informations complémentaires** (voir ci-dessous) et **photo**.
5. **Récapitulatif** puis création du compte.

Les deux confirmations (identité, affectation) sont exigées par l’API et tracées dans le journal d’audit. Les champs suivants sont **obligatoires** :

* sexe, date de naissance, date de mise en service (postérieure aux 18 ans de l’agent) ;
* numéro de la carte **IGAP** (unique) ;
* **fonction**, choisie parmi celles du grade de l’agent (le serveur contrôle aussi cette correspondance) ;
* **photo** de l’agent et **commission d’affectation** (PDF ou image).

Le lieu de naissance, le téléphone, l’adresse électronique et l’adresse sont facultatifs. Si l’agent n’a pas d’affectation, la Division, le Bureau et le poste se choisissent à l’enrôlement. Le compte est créé actif, avec un mot de passe temporaire à changer à la première connexion. L’opération est auditée.

**Revalidation.** Un agent ajouté à la liste après la validation, ou dont la matricule, le grade ou l’affectation a changé, n’est pas enrôlable tant que le Directeur n’a pas **revalidé** la liste (statut « À revalider »). Une fois le compte créé, les mutations suivent le circuit ordinaire des affectations, sans revalidation. Un agent qui a un compte ne peut pas être retiré de la liste.

Le tableau de bord de l’Admin, du Directeur et du Secrétariat affiche l’avancement de la mise en service : compte du Directeur, validation de la liste, comptes du Secrétariat, comptes des Divisions.

### Commandes utiles (backend)

| Commande | Effet |
|---|---|
| `npm run dev` | API avec rechargement automatique |
| `npm start` | API en mode production |
| `npm run migrate` / `npm run migrate:rollback` | Applique ou annule les migrations |
| `npm run seed` | Données initiales (idempotent : peut être relancé sans perte) |
| `npm run db:reset` | **Efface** puis recrée la base (développement uniquement) |
| `npm run reset-admin` | Réinitialise le compte Admin (`dep@2026`, changement obligatoire) |
| `npm run reset-admin -- "MotDePasse@1"` | Réinitialise l’Admin avec un mot de passe temporaire choisi |
| `npm run backup` | Sauvegarde PostgreSQL (`storage/backups/`) |
| `npm test` | Tests automatisés (base `sig_dep_test`) |

---

## 2. Architecture retenue

```
Navigateur ──► Frontend React (Vite)  ──/api──►  API Express  ──Knex──►  PostgreSQL
                 │ jeton d’accès en mémoire      │ Helmet, CORS, Zod, JWT
                 │ cookie httpOnly (refresh)     │ contexte : rôles + permissions + affectation + périmètre
                 └ Zustand, React Router         │ contrôle hiérarchique, audit, notifications
                                                  └ stockage des fichiers hors racine web (storage/)
```

**Backend** (`backend/src`)

| Dossier | Rôle |
|---|---|
| `config/env.js` | Configuration issue du `.env` (secrets, CORS, sécurité) |
| `db/migrations` | Schéma : organisation, sécurité, modules métier, contraintes, déclencheurs |
| `db/seeds`, `db/seed-data` | Organigramme, cadre organique, rôles et permissions, Admin, démonstration |
| `middleware/` | Authentification JWT, contrôle des permissions, validation Zod, erreurs en français |
| `services/context.js` | Construction du contexte d’autorisation (rôles, permissions, affectation, périmètre) |
| `services/hierarchy.js` | Chaîne hiérarchique : nœuds, supérieur direct, subordonnés directs |
| `services/scope.js`, `services/access.js` | Filtrage des données par périmètre, règles de lecture et d’écriture |
| `services/audit.js`, `notifications.js`, `history.js` | Journal d’audit, notifications internes, historiques horodatés |
| `services/pdf.js`, `excel.js`, `word.js` | Exports avec en-tête officiel |
| `services/jobs.js` | Retards, rappels d’échéance, verrouillage automatique des présences, purge des sessions |
| `modules/*` | Une route par module : `auth`, `organisation`, `agents`, `users`, `presences`, `courriers`, `instructions`, `tasks`, `documents`, `pip`, `notifications`, `audit`, `attachments`, `dashboard`, `rapports`, `systeme`, `hierarchie`, `recherche` |

**Frontend** (`frontend/src`)

| Dossier | Rôle |
|---|---|
| `lib/api.js` | Axios avec renouvellement automatique du jeton, messages d’erreur, téléchargements |
| `store/auth.js` | Session (Zustand) : utilisateur, permissions, compteurs |
| `components/ui` | Tableaux avec recherche et pagination, badges, fenêtres de confirmation, notifications éphémères, états de chargement et d’erreur |
| `components/shared.jsx` | Historique, pièces jointes, exports, formulaires guidés dynamiques |
| `components/layout` | Menu latéral selon les permissions, en-tête avec recherche globale (Ctrl+K), fil d’Ariane, impression |
| `lib/inactivity.js` | Déconnexion automatique après inactivité, avec avertissement |
| `pages/*` | Écrans de chaque module, pages « Accès refusé » et « Page introuvable » |

> Le frontend ne sert qu’à l’ergonomie : **toutes** les autorisations sont vérifiées par l’API.

---

## 3. Modèle organisationnel : rang organique et rattachement

Deux notions distinctes sont enregistrées pour chaque structure :

* **Rang organique** : ce qu’est la structure (`DIRECTION`, `DIVISION`, `BUREAU`) ;
* **Rattachement hiérarchique** : à qui elle rend compte (`parent_type`, `division_id`, `superieur_direct`).

```
Directeur de la DEP
│
├── [Rang organique : BUREAU]   ← rattachement direct au Directeur
│   Bureau Secrétariat de Direction
│   ├── Chef de Bureau
│   └── Agents du Bureau
│
└── [Rang organique : DIVISION]
    Divisions de la DEP
    ├── Chef de Division
    └── Bureaux rattachés à la Division
        ├── Chef de Bureau
        └── Agents
```

### Règle du Bureau Secrétariat de Direction

Dans la base (table `bureaux`) :

```
type_structure = BUREAU      rang_organique  = BUREAU
direction_id   = DEP         division_id     = NULL
parent_type    = DIRECTION   responsable_role = CHEF_BUREAU
perimetre_acces = BUREAU     superieur_direct = DIRECTEUR
est_secretariat_direction = true
```

Garanties, par niveau :

| Niveau | Mécanisme |
|---|---|
| Base de données | `CHECK` : un Bureau a toujours le rang BUREAU et le périmètre BUREAU. Un rattachement DIRECTION impose `division_id = NULL` et un supérieur DIRECTEUR. Un seul Secrétariat par Direction. |
| Base de données | Déclencheurs `trg_*_secretariat` : toute attribution de `division.gerer`, `division.superviser`, `division.valider` ou `chef_division.agir` à un utilisateur affecté au Secrétariat (par rôle, par permission individuelle, par modification d’un rôle ou par changement d’affectation) est **rejetée**. |
| API | `services/context.js` retire ces permissions et interdit le périmètre DIVISION pour tout membre du Secrétariat. `users` refuse le rôle Chef de Division. `organisation` refuse de rattacher le Secrétariat à une Division. |
| Hiérarchie | Nœud `BUR:<id>` dont le parent est `DIR:<id>` : seul le Directeur l’instruit ; aucun Chef de Division ne le supervise. Le supérieur d’un Bureau est calculé à partir de son **rattachement** (`parent_type`), jamais de son rang. |
| Statistiques | La table `divisions` ne contient que des Divisions. Organigramme, tableaux de bord et rapports affichent à part les « Bureaux rattachés au Directeur ». |
| Interface | Badge « Rang : Bureau », mention « Bureau directement rattaché au Directeur », icône de Bureau. Tableau de bord de Chef de Bureau pour son Chef. |

Ces règles sont vérifiées par `backend/tests/secretariat.test.js`.

---

## 4. Rôles, permissions et périmètres

Une autorisation dépend à la fois du **rôle**, des **permissions**, de l’**affectation active**, du **périmètre**, du **statut du compte** et de la **structure** concernée. Une permission ne donne jamais accès à toutes les données : chaque requête est filtrée par périmètre (`services/scope.js`, `services/access.js`).

| Rôle | Périmètre | Principales permissions |
|---|---|---|
| Admin | `SYSTEME` | paramètres, état du système, sauvegardes, audit, comptes initiaux (SG et Directeur), validation de la liste déclarative, enrôlement de tous les agents (d’abord le Bureau Secrétariat de Direction), activation, réinitialisation, déverrouillage, révocation des sessions, gestion des rôles. **Aucune** permission de validation fonctionnelle. Le rôle ADMIN ne peut pas recevoir de permission métier. |
| Secrétaire Général | `SUPERVISION_GLOBALE` (lecture) | consultation de toute la DEP (documents : validés uniquement), instructions **au Directeur uniquement**, validation et clôture de ses propres instructions |
| Directeur | `DIRECTION` | tout le fonctionnel de la DEP : organisation, cadre organique, personnel, affectations, validation de la liste déclarative des agents, activation des comptes, délégations, courriers, instructions, validation finale des documents et PIP, verrouillage des présences, rapports |
| Chef de Division | `DIVISION` | sa Division et ses Bureaux : instructions aux Chefs de Bureau, examen et validation au niveau Division, vérification des PIP, présences du périmètre, rapports |
| Chef de Bureau | `BUREAU` | son Bureau : tâches aux Agents, présences (saisie, vérification, soumission), examen et transmission des documents, rapports du Bureau |
| Agent | `PERSONNEL` | ses tâches, ses documents, son profil, ses notifications, informations collectives validées du Bureau |

**Désignations** (table `user_permissions`, écran « Désignations ») fondées sur un acte validé, pour une période : `personnel.suivre`, `presences.preparer_direction`, `courriers.enregistrer`, `dossiers.transmettre`. Elles ne changent ni le rang ni le périmètre du bénéficiaire et expirent d’elles-mêmes. L’enrôlement (`compte.enroler`) et la préparation des actes (`actes.preparer`) ne sont pas des désignations : il est accordé à tous les membres actifs du Bureau Secrétariat de Direction du fait de leur affectation, pour les agents des autres structures uniquement.

La matrice complète figure dans `backend/src/db/seed-data/permissions.js`. L’Admin peut la modifier dans l’écran « Rôles et permissions », dans la limite des garde-fous ci-dessus.

### Chaîne hiérarchique

```
Secrétaire Général → Directeur → Chef de Division → Chef de Bureau → Agent
Directeur → Chef du Bureau Secrétariat de Direction → Agents du Bureau Secrétariat
```

* Une **instruction** part toujours du supérieur vers son subordonné **direct**. Le Chef de Bureau attribue des **tâches** aux Agents de son Bureau.
* Les **comptes rendus** remontent vers l’émetteur. Les **courriers** circulent entre supérieur et subordonné directs, dans les deux sens.
* Toute transmission contraire à la chaîne est refusée (erreur `CHAINE_HIERARCHIQUE`). Chaque étape est horodatée dans `historiques`.

---

## 5. Principaux workflows

| Module | Workflow |
|---|---|
| Comptes | Admin → comptes initiaux (SG, Directeur). Directeur → validation de la liste déclarative. Admin → enrôlement du Bureau Secrétariat de Direction. Bureau Secrétariat → enrôlement des agents des Divisions et des autres Bureaux (voir section 1). Mot de passe temporaire à changer, verrouillage après 5 échecs pendant 15 min (déverrouillage automatique ou par l’Admin), historique des connexions, révocation des sessions. |
| Affectations | Une nouvelle affectation **clôture** la précédente (date de fin et motif) sans rien supprimer. Un seul responsable par structure. Notification à l’Agent. |
| Présences | `Brouillon → Vérifiée → Soumise → Verrouillée`. La soumission verrouille la liste en écriture (API et déclencheur PostgreSQL). Le Directeur réceptionne ; à défaut, verrouillage automatique après `PRESENCE_AUTOLOCK_HOURS`. Toute correction passe par un **rectificatif** lié à l’original. |
| Courriers | Enregistrement numéroté (`DEP/CE/2026/0001`, `DEP/CS/…`), transmissions horodatées avec accusé de réception, annotations, statut « Traité », classement, archivage. Les courriers confidentiels ne sont visibles que de leur chaîne de transmission, du Directeur et du SG. |
| Instructions | `Brouillon → Transmise → Reçue → En cours → Exécutée → Validée → Clôturée`, avec `À corriger` et `En retard` (automatique). Déclinaison en sous-instructions ou en tâches. |
| Tâches | Même cycle, entre le Chef de Bureau et un Agent de son Bureau. |
| Documents | Rédaction guidée (10 modèles) → transmission au supérieur direct → examen (retour pour correction, visa) → validation Division (Chef de Division) → validation et signature du Directeur → archivage. Chaque enregistrement crée une version ; les versions ne peuvent pas être supprimées (déclencheur). |
| Actes administratifs | Préparation par le Bureau Secrétariat de Direction (ou le Directeur) avec la **copie scannée de l’acte signé** → soumission → validation ou refus motivé du **Directeur**. Les actes relatifs au poste de Directeur sont enregistrés par l’**Admin Système** et validés par le **Secrétaire Général**. Un acte validé est intangible (contrôle en base) : il se corrige par un **rectificatif**, qui le remplace à sa validation, ou cesse par **révocation** motivée. Numérotation `DEP/ACT/2026/0001`. |
| Intérims | Acte d’intérim sur un poste de commandement (Directeur, Chef de Division, Chef de Bureau), pour une période déterminée. Un seul intérim par poste et par intérimaire sur une même période (contrôle en base). Pendant la période, l’intérimaire exerce le rôle du poste **dans le seul périmètre de ce poste**, prend sa place dans la chaîne hiérarchique et reçoit les notifications destinées au poste ; le **titulaire** reste titulaire mais est **suspendu** de ce rôle ; le grade permanent de l’intérimaire ne change pas. Les droits commencent et **expirent d’eux-mêmes** aux dates de l’acte, ou cessent à sa révocation. Notifications à l’entrée en vigueur, 3 jours avant la fin et à l’échéance. L’organigramme affiche l’intérim à côté du titulaire. |
| Désignations | Les anciennes « délégations » deviennent des **désignations** : opérations administratives désignables accordées par un acte de désignation, pour une période, avec expiration automatique. Les droits accordés sans acte avant la version 1.10 sont **à régulariser sous 30 jours** (Comptes → Désignations), puis retirés automatiquement. |
| Rôles d’autorité | L’Admin Système n’attribue ou ne retire les rôles Directeur, Chef de Division, Secrétaire Général et Admin Système qu’en citant un **acte validé** (nomination, affectation ou fin de fonction) concernant la personne ; l’acte figure dans l’audit. |
| PIP | `Brouillon → En vérification (Chef de Division, ou Directeur pour les structures rattachées à la Direction) → Vérifiée → Validée (Directeur) → Archivée`, avec retour `À corriger`. Page de contrôle générée automatiquement. |

Les exports disponibles : présences (PDF, Excel), registre des courriers et fiche de circulation, instructions et tâches, documents (PDF, Word, Excel pour les tableaux), fiches et portefeuille PIP, personnel, rapports mensuels, trimestriels et annuels, journal d’audit (Excel). Chaque export est audité.

---

## 6. Modèle de données

| Domaine | Tables |
|---|---|
| Organisation | `directions`, `divisions`, `bureaux` (+ vue `v_structures`), `grades`, `fonctions`, `postes_organiques`, `attributions` (missions, attributions, responsabilités) |
| Personnel | `agents`, `affectations` (une seule active par Agent, historique conservé) |
| Sécurité | `users`, `roles`, `permissions`, `user_roles`, `role_permissions`, `user_permissions` (désignations), `actes_administratifs`, `refresh_tokens` (rotation par famille), `login_history`, `parametres` |
| Présences | `presence_sheets`, `presence_entries` |
| Courriers | `courriers`, `courrier_transmissions`, `courrier_annotations` |
| Activités | `instructions`, `tasks`, `historiques` |
| Documents | `documents`, `document_versions`, `document_comments` |
| PIP | `pip_projects`, `pip_versions` |
| Transverse | `attachments`, `notifications`, `notification_preferences`, `email_outbox`, `audit_logs`, `sequences` |

Principes appliqués :

* clés étrangères, index et contraintes `CHECK` ;
* transactions pour les opérations composées ;
* tables en **ajout seul**, protégées par déclencheur : `audit_logs`, `document_versions`, `pip_versions`, `historiques` (et pas de suppression de transmission de courrier) ;
* archivage ou désactivation plutôt que suppression, pour les agents, structures, attributions, comptes et pièces jointes.

---

## 7. Notifications par e-mail

Les notifications internes (cloche de l’en-tête) peuvent aussi être envoyées par e-mail : nouvelle instruction ou tâche, compte rendu, transmission de courrier, document à examiner, retourné ou validé, échéance proche, retard, liste de présence soumise, fiche PIP à traiter, changement d’affectation, compte créé, mot de passe réinitialisé.

**Activation** (dans `backend/.env`, puis redémarrer l’API) :

```
MAIL_ENABLED=true
SMTP_HOST=smtp.exemple.cd
SMTP_PORT=587            # 465 avec SMTP_SECURE=true
SMTP_SECURE=false
SMTP_USER=notifications@exemple.cd
SMTP_PASS=********
MAIL_FROM="SIG-DEP — Direction d’Études et Planification <no-reply@exemple.cd>"
APP_URL=https://sig-dep.exemple.cd   # adresse de l’interface, utilisée pour les liens
```

Contrôlez ensuite depuis **Admin → Système → Messagerie** : « Tester la connexion », puis envoi d’un e-mail de test.

**Fonctionnement**

* **File durable** : chaque e-mail est d’abord enregistré dans la table `email_outbox`, dans la même transaction que la notification. La file est envoyée chaque minute. Si le serveur SMTP est indisponible, l’envoi est retenté après 1, 5, 15 et 60 minutes, puis marqué « Échec » au-delà de `MAIL_MAX_ATTEMPTS` (5). L’Admin peut relancer les échecs. Plusieurs instances de l’API peuvent fonctionner sans double envoi (verrouillage `SKIP LOCKED`).
* **Confidentialité** : pour un courrier ou un document confidentiel ou secret, l’e-mail ne reprend ni l’objet ni le contenu ; il invite seulement à se connecter. Aucun mot de passe n’est jamais envoyé par e-mail.
* **Préférences** : chaque utilisateur active ou coupe les e-mails, globalement ou par type (Notifications → « Préférences e-mail », ou page Profil).
* **Destinataires** : l’adresse est celle de la fiche Agent. Un compte sans adresse ou inactif ne reçoit pas d’e-mail ; le panneau Messagerie indique combien de comptes actifs n’ont pas d’adresse.
* **Conservation** : les e-mails envoyés sont purgés de la file après 90 jours.
* Tant que `MAIL_ENABLED=false`, rien n’est mis en file et l’application fonctionne normalement.

---

## 8. Sécurité

* Mots de passe hachés avec **bcrypt** (coût 12). **Politique configurable** par l’Admin (Sécurité → Politique), dans des bornes qui empêchent de l’affaiblir : par défaut 10 caractères, majuscule, minuscule, chiffre et caractère spécial, refus des mots de passe courants ou dérivés du nom d’utilisateur, interdiction des 5 derniers, expiration facultative.
* **Double authentification** (TOTP) obligatoire pour l’Admin Système, le **Directeur** et le **Secrétaire Général** (y compris pour un Directeur par intérim) ; secret chiffré en base (AES-256-GCM, clé `TOTP_ENC_KEY` ou dérivée du secret JWT), codes de secours hachés et à usage unique.
* **Journal d’audit infalsifiable** : chaque entrée porte l’empreinte SHA-256 de la précédente (chaînage calculé par un déclencheur PostgreSQL). Modification, suppression ou troncature sont refusées en base ; une altération faite malgré tout (accès direct à PostgreSQL) est détectée par « Vérifier l’intégrité ». L’historique des connexions est lui aussi en ajout seul. La réinitialisation de la base ne les efface jamais.
* **Alertes de sécurité** (Sécurité → Alertes, notification et e-mail à l’Admin) : vague d’échecs de connexion, tentative sur un compte Admin, verrouillage, réutilisation d’un jeton de session, code de secours utilisé, changement de politique, désactivation d’un compte sensible, réinitialisation, intégrité de l’audit rompue.
* **Avis de connexion depuis un nouvel appareil** (Admin, Directeur, SG) : notification et e-mail, avec l’appareil et l’adresse IP. Chaque utilisateur voit ses **sessions ouvertes** dans son profil et peut **fermer à distance** celle d’un appareil qu’il ne reconnaît pas.
* **Sessions** : durée maximale et délai d’inactivité configurables ; l’Admin voit les sessions actives (utilisateur, adresse IP, navigateur) et peut en fermer une ; il peut bloquer temporairement un compte compromis, imposer un changement de mot de passe, détecter (et facultativement désactiver) les comptes inactifs.
* **Vérification de sécurité** à la demande : intégrité de l’audit, 2FA des Admins, comptes, politique, configuration (secret JWT, cookies HTTPS, messagerie), sauvegarde, fichiers téléversés.
* **Supervision** (Admin Système) :
  * **tableau de bord** : comptes (total, actifs, désactivés, verrouillés, inactifs), sessions actives, échecs de connexion, alertes, santé des services, espace disque, dernière sauvegarde réussie et sauvegardes échouées, erreurs techniques récentes, version de l’application, dernières opérations sensibles ;
  * **santé du système** (Administration → Santé du système) : API, PostgreSQL, stockage (espace libre et test d’écriture), sauvegarde, courriels, génération PDF/Excel. Contrôle automatique toutes les 15 minutes, historique sur 48 heures, alerte à chaque panne et à chaque rétablissement. Les seuils d’espace disque se règlent dans la politique (15 % / 5 % par défaut) ;
  * **journal technique** : erreurs internes du serveur regroupées par cause avec leur nombre d’occurrences, détail technique réservé à l’Admin, marquage « résolue » ; purge après 90 jours (réglable) — distinct du journal d’audit, qui n’est jamais purgé ;
  * **registre des sauvegardes** : chaque tentative, réussie ou échouée, avec durée, taille, origine et cause de l’échec (alerte en cas d’échec) ;
  * **rapport mensuel de sécurité** : produit automatiquement au début de chaque mois pour le mois écoulé (et à la demande), adressé à l’Admin Système et au **Directeur** (menu « Rapports de sécurité », PDF) : connexions, adresses IP suspectes, comptes, changements de rôles, réinitialisations, incidents, sauvegardes, intégrité de l’audit ;
  * tout **incident critique** est aussi notifié immédiatement au **Directeur** (notification et e-mail).
* **Rôles institutionnels protégés** en base (ni suppression, ni renommage). L’Admin ne peut attribuer ni retirer les rôles Directeur, Chef de Division, Secrétaire Général ou Admin Système sans acte validé enregistré dans le registre des actes, ni donner une permission technique à un rôle institutionnel ; le rôle Admin Système n’est pas modifiable depuis l’application.
* **Jeton d’accès** JWT de courte durée (`ACCESS_TOKEN_TTL`, 15 min), gardé en mémoire côté navigateur.
* **Refresh token** aléatoire dans un cookie `httpOnly`, `SameSite=Strict`, limité au chemin `/api/auth`. Seule son empreinte SHA-256 est stockée. Rotation à chaque renouvellement ; la réutilisation d’un ancien jeton révoque toute la famille.
* `token_version` : un changement de mot de passe, une désactivation ou un changement de rôle invalide immédiatement les jetons existants.
* **Helmet**, CORS configuré par `CORS_ORIGINS`, limitation anti-brute-force **uniquement** sur `/api/auth/login`, verrouillage du compte après le nombre d’échecs fixé par la politique.
* Validation **Zod** de toutes les entrées. Requêtes paramétrées via Knex.
* Permission vérifiée sur chaque route, puis filtrage par périmètre et contrôle hiérarchique.
* Pièces jointes stockées hors de la racine web sous un nom aléatoire (UUID), avec liste blanche de types MIME, taille maximale (15 Mo par défaut) et empreinte SHA-256. Téléchargement authentifié et contrôlé par le périmètre de l’élément parent.
* Déconnexion automatique après inactivité (délai fixé par la politique, 30 min par défaut), avec un avertissement avant l’échéance ; l’activité est partagée entre onglets.
* Aucune ressource externe : la police est embarquée dans l’application, qui fonctionne sur un réseau fermé.
* Messages d’erreur en français, sans détail technique en production.
* Secrets dans `.env` (jamais versionné). L’API refuse de démarrer en production avec le secret JWT d’exemple.

---

## 9. Tests

```bash
cd backend
npm test
```

Les tests réinitialisent la base `sig_dep_test` (migrations et seeds), puis vérifient notamment :

* le **Bureau Secrétariat de Direction** : représentation en base, contraintes, déclencheurs, contexte, organigramme, statistiques, tableau de bord, chaîne hiérarchique ;
* l’authentification : changement obligatoire du mot de passe, verrouillage et déverrouillage automatique, rotation et réutilisation du refresh token, déconnexion, compte désactivé ;
* la chaîne hiérarchique des instructions (SG → Directeur uniquement) et les tâches limitées au Bureau ;
* les périmètres de données, la lecture seule du SG et l’absence de droits fonctionnels de l’Admin ;
* les workflows des présences, courriers, documents (versions conservées) et PIP ;
* la liste déclarative (validation réservée au Directeur et à l’Admin, revalidation après modification) et l’enrôlement (portée Admin / Secrétariat, pièces et champs obligatoires, fonction conforme au grade, carte IGAP unique), l’historique des affectations et le journal d’audit en lecture seule ;
* les exports PDF, Excel et Word, et les tableaux de bord de chaque rôle ;
* la gestion des structures : postes créés automatiquement, Bureau rattaché au Directeur, propagation d’un changement de rattachement, archivage protégé ;
* la réinitialisation de la base (réservée à l’Admin, confirmations, base vierge conservant l’organigramme et le compte Admin, rechargement des données fictives) et l’identification des agents à l’enrôlement ;
* la recherche globale limitée au périmètre, et la sérialisation du journal d’audit ;
* les notifications par e-mail : mise en file, préférences, confidentialité, mot de passe jamais envoyé, envoi SMTP réel vers un serveur de test local, réessais puis échec et relance, administration ;
* la conformité au cadre organique : codes 5.3.3 (format, unicité, rattachement, suffixe du Secrétariat), effectif de référence et effectif réel, postes vacants, import reconnaissant les codes organiques ;
* les actes administratifs : circuit (pièce obligatoire, validation réservée, conflit d’intérêts), intérim (rôle et périmètre de l’intérimaire, suspension du titulaire, chaîne hiérarchique, organigramme), unicité de l’intérim, intangibilité en base, rectificatif, révocation, poste de Directeur (Admin → SG), désignations bornées et expirées, régularisation des droits sans acte, rôles d’autorité sur acte, visibilité du registre ; double authentification du Directeur et du SG, avis de nouvel appareil, fermeture de session à distance ;
* les sauvegardes et la maintenance : planification et conservation, chiffrement, intégrité, test de restauration, circuit complet de restauration avec réintégration des traces, mode maintenance, annonces, migrations, masquage des secrets.

**Intégration continue** : `.github/workflows/sig-dep.yml` exécute ces tests sur un PostgreSQL 16 éphémère et compile le frontend à chaque modification du dossier `sig-dep/`.

---

## 10. Sauvegardes, restauration et maintenance

Écrans de l’Admin Système : **Sauvegardes**, **Restaurations** et **Maintenance** (menu Administration).

### Sauvegardes automatiques

* Sauvegarde **chaque nuit à 01:00 (heure de Kinshasa)**, au format `pg_dump` personnalisé ; heure modifiable dans Sauvegardes → Planification.
* **Conservation** : 7 quotidiennes, 4 hebdomadaires (dimanche), 12 mensuelles (1er du mois) ; sauvegardes ponctuelles conservées 90 jours. Les sauvegardes préalables à une restauration ou à une migration suivent la même règle.
* **Chiffrement** AES-256-GCM lorsque `BACKUP_ENC_KEY` est défini (fichiers `.dump.enc`). **Conservez cette clé hors du serveur** (coffre, support scellé) : sans elle, aucune sauvegarde chiffrée n’est restaurable.
* **Copie hors serveur** : si `BACKUP_COPY_DIR` désigne un disque externe ou un partage réseau, chaque sauvegarde y est copiée et sa copie contrôlée (empreinte SHA-256). Tant que ce dossier n’est pas défini, la vérification de sécurité le signale.
* **Vérification d’intégrité** (empreinte + lecture de l’archive) et **test de restauration réel** dans une base temporaire, à la demande ou chaque semaine (dimanche) automatiquement.

```
BACKUP_ENC_KEY=<32 caractères aléatoires ou plus>
BACKUP_COPY_DIR=/mnt/sauvegardes-dep        # Windows : E:/sauvegardes-dep
PG_DUMP_PATH="C:/Program Files/PostgreSQL/16/bin/pg_dump.exe"        # si absent du PATH
PG_RESTORE_PATH="C:/Program Files/PostgreSQL/16/bin/pg_restore.exe"  # si absent du PATH
```

### Restauration (double validation)

1. L’Admin Système **demande** la restauration d’une sauvegarde vérifiée, avec un motif.
2. Le **Directeur valide ou refuse** (mot de passe) ; la validation expire après 24 heures.
3. L’Admin **exécute** : phrase `RESTAURER`, mot de passe et code de double authentification.

Pendant l’exécution : mode maintenance, sauvegarde préalable automatique (`AVANT_RESTAURATION`), remplacement de la base en une transaction (retour automatique à l’état précédent en cas d’échec), application des migrations, **réintégration des traces d’audit et de connexion postérieures à la sauvegarde** (rien n’est effacé du journal), fermeture de toutes les sessions. Le Directeur est notifié.

### Maintenance

* **Mode maintenance** avec message et heure de fin prévue : seuls les Admins Système peuvent se connecter ; les autres utilisateurs voient une page d’information.
* **Annonces système** envoyées à tous les utilisateurs (notification).
* **Migrations** : état et application (sauvegarde `AVANT_MIGRATION` préalable, mot de passe requis).
* **Environnement** : version, configuration et outils détectés, secrets masqués.

### En ligne de commande

```bash
cd backend
npm run backup      # sauvegarde manuelle non chiffrée (dépannage)
pg_restore --clean --if-exists --no-owner -d "postgres://sigdep:MOTDEPASSE@localhost:5432/sig_dep" storage/backups/sig-dep-….dump
```

Sauvegardez aussi le dossier `backend/storage/uploads` (pièces jointes et photos).

---

## 11. Mise en production

1. **Serveur** : Linux (Ubuntu 22.04 ou 24.04 recommandé) ou Windows Server, avec Node.js 22 LTS, PostgreSQL et Nginx (ou IIS).
2. **Base** : créer un utilisateur PostgreSQL dédié avec un mot de passe fort. Ne pas ouvrir le port 5432 sur Internet.
3. **Backend** :

   ```bash
   cd backend
   npm ci --omit=dev
   cp .env.example .env
   ```

   Dans `.env`, régler :

   ```
   NODE_ENV=production
   DATABASE_URL=postgres://sigdep:<mot-de-passe-fort>@localhost:5432/sig_dep
   JWT_ACCESS_SECRET=<48 octets aléatoires>   # node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
   CORS_ORIGINS=https://sig-dep.exemple.cd
   COOKIE_SECURE=true
   SEED_DEMO=false
   APP_URL=https://sig-dep.exemple.cd
   MAIL_ENABLED=true   # avec les variables SMTP_* (voir section 7)
   ```

   Puis :

   ```bash
   npm run migrate
   npm run seed
   ```

   Lancer l’API en service : `pm2 start src/server.js --name sig-dep-api`, puis `pm2 save` et `pm2 startup` (ou un service systemd ou Windows).
4. **Frontend** :

   ```bash
   cd frontend
   npm ci
   npm run build
   ```

   Servez le dossier `dist/` en statique.
5. **Nginx** (même domaine pour l’interface et l’API, HTTPS obligatoire) :

   ```nginx
   server {
     listen 443 ssl http2;
     server_name sig-dep.exemple.cd;
     ssl_certificate     /etc/letsencrypt/live/sig-dep.exemple.cd/fullchain.pem;
     ssl_certificate_key /etc/letsencrypt/live/sig-dep.exemple.cd/privkey.pem;
     client_max_body_size 20m;
     root /opt/sig-dep/frontend/dist;
     location /api/ { proxy_pass http://127.0.0.1:4000; proxy_set_header Host $host;
                      proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
                      proxy_set_header X-Forwarded-Proto $scheme; }
     location / { try_files $uri /index.html; }
   }
   server { listen 80; server_name sig-dep.exemple.cd; return 301 https://$host$request_uri; }
   ```

   En production, l’API fait confiance à un seul proxy (`trust proxy = 1`), ce qui lui permet d’enregistrer la vraie adresse IP dans l’audit.
6. **Première connexion** : se connecter en `admin` / `dep@2026`, changer le mot de passe, puis créer les comptes du Secrétaire Général et du Directeur (Comptes → « Compte institutionnel »). Le Directeur valide ensuite la liste déclarative ; l’Admin enrôle le Bureau Secrétariat de Direction, qui enrôle les autres agents.
7. **Exploitation** : sauvegardes planifiées, mises à jour de sécurité, surveillance des journaux (`pm2 logs`), consultation régulière du journal d’audit et des comptes verrouillés.

En cas de perte du mot de passe Admin :

```bash
cd backend
npm run reset-admin
```

---

## 12. Appellation officielle

L’appellation **« Direction d’Études et Planification »** (sigle **DEP**) est utilisée partout : interface, documents générés, exports, base de données (`directions.nom`), notifications et documentation. Le paramètre `direction_nom` est verrouillé côté API.

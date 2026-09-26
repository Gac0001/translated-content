# SIG-DEP — Système Intégré de Gestion de la Direction d’Études et Planification

Application web de gestion de la **Direction d’Études et Planification (DEP)** du Secrétariat Général à l’Économie Numérique — République Démocratique du Congo.

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

Le changement du mot de passe est **obligatoire** à la première connexion. L’API refuse toute autre opération tant qu’il n’a pas été changé.

### Comptes de démonstration (`SEED_DEMO=true`)

Mot de passe commun : **`Demo@2026`**. Désactivez-les en production avec `SEED_DEMO=false` avant `npm run seed`.

| Utilisateur | Rôle | Affectation |
|---|---|---|
| `sg` | Secrétaire Général | Autorité hors DEP (supervision) |
| `directeur` | Directeur | Direction |
| `cb.secretariat` | Chef de Bureau | **Bureau Secrétariat de Direction** (rattaché au Directeur) |
| `ag.secretariat1`, `ag.secretariat2` | Agent | Bureau Secrétariat de Direction |
| `cd.etudes`, `cd.planification`, `cd.suivi` | Chef de Division | Les trois Divisions |
| `cb.est`, `cb.vtp`, `cb.pls`, `cb.pip`, `cb.sev`, `cb.sta` | Chef de Bureau | Bureaux des Divisions |
| `ag.est1`, `ag.est2`, `ag.vtp1`, … `ag.sta2` | Agent | Bureaux des Divisions |

Les intitulés des Divisions et des Bureaux créés par le seed sont **indicatifs**. Ils se modifient dans l’application (module Organisation, par le Directeur) ou dans `backend/src/db/seed-data/organisation.js`, pour correspondre au cadre organique officiel.

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
| `modules/*` | Une route par module : `auth`, `organisation`, `agents`, `users`, `presences`, `courriers`, `instructions`, `tasks`, `documents`, `pip`, `notifications`, `audit`, `attachments`, `dashboard`, `rapports`, `systeme`, `hierarchie` |

**Frontend** (`frontend/src`)

| Dossier | Rôle |
|---|---|
| `lib/api.js` | Axios avec renouvellement automatique du jeton, messages d’erreur, téléchargements |
| `store/auth.js` | Session (Zustand) : utilisateur, permissions, compteurs |
| `components/ui` | Tableaux avec recherche et pagination, badges, fenêtres de confirmation, notifications éphémères, états de chargement et d’erreur |
| `components/shared.jsx` | Historique, pièces jointes, exports, formulaires guidés dynamiques |
| `components/layout` | Menu latéral selon les permissions, en-tête, fil d’Ariane, impression |
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
| Hiérarchie | Nœud `BUR:<id>` dont le parent est `DIR:<id>` : seul le Directeur l’instruit ; aucun Chef de Division ne le supervise. |
| Statistiques | La table `divisions` ne contient que des Divisions. Organigramme, tableaux de bord et rapports affichent à part les « Bureaux rattachés au Directeur ». |
| Interface | Badge « Rang : Bureau », mention « Bureau directement rattaché au Directeur », icône de Bureau. Tableau de bord de Chef de Bureau pour son Chef. |

Ces règles sont vérifiées par `backend/tests/secretariat.test.js`.

---

## 4. Rôles, permissions et périmètres

Une autorisation dépend à la fois du **rôle**, des **permissions**, de l’**affectation active**, du **périmètre**, du **statut du compte** et de la **structure** concernée. Une permission ne donne jamais accès à toutes les données : chaque requête est filtrée par périmètre (`services/scope.js`, `services/access.js`).

| Rôle | Périmètre | Principales permissions |
|---|---|---|
| Admin | `SYSTEME` | paramètres, état du système, sauvegardes, audit, comptes initiaux (SG et Directeur), activation, réinitialisation, déverrouillage, révocation des sessions, gestion des rôles. **Aucune** permission de validation fonctionnelle. Le rôle ADMIN ne peut pas recevoir de permission métier. |
| Secrétaire Général | `SUPERVISION_GLOBALE` (lecture) | consultation de toute la DEP (documents : validés uniquement), instructions **au Directeur uniquement**, validation et clôture de ses propres instructions |
| Directeur | `DIRECTION` | tout le fonctionnel de la DEP : organisation, cadre organique, personnel, affectations, création et autorisation des comptes DEP, délégations, courriers, instructions, validation finale des documents et PIP, verrouillage des présences, rapports |
| Chef de Division | `DIVISION` | sa Division et ses Bureaux : instructions aux Chefs de Bureau, examen et validation au niveau Division, vérification des PIP, présences du périmètre, rapports |
| Chef de Bureau | `BUREAU` | son Bureau : tâches aux Agents, présences (saisie, vérification, soumission), examen et transmission des documents, rapports du Bureau |
| Agent | `PERSONNEL` | ses tâches, ses documents, son profil, ses notifications, informations collectives validées du Bureau |

**Délégations du Directeur** (table `user_permissions`, écran « Délégations ») au seul Chef du Bureau Secrétariat de Direction : `comptes.preparer`, `personnel.suivre`, `presences.preparer_direction`, `courriers.enregistrer`, `dossiers.transmettre`. Ces délégations ne changent ni son rang ni son périmètre.

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
| Comptes | Admin → comptes initiaux (SG, Directeur). Directeur → comptes DEP (actifs). Bureau Secrétariat (délégation) → comptes **préparés** (désactivés) → autorisation du Directeur. Mot de passe temporaire à changer, verrouillage après 5 échecs pendant 15 min (déverrouillage automatique ou par l’Admin), historique des connexions, révocation des sessions. |
| Affectations | Une nouvelle affectation **clôture** la précédente (date de fin et motif) sans rien supprimer. Un seul responsable par structure. Notification à l’Agent. |
| Présences | `Brouillon → Vérifiée → Soumise → Verrouillée`. La soumission verrouille la liste en écriture (API et déclencheur PostgreSQL). Le Directeur réceptionne ; à défaut, verrouillage automatique après `PRESENCE_AUTOLOCK_HOURS`. Toute correction passe par un **rectificatif** lié à l’original. |
| Courriers | Enregistrement numéroté (`DEP/CE/2026/0001`, `DEP/CS/…`), transmissions horodatées avec accusé de réception, annotations, statut « Traité », classement, archivage. Les courriers confidentiels ne sont visibles que de leur chaîne de transmission, du Directeur et du SG. |
| Instructions | `Brouillon → Transmise → Reçue → En cours → Exécutée → Validée → Clôturée`, avec `À corriger` et `En retard` (automatique). Déclinaison en sous-instructions ou en tâches. |
| Tâches | Même cycle, entre le Chef de Bureau et un Agent de son Bureau. |
| Documents | Rédaction guidée (10 modèles) → transmission au supérieur direct → examen (retour pour correction, visa) → validation Division (Chef de Division) → validation et signature du Directeur → archivage. Chaque enregistrement crée une version ; les versions ne peuvent pas être supprimées (déclencheur). |
| PIP | `Brouillon → En vérification (Chef de Division, ou Directeur pour les structures rattachées à la Direction) → Vérifiée → Validée (Directeur) → Archivée`, avec retour `À corriger`. Page de contrôle générée automatiquement. |

Les exports disponibles : présences (PDF, Excel), registre des courriers et fiche de circulation, instructions et tâches, documents (PDF, Word, Excel pour les tableaux), fiches et portefeuille PIP, personnel, rapports mensuels, trimestriels et annuels, journal d’audit (Excel). Chaque export est audité.

---

## 6. Modèle de données

| Domaine | Tables |
|---|---|
| Organisation | `directions`, `divisions`, `bureaux` (+ vue `v_structures`), `grades`, `fonctions`, `postes_organiques`, `attributions` (missions, attributions, responsabilités) |
| Personnel | `agents`, `affectations` (une seule active par Agent, historique conservé) |
| Sécurité | `users`, `roles`, `permissions`, `user_roles`, `role_permissions`, `user_permissions` (délégations), `refresh_tokens` (rotation par famille), `login_history`, `parametres` |
| Présences | `presence_sheets`, `presence_entries` |
| Courriers | `courriers`, `courrier_transmissions`, `courrier_annotations` |
| Activités | `instructions`, `tasks`, `historiques` |
| Documents | `documents`, `document_versions`, `document_comments` |
| PIP | `pip_projects`, `pip_versions` |
| Transverse | `attachments`, `notifications`, `audit_logs`, `sequences` |

Principes appliqués :

* clés étrangères, index et contraintes `CHECK` ;
* transactions pour les opérations composées ;
* tables en **ajout seul**, protégées par déclencheur : `audit_logs`, `document_versions`, `pip_versions`, `historiques` (et pas de suppression de transmission de courrier) ;
* archivage ou désactivation plutôt que suppression, pour les agents, structures, attributions, comptes et pièces jointes.

---

## 7. Sécurité

* Mots de passe hachés avec **bcrypt** (coût 12). Politique : 8 caractères minimum, avec lettre, chiffre et caractère spécial.
* **Jeton d’accès** JWT de courte durée (`ACCESS_TOKEN_TTL`, 15 min), gardé en mémoire côté navigateur.
* **Refresh token** aléatoire dans un cookie `httpOnly`, `SameSite=Strict`, limité au chemin `/api/auth`. Seule son empreinte SHA-256 est stockée. Rotation à chaque renouvellement ; la réutilisation d’un ancien jeton révoque toute la famille.
* `token_version` : un changement de mot de passe, une désactivation ou un changement de rôle invalide immédiatement les jetons existants.
* **Helmet**, CORS configuré par `CORS_ORIGINS`, limitation anti-brute-force **uniquement** sur `/api/auth/login`, verrouillage du compte après `MAX_FAILED_LOGINS` échecs.
* Validation **Zod** de toutes les entrées. Requêtes paramétrées via Knex.
* Permission vérifiée sur chaque route, puis filtrage par périmètre et contrôle hiérarchique.
* Pièces jointes stockées hors de la racine web sous un nom aléatoire (UUID), avec liste blanche de types MIME, taille maximale (15 Mo par défaut) et empreinte SHA-256. Téléchargement authentifié et contrôlé par le périmètre de l’élément parent.
* Messages d’erreur en français, sans détail technique en production.
* Secrets dans `.env` (jamais versionné). L’API refuse de démarrer en production avec le secret JWT d’exemple.

---

## 8. Tests

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
* les comptes préparés puis autorisés, l’historique des affectations et le journal d’audit en lecture seule ;
* les exports PDF, Excel et Word, et les tableaux de bord de chaque rôle.

---

## 9. Sauvegarde PostgreSQL

**Depuis l’application** : Admin → Système → « Lancer une sauvegarde ». Les fichiers sont téléchargeables depuis le même écran.

**En ligne de commande** (Linux ou Git Bash) :

```bash
cd backend
npm run backup                       # → storage/backups/sig-dep-AAAA-MM-JJ_HHMMSS.dump (30 derniers conservés)
```

Sous Windows, si `pg_dump` n’est pas dans le `PATH`, renseignez dans `.env` :

```
PG_DUMP_PATH="C:/Program Files/PostgreSQL/16/bin/pg_dump.exe"
```

**Restauration** :

```bash
pg_restore --clean --if-exists --no-owner -d "postgres://sigdep:MOTDEPASSE@localhost:5432/sig_dep" storage/backups/sig-dep-….dump
```

**Planification** :

* Linux : `crontab -e`, puis `0 2 * * * cd /opt/sig-dep/backend && npm run backup >> /var/log/sig-dep-backup.log 2>&1`
* Windows : Planificateur de tâches → programme `C:\Program Files\Git\bin\bash.exe` → arguments `-lc "cd /c/sig-dep/backend && npm run backup"`

Sauvegardez aussi le dossier `backend/storage/uploads` (pièces jointes et photos), et conservez une copie hors du serveur.

---

## 10. Mise en production

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
6. **Première connexion** : se connecter en `admin` / `dep@2026`, changer le mot de passe, puis créer les comptes du Secrétaire Général et du Directeur (Comptes → Nouveau compte → « Compte institutionnel initial »). Le Directeur crée ensuite, ou autorise, les comptes de la DEP.
7. **Exploitation** : sauvegardes planifiées, mises à jour de sécurité, surveillance des journaux (`pm2 logs`), consultation régulière du journal d’audit et des comptes verrouillés.

En cas de perte du mot de passe Admin :

```bash
cd backend
npm run reset-admin
```

---

## 11. Appellation officielle

L’appellation **« Direction d’Études et Planification »** (sigle **DEP**) est utilisée partout : interface, documents générés, exports, base de données (`directions.nom`), notifications et documentation. Le paramètre `direction_nom` est verrouillé côté API.

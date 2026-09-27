# Journal des versions — SIG-DEP

## 1.1.0

### Nouveautés
- **Gestion des structures dans l’interface** (Directeur) : création, modification et archivage des Divisions et des Bureaux depuis l’organigramme. Les postes organiques (Chef de Division, Chef de Bureau, Agent) sont créés automatiquement. Un poste libre peut être désactivé depuis le cadre organique.
- **Recherche globale** (en-tête, raccourci Ctrl+K) : Personnel, instructions, tâches, courriers, documents et fiches PIP, toujours limitée au périmètre de l’utilisateur (route `GET /api/recherche?q=`).
- **Déconnexion automatique après inactivité**, avec fenêtre d’avertissement et bouton « Rester connecté » (`VITE_INACTIVITY_MINUTES`).
- **Police embarquée** (`@fontsource/source-sans-3`, latin et latin étendu) : plus aucun appel à Google Fonts, fonctionnement hors ligne.
- **Activité de démonstration** (seed `05_demo_activites.js`, `SEED_DEMO=true`) pour des tableaux de bord et des rapports alimentés.
- **Intégration continue** GitHub Actions : tests de l’API sur PostgreSQL 16 et compilation de l’interface.

### Corrections
- Le supérieur hiérarchique d’un Chef de Bureau est désormais calculé à partir du **rattachement** du Bureau (`parent_type`) et non de l’indicateur « Secrétariat ». Un nouveau Bureau rattaché au Directeur dépend bien du Directeur.
- Un changement de rattachement d’un Bureau est propagé aux postes et aux affectations en cours.
- Le journal d’audit sérialise correctement les expressions SQL (ex. date d’archivage d’un courrier). L’écriture échouait silencieusement auparavant.
- Le badge « Bureau directement rattaché au Directeur » s’applique à tout Bureau rattaché au Directeur.
- Une nouvelle Division ou un nouveau Bureau se place en fin de liste dans l’organigramme.

## 1.0.0
- Première version : API REST (Express, PostgreSQL, Knex) et interface React couvrant organisation, personnel, comptes, présences, courriers, instructions, tâches, documents de service, PIP, notifications, audit, tableaux de bord, rapports et exports PDF, Excel et Word.

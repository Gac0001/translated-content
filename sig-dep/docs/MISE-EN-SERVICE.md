# SIG-DEP — Guide de mise en service

Ce guide accompagne l’installation de SIG-DEP sur le serveur de la Direction d’Études et Planification,
puis le passage aux données réelles. Il s’applique à **Windows** comme à **Linux**. Il est fourni dans
chaque paquet d’installation (`docs/MISE-EN-SERVICE.md`).

Hébergement retenu pour le démarrage : **serveur local** (poste dédié ou serveur du réseau interne),
l’application étant ouverte par les agents à l’adresse du serveur sur le réseau
(par exemple `http://192.168.1.10:4000`). Le passage au HTTPS et l’activation des e-mails sont prévus
dès que le certificat et le serveur de messagerie du Ministère seront disponibles (section 6).

---

## 1. Ce qu’il faut avant de commencer

| Élément | Détail |
|---|---|
| Serveur | Windows 10/11 ou Windows Server 2019+, ou Linux (Ubuntu 22.04 ou 24.04). 4 Go de mémoire, 50 Go de disque libre au moins, adresse IP **fixe** sur le réseau. |
| Node.js | Version **22 LTS** (https://nodejs.org). Vérifier : `node --version`. |
| PostgreSQL | Version 16 (Windows : programme d’installation EDB ; Linux : `sudo apt install postgresql`). Les outils `pg_dump` et `pg_restore` sont installés avec. |
| Paquet | `sig-dep-x.y.z.zip` et son empreinte `sig-dep-x.y.z.zip.sha256`, préparés par `npm run paquet` (dossier `backend`) sur le poste de développement. |
| Sauvegarde externe | Un disque externe ou un partage réseau pour la copie des sauvegardes (recommandé). |
| Personnes | L’Admin Système (installation), le Directeur (validation de la liste déclarative), le Bureau Secrétariat de Direction (enrôlement des agents). |

**Le serveur n’a pas besoin d’accès à Internet** : le paquet contient tout ce qu’il faut.

## 2. Préparer la base PostgreSQL

Créer un utilisateur et une base dédiés, avec un mot de passe fort (à noter dans le coffre de la Direction).

Linux :

```bash
sudo -u postgres psql -c "CREATE USER sigdep WITH PASSWORD 'mot-de-passe-fort';"
sudo -u postgres psql -c "CREATE DATABASE sig_dep OWNER sigdep;"
```

Windows (invite de commandes, dossier `C:\Program Files\PostgreSQL\16\bin`) :

```bat
psql -U postgres -c "CREATE USER sigdep WITH PASSWORD 'mot-de-passe-fort';"
psql -U postgres -c "CREATE DATABASE sig_dep OWNER sigdep;"
```

Le port 5432 ne doit **pas** être ouvert sur le réseau : seule l’application, sur le même serveur, s’y connecte.

## 3. Installer l’application

1. Copier le paquet sur le serveur et **vérifier son empreinte** ; elle doit être identique au contenu du fichier `.sha256` :
   - Windows : `certutil -hashfile sig-dep-x.y.z.zip SHA256`
   - Linux : `sha256sum sig-dep-x.y.z.zip`
2. Décompresser le paquet, puis ouvrir une invite de commandes **en administrateur** (Windows) ou un terminal (Linux) dans le dossier `sig-dep-x.y.z`.
3. Lancer l’installateur une première fois :
   - Windows : `node backend\scripts\installer-serveur.js`
   - Linux : `sudo node backend/scripts/installer-serveur.js`

   Il crée le dossier d’installation (`C:\SIG-DEP` ou `/opt/sig-dep` ; autre dossier : `--racine=D:\SIG-DEP`) et le fichier de configuration `config/.env`, avec des secrets générés pour ce serveur.
   Il affiche la **clé de chiffrement des sauvegardes** : la recopier sur papier, la mettre sous pli scellé et la ranger au coffre. Sans elle, aucune sauvegarde ne peut être restaurée.
4. Ouvrir `config/.env` et compléter :
   - `DATABASE_URL` : mot de passe de l’utilisateur `sigdep` ;
   - `APP_URL` et `CORS_ORIGINS` : adresse du serveur sur le réseau, par exemple `http://192.168.1.10:4000` ;
   - `PUBLIC_URL` : adresse de la page de vérification des cartes de service, à fixer **avant d’imprimer les premières cartes** ;
   - `BACKUP_COPY_DIR` : disque externe ou partage réseau pour la copie des sauvegardes ;
   - Windows : `PG_DUMP_PATH` et `PG_RESTORE_PATH` si les outils PostgreSQL ne sont pas dans le PATH.
5. Relancer l’installateur, cette fois avec la déclaration du service :
   - Windows : `node backend\scripts\installer-serveur.js --service`
     (télécharger auparavant `WinSW-x64.exe` 2.12.0 sur https://github.com/winsw/winsw/releases et l’enregistrer sous `C:\SIG-DEP\service\SIG-DEP.exe` ; l’installateur l’indique s’il manque) ;
   - Linux : `sudo node backend/scripts/installer-serveur.js --service`.

   L’installateur crée la structure de la base et les données de référence (organigramme, rôles, compte Admin), déclare le service (démarrage automatique, redémarrage en cas d’arrêt), puis lance le **contrôle de préparation**.
6. Ouvrir le pare-feu du serveur sur le port de l’application (4000 par défaut), pour le réseau interne uniquement.

Structure installée :

```
C:\SIG-DEP  (ou /opt/sig-dep)
├── config\.env              configuration et secrets du serveur (à ne jamais copier ailleurs)
├── config\installations.json  historique des installations et mises à jour
├── donnees\pieces           pièces jointes, photos, documents
├── donnees\sauvegardes      sauvegardes de la base
├── versions\x.y.z           versions installées (les trois dernières sont conservées)
├── courante                 lien vers la version en service
├── journaux                 journal du service
└── service                  service Windows (WinSW)
```

## 4. Contrôle de préparation

À lancer avant l’ouverture, puis après chaque mise à jour ou modification de `config/.env` :

- Windows : `cd C:\SIG-DEP\courante\backend` puis `set SIGDEP_ENV_FILE=C:\SIG-DEP\config\.env` et `npm run verifier-production`
- Linux : `cd /opt/sig-dep/courante/backend && sudo -u sigdep SIGDEP_ENV_FILE=/opt/sig-dep/config/.env npm run verifier-production`

Le même contrôle figure sur la page **Santé du système** de l’Admin (« Préparation à la mise en production »).
Chaque point est **Conforme**, **À surveiller** (à corriger dès que possible) ou **Bloquant** (à corriger avant
l’ouverture), avec la marche à suivre. Points attendus au démarrage en réseau local :
« Connexion chiffrée (HTTPS) » et « Envoi des e-mails » **à surveiller** ; aucun point bloquant.

## 5. Le jour de l’ouverture

Cocher chaque étape ; l’Admin et le Directeur signent la liste à la fin.

| # | Étape | Qui | Fait |
|---|---|---|---|
| 1 | Installation terminée, service démarré, contrôle de préparation sans point bloquant | Admin | ☐ |
| 2 | Première connexion Admin (`admin` / `dep@2026`) : nouveau mot de passe, double authentification, codes de secours imprimés et rangés | Admin | ☐ |
| 3 | Si la base contient des données fictives (base de démonstration réutilisée) : Système → Réinitialisation → « base vierge » | Admin | ☐ |
| 4 | Sauvegardes → « Sauvegarder maintenant », puis « Tester la restauration » : les deux réussis | Admin | ☐ |
| 5 | Copie hors du serveur constatée (fichier présent sur le disque externe ou le partage) | Admin | ☐ |
| 6 | Comptes du Secrétaire Général et du Directeur créés (Comptes → « Compte institutionnel ») | Admin | ☐ |
| 7 | Première connexion du Directeur : mot de passe, double authentification | Directeur | ☐ |
| 8 | Import de la liste déclarative réelle, vérification, validation, génération du PDF signé | Directeur | ☐ |
| 9 | Enrôlement du Bureau Secrétariat de Direction | Admin | ☐ |
| 10 | Enrôlement des agents des Divisions et des Bureaux | Secrétariat | ☐ |
| 11 | Modèle de carte de service vérifié ; spécimen de signature du Directeur déposé ; `PUBLIC_URL` définitive | Admin, Directeur | ☐ |
| 12 | Essai sur un poste d’agent : connexion, tableau de bord, une action simple | Secrétariat | ☐ |
| 13 | Contrôle de préparation relancé : aucun point bloquant | Admin | ☐ |

Date : ____________  Admin : ____________________  Directeur : ____________________

Les **fichiers réels** (liste du personnel, photos, documents du Ministère) ne sont importés que sur le
serveur, par l’application ; ils ne doivent jamais être copiés dans le dépôt de code ni envoyés par messagerie.

## 6. Plus tard : HTTPS et e-mails

**HTTPS** (recommandé dès que possible : sans lui, les mots de passe circulent en clair sur le réseau) :

1. Obtenir un certificat pour l’adresse du serveur, par exemple auprès du service informatique du Ministère
   (fichiers `certificat.pem` et `cle-privee.pem`), et le copier dans `config/`.
2. Dans `config/.env` : décommenter `TLS_CERT_FILE` et `TLS_KEY_FILE` ; passer `APP_URL`, `CORS_ORIGINS`
   (et `PUBLIC_URL` si aucune carte n’a encore été imprimée) en `https://` ; `COOKIE_SECURE=true` ;
   éventuellement `PORT=443` et `HTTP_REDIRECT_PORT=80`.
3. Redémarrer le service et relancer le contrôle de préparation.

Si un serveur Nginx est déjà le point d’entrée HTTPS (Linux), utiliser `deploy/linux/nginx-sig-dep.conf`
et mettre `TRUST_PROXY=1`.

**E-mails** : quand le serveur SMTP du Ministère sera disponible, renseigner `SMTP_HOST`, `SMTP_PORT`,
`SMTP_USER`, `SMTP_PASS`, `MAIL_FROM`, puis `MAIL_ENABLED=true`, redémarrer, et envoyer un message d’essai
depuis Système → Messagerie. En attendant, les notifications restent visibles dans l’application et les
mots de passe oubliés sont réinitialisés par l’Admin.

## 7. Mettre à jour

1. Préparer le nouveau paquet (`npm run paquet`), le copier sur le serveur, vérifier son empreinte, le décompresser.
2. Prévenir les utilisateurs (Système → Maintenance : annonce, puis mode maintenance si l’interruption dure).
3. Depuis le dossier du nouveau paquet : `node backend\scripts\installer-serveur.js` (Windows, en administrateur)
   ou `sudo node backend/scripts/installer-serveur.js` (Linux).

L’installateur copie la nouvelle version **à côté** de l’ancienne, sauvegarde la base, applique les migrations,
bascule le lien `courante`, redémarre le service et relance le contrôle de préparation. Si une migration
échoue, elle est annulée : la base et la version en service restent inchangées.

**Revenir à la version précédente** (anomalie constatée après la mise à jour) :
`node backend\scripts\installer-serveur.js --revenir` depuis le dossier du paquet. Les migrations ajoutées par
la mise à jour sont défaites, puis le service repart sur la version précédente.

## 8. Incidents

| Situation | Que faire |
|---|---|
| L’application ne répond plus | Vérifier le service (Windows : « Services » → SIG-DEP ; Linux : `systemctl status sig-dep`) et le journal (`journaux/`). Redémarrer le service. Vérifier que PostgreSQL est démarré. |
| Page Santé : un service en panne | Suivre le détail affiché ; une alerte est adressée à l’Admin et au Directeur à chaque panne et rétablissement. |
| Mot de passe Admin perdu | Sur le serveur : `cd courante/backend` puis `npm run reset-admin` (avec `SIGDEP_ENV_FILE` comme en section 4) : mot de passe temporaire `dep@2026`, à changer aussitôt. |
| Accès impossible pour tous les comptes d’administration | Compte d’urgence, activé par le Directeur ou le Secrétaire Général (procédure du README, « Gouvernance »). |
| Mise à jour défectueuse | `--revenir` (section 7). Si l’annulation est impossible, restaurer la sauvegarde prise juste avant la mise à jour (nom indiqué par l’installateur et dans `config/installations.json`). |
| Restaurer une sauvegarde | Par l’application : Admin → Sauvegardes → demande de restauration, validée par le Directeur. En dernier recours, sur le serveur : `pg_restore --clean --if-exists -d sig_dep fichier.dump` (après déchiffrement avec la clé conservée au coffre ; voir README, « Restauration »). |
| Serveur perdu ou détruit | Nouveau serveur : sections 2 et 3 avec la **même clé** `BACKUP_ENC_KEY` (recopiée depuis le pli scellé), puis restauration de la dernière copie hors serveur et des pièces jointes (`donnees/pieces`). |

Contacts à renseigner : Admin Système ____________________ ; informatique du Ministère ____________________.

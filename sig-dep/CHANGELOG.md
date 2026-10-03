# Journal des versions — SIG-DEP

## 1.7.0

### Compte Admin Système (lot 2 : supervision)
- **Tableau de bord Admin** complet : comptes (total, actifs, désactivés, verrouillés, inactifs), sessions actives, échecs de connexion (24 h / 7 j), alertes ouvertes, état des services, espace disque, dernière sauvegarde réussie, sauvegardes échouées, erreurs techniques récentes, version de l’application (numéro et révision), dernières opérations sensibles.
- **Centre de santé du système** : API, PostgreSQL, stockage, sauvegarde, courriels, génération PDF/Excel ; contrôle automatique toutes les 15 minutes et à la demande, historique sur 48 heures, alertes de panne et de rétablissement.
- **Journal technique** : erreurs internes regroupées par cause (occurrences, dernière requête, pile d’appels), résolution, purge après 90 jours.
- **Registre des sauvegardes** (réussies et échouées), affiché dans Système → Sauvegardes ; alerte en cas d’échec.
- **Rapport mensuel de sécurité** : génération automatique au début du mois, à la demande pour un mois donné, PDF avec visa du Directeur ; consultable par l’Admin Système et le Directeur (`rapport_securite.consulter`).
- **Incidents critiques** notifiés immédiatement au Directeur.
- Politique : seuils d’espace disque et durée de conservation du journal technique.

## 1.6.0

### Compte Admin Système (lot 1 : sécurité du compte)
- Rôle **Admin Système** (`ADMIN_SYSTEME`, périmètre `SYSTEME`, aucune autorité administrative) et nouveau référentiel de permissions techniques : `systeme.consulter|configurer|maintenir`, `securite.superviser`, `compte.*`, `session.consulter|revoquer`, `role.consulter|attribuer`, `permission.consulter`, `audit.consulter|exporter`, `sauvegarde.creer|restaurer`, `organisation.configurer`, `referentiel.gerer`, `modele_carte.configurer`, `notification_systeme.envoyer`. Les attributions existantes sont conservées par la migration.
- **Première connexion** imposée : changement du mot de passe, **double authentification** (application TOTP, QR code, 10 codes de secours), adresse électronique de récupération (vérifiée par code si la messagerie est active), acceptation des règles de sécurité.
- **Connexion en deux temps** (mot de passe puis code), codes de secours à usage unique, **récupération du mot de passe** par code e-mail + second facteur, changement d’appareil et régénération des codes depuis le profil.
- **Politique des mots de passe et des sessions** configurable dans des bornes sûres : longueur, complexité, mots de passe courants refusés, historique (5 derniers interdits), expiration, verrouillage, durée maximale de session, délai d’inactivité, comptes inactifs.
- **Gestion des comptes** : désactivation (`compte.desactiver`), **blocage temporaire** d’un compte compromis, **changement de mot de passe imposé**, comptes inactifs (filtre, désactivation automatique facultative hors comptes institutionnels), sessions actives avec adresse IP et fermeture individuelle, historique de connexion.
- **Rôles protégés** : aucun rôle institutionnel ne peut être supprimé ni renommé (protection en base) ; l’Admin ne peut ni attribuer ni retirer les rôles Directeur, Chef de Division, Secrétaire Général et Admin Système sans décision administrative enregistrée ; aucune permission technique pour les rôles institutionnels ; rôle Admin Système non modifiable depuis l’application.
- **Page Sécurité** : alertes (avec traitement), connexions et adresses IP suspectes, sessions actives, politique, **vérification de sécurité**.
- **Journal d’audit infalsifiable** : chaînage SHA-256, vérification d’intégrité, export Excel / CSV / PDF (`audit.exporter`), troncature interdite ; historique des connexions en ajout seul.
- **Alertes de sécurité** notifiées à l’Admin (et par e-mail sur son adresse de récupération).

### Changements
- **Liste déclarative** : réservée au Directeur ; l’Admin n’y a plus accès. Il n’enrôle que les agents du Bureau Secrétariat de Direction **autorisés nominativement par le Directeur** (bouton « Autoriser l’enrôlement par l’Admin ») ; le Secrétariat enrôle ensuite les autres agents.
- La **réinitialisation de la base** conserve désormais le journal d’audit, l’historique des connexions et les alertes, ainsi que la double authentification de l’Admin.
- Les paramètres de sécurité ne sont plus modifiables par l’écran des paramètres généraux.

## 1.5.0

### Mise en service : réinitialisation de la base par l’Admin
- Dès sa connexion, l’Admin est averti si la base contient des **données fictives** et peut la **réinitialiser** (Administration → Réinitialisation) :
  - **base vierge** pour la mise en service : suppression du personnel, des comptes, des activités, des pièces jointes et des journaux ; l’organigramme, les référentiels, les paramètres et le compte Admin sont conservés ;
  - ou **rechargement des données fictives** pour une formation.
- Garde-fous : phrase `REINITIALISER`, mot de passe Admin, sauvegarde automatique préalable (annulation si elle échoue), transaction unique, audit.
- Le tableau de bord guide ensuite la mise en service : compte du Directeur, import de la liste officielle, validation, enrôlement.
- **Liste officielle** : bouton « Liste officielle (PDF) » une fois la liste validée. Une liste non validée s’exporte comme « Projet de liste déclarative ».

### Enrôlement en cinq étapes
- **Identification** par matricule (avec ou sans points) ou par nom, dans toute la base, avec la raison pour laquelle un agent n’est pas enrôlable (absent de la liste, liste à revalider, compte existant, hors portée).
- **Fiche générée** depuis la liste validée et **attestation d’identité**.
- **Confirmation de l’affectation** au vu de la commission d’affectation jointe.
- Informations complémentaires et photo, puis **récapitulatif** avant création du compte.
- Les confirmations d’identité et d’affectation sont exigées par l’API et tracées dans l’audit.

### Divers
- Les permissions obsolètes de l’ancien circuit de création des comptes (`comptes.creer`, `comptes.preparer`) sont retirées des bases existantes.

## 1.4.0

### Liste déclarative et enrôlement des agents
- **Liste déclarative** des agents de la Direction (menu « Liste déclarative ») : statut (non validée, validée, à revalider), écarts depuis la dernière validation, inscription et retrait, historique des validations, exports PDF (bloc de signature du Directeur) et Excel.
- **Validation** réservée au Directeur et à l’Admin, seuls à voir le bouton « Valider la liste ». Chaque validation enregistre un instantané daté, non modifiable (table en ajout seul).
- **Enrôlement** (menu « Enrôlement des agents ») : un compte ne peut être créé que pour un agent de la liste validée. Le formulaire est prérempli à partir de la fiche. Sont obligatoires : sexe, date de naissance, date de mise en service, numéro de carte IGAP (unique), fonction conforme au grade, photo et commission d’affectation. La structure se choisit à l’enrôlement si l’agent n’est pas encore affecté.
- **Portée** : l’Admin enrôle tous les agents, en commençant par le Bureau Secrétariat de Direction. Les membres de ce Bureau enrôlent ensuite les agents des Divisions et des autres Bureaux, mais pas ceux du Secrétariat. Aucun autre utilisateur ne voit l’option.
- Un agent ajouté ou modifié (matricule, grade, affectation) après la validation n’est enrôlable qu’après **revalidation**.
- La fiche Agent affiche le lieu de naissance, la date de mise en service, le numéro de carte IGAP, la commission d’affectation (téléchargeable) et la situation sur la liste.
- Le tableau de bord affiche l’avancement de la mise en service des comptes.
- Fonctions « Agent administratif » (AGA1) et « Agent auxiliaire » (AA2) ajoutées au référentiel.

### Changements
- Le Directeur ne crée plus les comptes des agents : il valide la liste déclarative. L’ancien circuit « compte préparé par le Secrétariat puis autorisé par le Directeur » (`POST /api/users`, `/autoriser`, permissions `comptes.creer` et `comptes.preparer`) est supprimé. La création des comptes institutionnels (SG, Directeur) par l’Admin est inchangée.
- Les modules de l’API sont chargés explicitement : un module manquant fait échouer le démarrage au lieu d’être ignoré.

## 1.3.0

### Organigramme réel et import du personnel
- **Organigramme de la DEP** conforme à la liste officielle des agents : Bureau Secrétariat de Direction ; Division Études, Documentation et Information (Bureaux Études, Analyses et Perspective ; Documentation et Information) ; Division Stratégies et Coopération Internationale (Bureaux Stratégies ; Coopération Internationale) ; Division Programme et Suivi (Bureaux Programme ; Suivi-Évaluation). Missions et attributions à valider par le Directeur.
- **Import du personnel** (Personnel → Importer une liste) depuis Word (.docx), Excel (.xlsx) ou CSV : lecture des lignes de section, reconnaissance des structures sans tenir compte des accents ni de la numérotation, découpage nom / postnom / prénom, normalisation des matricules, poste proposé selon le grade (CD, CB), contrôles et anomalies, correction ligne par ligne, exécution en une seule transaction revalidée par le serveur, rapport détaillé et audit. Modèle Excel prérempli téléchargeable.
- Grades **AA1** et **AA2** (Agent auxiliaire de 1re et 2e classe) ajoutés au référentiel.
- Le **sexe** d’un Agent devient facultatif (« Non renseigné ») : il n’est jamais déduit du prénom.
- Identifiants des comptes de démonstration alignés sur la nouvelle structure (`cd.edi`, `cb.eap`, `ag.eap1`…).

### Correction
- Création d’un compte institutionnel initial impossible lorsque la date de prise de fonction était laissée vide (« Invalid ISO date »).

## 1.2.0

### Notifications par e-mail
- Envoi par e-mail des notifications internes : instructions et comptes rendus, tâches, transmissions de courrier, documents, échéances proches, retards, présences, PIP, affectations, comptes.
- File d’envoi durable (`email_outbox`), traitée chaque minute, avec réessais espacés (1, 5, 15, 60 min), puis échec après `MAIL_MAX_ATTEMPTS`. Pas de double envoi entre plusieurs instances.
- Éléments confidentiels : l’e-mail ne révèle ni l’objet ni le contenu. Aucun mot de passe n’est envoyé par e-mail.
- Préférences par utilisateur (activation globale et par type) : Notifications → « Préférences e-mail » et page Profil.
- Administration (Système → Messagerie) : configuration, état de la file, test de connexion SMTP, e-mail de test, envoi immédiat, relance des échecs, comptes sans adresse.
- E-mails institutionnels (en-tête RDC / Secrétariat Général / DEP), en versions HTML et texte, avec lien direct vers l’élément.
- Configuration par `.env` (`MAIL_ENABLED`, `SMTP_*`, `MAIL_FROM`, `APP_URL`) ; désactivé par défaut.
- Purge des e-mails envoyés après 90 jours.

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

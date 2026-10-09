# Journal des versions — SIG-DEP

## 1.26.0

### Refonte de l’interface — étape 3d : Actes administratifs et Cartes de service sur les composants communs
- **Registre des actes** : filtres (type, statut, en vigueur), recherche, tri et page conservés dans l’adresse ; « Effacer les filtres ».
- **Fiche d’un acte** : circuit (Préparation → Validation du Directeur, ou du Secrétaire Général pour le poste de Directeur → Validé ; refus, révocation, expiration et remplacement signalés) avec « Soumettre » et « Décider » dans l’encadré ; rectificatif, révocation (motif de 5 caractères au moins) et suppression du brouillon dans les actions secondaires ; fenêtre de décision protégée contre le double clic.
- **Saisie d’un acte** : barre d’enregistrement avec protection de la saisie ; champs obligatoires selon le type (intérimaire, poste, période, opérations désignées) et ordre des dates contrôlés avant envoi.
- **Fiche d’une carte de service** : circuit (Préparation → Validation du Directeur → Impression → Remise au titulaire ; suspension, perte, annulation, expiration signalées) avec les actions de l’étape ; validation confirmée ; retour, suspension, perte et annulation avec motif obligatoire ; anomalies du dossier et mentions regroupées dans l’encadré.
- **Registre des cartes** : filtre d’état dans l’adresse, répartition par état, planche A4 ; préparation et renouvellement en boutons compacts ; **Ma carte** : état vide explicatif, déclaration de perte confirmée ; **modèle de carte** (Admin) : barre d’enregistrement, validité saisie en nombre borné (1 à 10 ans).
- La fenêtre de confirmation accepte une longueur minimale de motif (`input.min`).
- Tests de l’interface : 48 réussis (dont 4 nouveaux sur les Actes et les Cartes).

## 1.25.0

### Refonte de l’interface — étape 3c : Réunions, Décisions et Agenda sur les composants communs
- **Réunions** : encadré « Circuit de traitement » (Préparation → Convoquée → Tenue — compte rendu → Validation du président → Clôturée ; annulation et compte rendu retourné signalés) avec les actions de l’étape ; validation du compte rendu confirmée (nombre de décisions rappelé) ; annulation et retour du compte rendu avec motif obligatoire ; « Annuler la réunion » et le PDF regroupés dans les actions secondaires.
- **Préparation d’une réunion** et **compte rendu** : barre d’enregistrement avec protection de la saisie ; contrôles avant envoi (objet, début, fin après le début, responsable de chaque décision) ; champs de l’ordre du jour, des invités et des décisions nommés pour les lecteurs d’écran.
- **Registre des décisions** : filtres (statut, origine, en retard, dont je suis responsable), recherche, tri et page conservés dans l’adresse ; « Effacer les filtres » ; échéance triable.
- **Fiche de décision** : circuit (À exécuter → Mise en œuvre → Exécutée ; retard et abandon signalés) ; mise en œuvre en fenêtre commune ; exécution et abandon avec texte obligatoire.
- **Agenda du Directeur** : semaine affichée conservée dans l’adresse ; rendez-vous en fenêtre commune (fin après le début contrôlée) ; annulation confirmée ; boutons d’action nommés.
- **Corrections** : la semaine de l’agenda et la date minimale des échéances (décisions, demandes d’information) étaient calculées en heure UTC — entre minuit et une heure à Kinshasa, la veille ; elles le sont désormais en heure locale.
- La barre d’enregistrement garde sa protection montée en permanence (activée ou non), pour ne jamais interrompre une navigation déjà confirmée.
- Tests de l’interface : 44 réussis (dont 5 nouveaux sur les Réunions, Décisions et Agenda).

## 1.24.0

### Refonte de l’interface — étape 3b : Données sectorielles sur les composants communs
- **Annuaire** : filtres (catégorie, province, statut), recherche, tri et page conservés dans l’adresse, retrouvés au retour d’une fiche ; « Effacer les filtres » ; colonnes triables. Les listes de filtres ne dépassent plus la largeur de l’écran : **plus aucun débordement horizontal sur téléphone** (le relevé de l’étape 0 est soldé).
- **Circuits de traitement** communs sur les fiches de **campagne** (Préparation → Collecte ouverte → Clôturée → Validée), de **réponse** (Saisie → Transmise au contrôle → Contrôlée) et de **bulletin** (Rédaction → Visa → Autorisation du Directeur → Diffusé), avec les actions de l’étape ; retours pour correction avec motif obligatoire ; clôture de la collecte confirmée (nombre de réponses reçues rappelé).
- **Saisie des réponses** : champs numériques au format français (entiers ou décimaux selon la question), barre d’enregistrement « Enregistrer et contrôler », protection de la saisie ; la transmission au contrôle est bloquée tant que la saisie n’est pas enregistrée ou comporte des erreurs ; « Supprimer le brouillon » regroupé dans les actions secondaires.
- **Campagne** : indicateurs clés (acteurs ciblés, couverture, contrôle) avec barres de progression.
- **Formulaires** (acteur, questionnaire, campagne, indicateur, bulletin, référentiel) en fenêtres communes à sections, champs obligatoires contrôlés avant envoi, confirmation avant d’abandonner une saisie ; éditeur de questionnaire avec barre d’enregistrement.
- **Indicateurs** : tuiles de valeur et d’évolution, tableau des périodes cliquable, répartition par province et catégorie en barres accessibles ; **tableaux croisés** et séries des bulletins en tableaux communs avec totaux.
- Composants : actions secondaires « danger » de l’en-tête en style discret ; listes de filtres bornées à la largeur disponible.
- Tests de l’interface : 39 réussis (dont 5 nouveaux sur les Données sectorielles).

## 1.23.0

### Refonte de l’interface — étape 3a : Planification sur les composants communs
- **Crédits** : grilles de saisie communes par programme (par rubrique et par titre), montants au format français, cellules modifiées signalées, Entrée pour passer à la ligne suivante ; une saisie non enregistrée est protégée, y compris au changement d’onglet.
- **CBMT** : tableau « Respect des plafonds » à en-têtes groupés par année et première colonne fixe ; éditeur avec grilles de plafonds (total par année) et d’hypothèses, barre d’enregistrement et protection de la saisie.
- **Performance** : un tableau par objectif (réalisations, exercice en cours, cibles groupés), valeurs saisies au format français et enregistrées en quittant la cellule ; fenêtres objectif et indicateur en sections, avec confirmation avant d’abandonner une saisie.
- **Fiches PTBA et documents de programmation** : encadré « Circuit de traitement » commun (Préparation → Vérification → Consolidation → Validation du Directeur), actions de l’étape dans l’encadré, validation confirmée, retour pour correction avec motif obligatoire ; exports Excel / PDF / Word regroupés sous « Actions » sur téléphone ; éditeurs avec barre d’enregistrement (coût total du PTBA affiché) et coûts saisis en montants.
- **Exécution, coûts par trimestre, activités du PTBA** : tableaux communs avec lignes de total et sous-totaux par objectif ; saisie de l’exécution trimestrielle en montants, décaissé contrôlé par rapport à l’engagé.
- **Banque des projets, risques, référentiel, nouveaux PTBA et documents** : fenêtres de formulaire communes (champs obligatoires signalés, contrôles avant envoi, criticité du risque calculée pendant la saisie) ; états vides explicatifs.
- Composants : `EditableGrid` signale les cellules modifiées, `SimpleTable` accepte des en-têtes groupés, `EmptyState` une variante compacte, `UnsavedChangesGuard` protège aussi le changement d’onglet (`surOnglet`).
- Tests de l’interface : 34 réussis (dont 4 nouveaux sur la Planification).

## 1.22.0

### Refonte de l’interface — étape 2 : nouveaux composants communs
- **Saisie chiffrée** : `NumberInput` et `MoneyInput` (format français, séparateurs de milliers, virgule décimale, clavier numérique sur téléphone, bornes et décimales contrôlées) ; `EditableGrid`, grille de saisie lignes × colonnes (crédits, plafonds, cibles) avec totaux, alerte par cellule (dépassement de plafond) et passage à la ligne suivante par Entrée ou les flèches.
- **Formulaires** : `FormModal` (Entrée enregistre, bouton bloqué pendant l’enregistrement, confirmation avant d’abandonner une saisie modifiée, erreur affichée une seule fois), `FormSection` (sections titrées, groupes accessibles), `ActionBar` (barre d’enregistrement collée en bas de l’écran, état de la saisie, protection contre la perte des modifications).
- **Affichage** : `SimpleTable` (tableaux de chiffres au style commun, lignes de total, première colonne fixe), `EmptyState` (état vide explicatif avec action), `KpiTile` (indicateur clé : évolution favorable ou défavorable, cible et progression), `WorkQueue` (file « À traiter » des tableaux de bord, échéances dépassées en rouge), `FilterBar` (filtres hors tableau avec « Effacer les filtres »).
- **Onglets dans l’adresse** (`useOnglet`) : l’onglet choisi est retrouvé au retour d’une fiche, au rechargement et dans un lien partagé — Planification, Données sectorielles, Cadre organique, Réunions, Cartes de service, Sécurité, Gouvernance, Sauvegardes, Maintenance. Sur téléphone, au-delà de quatre onglets, une liste déroulante remplace la barre.
- **En-tête de page** : actions secondaires (`menu`) en boutons sur ordinateur, regroupées sous « Actions » sur téléphone.
- **Catalogue des composants** (`/composants`, données fictives, sans appel à l’API) : référence pour les écrans à venir et la formation.
- Tests de l’interface : 30 réussis (dont 4 nouveaux sur les composants et les onglets).

## 1.21.0

### Refonte de l’interface — étape 1 : fondations (style « Bleu État »)
- **Style conforme à la charte graphique du Gouvernement** : menu en bleu institutionnel (`#17418a`), entrée active en bleu marine avec repère jaune du drapeau, tricolore officiel (bleu, jaune, rouge à parts égales) en tête de page, fond gris bleuté, cartes et en-têtes de tableaux harmonisés ; palette de la charte disponible dans Tailwind (`dep`, `rdc`, `charte`).
- **Titres en Cooper Hewitt** (police de la charte, embarquée, licence libre OFL) ; texte courant et tableaux en Source Sans 3. Titres de cartes en casse normale, chiffres clés plus lisibles avec un liseré de couleur.
- **Formats communs** (`lib/format.js` : `fmtNombre`, `fmtCdf`, `fmtPourcent`, `lireNombre`) à la place des formateurs propres à chaque page (Planification, Crédits, CBMT, Indicateurs, Tableaux croisés) ; espaces insécables gérées à la saisie.
- **Statuts accordés au genre** (« Fiche vérifiée », « Campagne validée »…) ; libellé « Vérifié » corrigé.
- **Titre de l’onglet du navigateur** propre à chaque page (« Planification — SIG-DEP ») ; boutons : icônes agrandies, texte en demi-gras ; badges moins arrondis.
- Analyse statique sans aucun avertissement (accessibilité : textes alternatifs des portraits, étiquettes de champs) ; tests de non-régression : 26 réussis, aucun nouveau débordement.

## 1.20.1

### Refonte de l’interface — étape 0 : filet de sécurité (aucun changement visible)
- Analyse statique de l’interface (`npm run lint`, ESLint 9 avec règles React, hooks et accessibilité) : aucune erreur ; 13 avertissements relevés, à corriger à l’étape 1.
- Tests de non-régression Playwright (`npm run test:e2e`) : pour 11 rôles, sur ordinateur et téléphone, chaque entrée du menu doit s’afficher sans erreur JavaScript, sans erreur d’API et avec un titre ; ouverture d’une fiche depuis chaque liste ; captures de référence et relevé des débordements horizontaux (seul relevé : Données sectorielles sur téléphone, 6 px).
- Style graphique retenu pour la refonte : « Bleu État », conforme à la charte du Gouvernement (titres en Cooper Hewitt) — consigné dans `CLAUDE.md`.

## 1.20.0

### Lot 11 — Cadrage budgétaire (CBMT)
- Le **Cadre Budgétaire à Moyen Terme** du Ministère du Budget devient un document de programmation (type CBMT, période de trois exercices), avec le circuit du PAP (Bureau Programme → Chef du Bureau Programme → Chef de la Division Programme et Suivi → Directeur) et son intangibilité une fois validé ; le document du Ministère du Budget et la lettre de cadrage se joignent en pièces.
- Saisie des **plafonds du Ministère par année et par nature** (rémunérations, fonctionnement, interventions, investissements sur ressources extérieures et propres, en CDF), des **hypothèses macroéconomiques** (croissance, inflation, taux de change, PIB nominal), des **orientations du secteur Numérique** et des **actions prioritaires** reliées aux programmes et aux projets de la banque PIP.
- **Contrôle du cadrage** : dans l’onglet Crédits, plafond, prévision et écart par rubrique et par année, dépassements en rouge ; alerte dès l’enregistrement d’une prévision qui dépasse un plafond. Le CBMT applicable est le plus récent couvrant l’exercice, validé de préférence.
- **Exports** : fiche de cadrage Excel (hypothèses, respect des plafonds, actions prioritaires) ; feuille « Respect du CBMT » ajoutée au CDMT ; tableau « Respect des plafonds du CBMT » et actions prioritaires de chaque programme dans le PAP ; pièces jointes possibles sur tous les documents de programmation.
- Démonstration : CBMT fictif validé, avec un dépassement volontaire pour la formation. Aucun chiffre du CBMT réel n’est inclus dans le dépôt : les plafonds réels se saisissent dans l’application.

## 1.19.0

### Démonstration et formation ; travail commun poste local et cloud
- **Mode démonstration** (`DEMO_MODE=true`, refusé en production) : bandeau « Environnement de démonstration — données fictives » ; page de connexion listant les comptes par fonction (un clic remplit l’identifiant et le mot de passe) ; double authentification du Directeur, du Secrétaire Général et de l’Admin conservée mais avec un code de démonstration affiché et saisi d’un clic ; étapes de première connexion déjà accomplies pour ces comptes.
- **Scénario de démonstration complet** (`npm run demo:reset`), joué au travers de l’API et donc de toutes les règles métier, dates recalculées au jour du chargement : réunion de coordination tenue avec compte rendu et décisions (instruction, exécution), réunions convoquées, agenda du Directeur, demandes du Secrétaire Général, programmes et services, PTBA validé avec suivi d’exécution et PTBA soumis, cadre de performance, crédits, PAP, RAP validé, CDMT, banque des projets, risques, annuaire de 12 acteurs, questionnaire, trois campagnes (dont une ouverte avec réponses à contrôler et un brouillon en erreur), indicateurs, bulletin diffusé et baromètre à viser.
- **Guides** : `docs/GUIDE-DEMONSTRATION.md` (préparation et scénario de présentation de 45 minutes) et `docs/FORMATION.md` (plan de formation par rôle avec exercices).
- **Mise à jour d’une copie locale** (`npm run mise-a-jour`, Windows/Linux/macOS) : vérification des modifications locales, récupération en avance rapide uniquement, dépendances, nouvelles variables de `.env.example`, migrations ; options `--demo` et `--tests`.
- **`CLAUDE.md`** : consignes communes aux sessions Claude Code du poste local et du cloud (structure, commandes, règles de confidentialité, cadre organique, migrations, circuits, vérifications, usage de Git) ; `.gitattributes` pour des fins de ligne identiques sous Windows.

## 1.18.0

### Lot 10B — Données sectorielles : exploitation (cahier des charges, § 26)
- **Indicateurs sectoriels** définis sur un questionnaire par le Bureau Études, Analyses et Prospective : somme, moyenne, ratio (avec multiplicateur, ex. × 100), nombre de répondants (éventuellement pour une option donnée), part des répondants ayant choisi une option. La définition est contrôlée au regard des questions publiées.
- Calcul sur les seules **réponses contrôlées des campagnes validées** : valeur par période, évolution par rapport à la période précédente, détail par province et par catégorie d’acteurs, nombre de répondants.
- **Tableaux croisés** sur une campagne validée : lignes et colonnes au choix (province, catégorie, question de choix ou Oui/Non), mesure au choix (répondants, somme ou moyenne d’une question numérique), totaux ; export Excel.
- **Bulletins et baromètres à diffusion interne** : rédaction par les Bureaux de la Division Études, Documentation et Information (introduction, indicateurs retenus, analyse, conclusion), visa du Chef de Division, **autorisation du Directeur valant diffusion** à toute la Direction (et au Secrétaire Général si prévu), avec notification. Avant diffusion, le bulletin n’est visible que de l’équipe de rédaction, de visa et d’autorisation ; à la diffusion, ses valeurs sont figées et le bulletin devient intangible en base. Export PDF avec visas.
- **Recherche globale** étendue aux acteurs de l’annuaire et aux campagnes de collecte.
- Validation d’une campagne : la couverture (acteurs ayant répondu / ciblés) est rappelée et une confirmation est demandée si elle est incomplète.

## 1.17.0

### Lot 10A — Données sectorielles : collecte et annuaire (cahier des charges, § 26)
- **Référentiel** : les 26 provinces et 13 catégories d’acteurs du numérique (opérateurs, fournisseurs d’accès, centres de données, éditeurs, services financiers numériques…), modifiables par le Bureau Documentation et Information.
- **Annuaire des acteurs** : identification (raison sociale, sigle, forme juridique, RCCM, identification nationale, n° impôt), province, ville, coordonnées, responsable, effectif, statut (actif, suspendu, cessé). **Aucun doublon** : même RCCM, même identification nationale ou même raison sociale dans une province refusés en base. Chaque modification est historisée (champs modifiés, valeurs avant et après).
- **Import contrôlé** depuis le modèle Excel fourni (listes déroulantes des catégories et provinces) : chaque ligne est classée nouvelle, doublon (annuaire ou fichier) ou en erreur avant confirmation ; seules les lignes nouvelles retenues sont importées. Export de l’annuaire au même format.
- **Questionnaires configurables et versionnés** : questions numériques, texte, choix unique ou multiple, date, oui/non ; obligatoires, bornes, unités, sections, aide à la saisie ; contrôles de cohérence entre questions. Une version publiée est **figée en base** ; une nouvelle version reprend la précédente.
- **Campagnes de collecte** (Bureau Études, Analyses et Prospective) : questionnaire, période, échéance, responsable, ciblage par catégories et provinces puis acteur par acteur. Circuit `Brouillon → Ouverte → Clôturée → Validée`, retour pour compléments ; campagne validée et ses réponses **intangibles en base**.
- **Saisie par la DEP** à partir de la source reçue (formulaire papier, fichier, courriel, entretien), pièces sources jointes. **Contrôle de qualité** à chaque enregistrement : réponses obligatoires manquantes, valeurs hors bornes ou hors liste, incohérences (erreurs bloquantes) ; variation de plus de 50 % par rapport à la période précédente (alerte à justifier).
- **Contrôle à quatre yeux** par le Bureau Documentation et Information (une autre personne que celle qui a saisi) : réponse contrôlée ou à corriger avec motif ; validation de la campagne par le Chef de la Division Études, Documentation et Information ou le Directeur, une fois toutes les réponses contrôlées.
- Export Excel des réponses d’une campagne (une ligne par acteur, une colonne par question, dictionnaire des questions). Le Secrétaire Général consulte l’annuaire et les campagnes validées.

## 1.16.0

### Lot 9B — Performance et documents de programmation (cahier des charges, §§ 3 et 24)
- **Cadre de performance** : objectifs les plus représentatifs du Ministère et objectifs par programme, indicateurs (unité, sens, mode de calcul, source, commentaires) ; valeurs disposées comme dans le PAP : réalisations A-4 à A-2, exercice en cours A-1 (à mi-parcours), cibles A à A+2. Les cibles sont fixées par le Bureau Programme et la Division Programme et Suivi, les réalisations saisies par le Bureau Suivi-Évaluation.
- **Crédits** (CDF) par programme et, en détail, par action, ventilés par rubrique budgétaire (Rémunérations, Fonctionnement, Interventions, Investissements sur ressources extérieures et propres) et par titre (III à VIII) : votés, exécutés, exécutés à fin juin, prévisions A à A+3 ; saisie en grille avec totaux.
- **Documents de programmation** : PAP et RAP générés au format Word selon le plan du Ministère (présentation stratégique, cadres de performance, crédits par programme, rubrique, titre et action, parties rédigées), CDMT au format Excel (votés A-1, prévision A, projections A+1 à A+3, total Ministère) ; circuit Bureau Programme → Chef du Bureau Programme → Chef de la Division Programme et Suivi → Directeur ; document validé intangible en base.
- **Banque des projets** : fiches PIP soumises avec maturité (idée, étude, prêt à financer, en exécution, achevé, abandonné), programme de rattachement, localisation, partenaires et **jalons** (retards signalés).
- **Registre des risques** (projets, programmes, PTBA) : probabilité, impact, criticité, mesures d’atténuation, responsable, échéance, statut ; un risque critique est signalé au Directeur.
- Non couvert à ce stade : tableaux des effectifs et de la masse salariale du PAP.

## 1.15.0

### Lot 9A — Planification : PTBA au format du Ministère (cahier des charges, §§ 3 et 24)
- **Référentiel** : exercices budgétaires (en préparation, en exécution, clôturé), maquette programmatique (programmes et actions, services normatifs, opérateurs) et services du Ministère ; tenu par le Bureau Programme, la Division Programme et Suivi et le Directeur.
- **PTBA par service et par exercice**, au format du Ministère : programme, objectif global, objectifs spécifiques, activités principales, tâches, coût en CDF, chronogramme mensuel (J à D, regroupé par trimestre), structure responsable, résultats attendus, indicateurs de réalisation, source de vérification, source de financement.
- **Import d’un classeur existant** (une feuille par service) : analyse, choix des feuilles, rapprochement des services et des programmes, création en brouillon ; le chronogramme est lu sur les cellules surlignées ; les sous-totaux sont ignorés ; les feuilles d’un autre format sont signalées.
- **Circuit** conforme au cadre organique : préparation par le Bureau Programme → vérification par son Chef → consolidation par le Chef de la Division Programme et Suivi → validation par le Directeur ; retour pour correction à chaque étape ; **PTBA validé intangible en base** ; le Secrétaire Général ne voit que les PTBA validés.
- **Suivi trimestriel de l’exécution** par le Bureau Suivi-Évaluation : exécution physique, montants engagés et décaissés (contrôles de cohérence), commentaire et pièces justificatives ; tableau de bord de l’exercice (coût programmé, engagé, décaissé, taux d’exécution physique pondéré et financier par service).
- **Exports** : PTBA au format Excel du Ministère (en-têtes T1–T4 et mois, chronogramme surligné), PDF, et **PTBA consolidé** de l’exercice (synthèse par service et par trimestre, puis une feuille par service).

## 1.14.0

### Lot 8B — Réunions, décisions et agenda du Directeur (cahier des charges, §§ 14, 16 et 25)
- **Réunions** : préparation par le Directeur, les Chefs de Division et de Bureau pour leur structure, ou par le Bureau Secrétariat de Direction pour les réunions que préside le Directeur ; ordre du jour, participants internes et invités extérieurs, confidentialité. Circuit `Brouillon → Convoquée → Tenue → Compte rendu à valider → Clôturée`, annulation motivée, report notifié, rappel la veille aux participants.
- **Présence** relevée à partir de l’heure de la réunion (présent, absent, excusé, représenté) ; **compte rendu** rédigé par le rédacteur désigné, soumis au président, retourné avec observations ou validé ; une fois validé, il est **verrouillé en base** (déclencheur) ; convocation et compte rendu en PDF ; annexes.
- **Décisions** : saisies avec le compte rendu (projets), elles entrent au registre à sa validation et sont notifiées à leur responsable. Le Directeur peut aussi prendre une décision hors réunion.
- **Mise en œuvre** d’une décision en un clic : tâche (Chef de Bureau → Agent), instruction (subordonné direct) ou instruction exceptionnelle du Directeur, justifiée par la référence de la décision ; **suivi automatique** : la décision est exécutée à la validation de l’instruction ou de la tâche, et redevient à exécuter si celle-ci est annulée. Compte rendu d’exécution par le responsable, abandon motivé par le décideur.
- **Registre des décisions** : filtres (statut, origine, retard, mes décisions), indicateurs, exports PDF et Excel ; périmètres respectés (Directeur : toutes ; chefs : leur structure ; responsables et décideurs : les leurs).
- **Agenda du Directeur**, tenu par le Bureau Secrétariat de Direction : audiences, déplacements, cérémonies ; les réunions présidées par le Directeur s’y inscrivent à la convocation et suivent reports et annulations ; rappels la veille et une heure avant.
- **Tableau de bord du Directeur** : décisions à suivre (dont en retard), agenda du jour, demandes du Secrétaire Général en attente.

## 1.13.0

### Lot 8A — Compléments des circuits de traitement (cahier des charges, §§ 13, 14, 25 et annexe 2)
- **Instructions et tâches** : nouveaux statuts `Bloquée` (blocage motivé signalé par l’exécutant, levé par l’exécutant ou l’émetteur), `Rapport intermédiaire` (compte rendu d’étape) et `Annulée` (par l’émetteur, avec motif).
- **Prolongation motivée** : demande de l’exécutant (une seule en attente), décision de l’émetteur (accord à la date demandée ou à une autre date, refus motivé) ou prolongation directe ; échéance initiale conservée, retard levé, historique des prolongations.
- **Instruction exceptionnelle du Directeur** à tout agent de la DEP, hors chaîne hiérarchique : justification obligatoire (10 caractères au moins), copie automatique et notification au supérieur immédiat du destinataire, mention dans la fiche, le PDF et le journal d’audit. Les Agents peuvent désormais exécuter une instruction qui leur est adressée.
- **Tâches** : sous-tâches (un niveau, échéance bornée par la tâche parente, qui n’est rendue qu’une fois ses sous-tâches exécutées), dépendances (contrôle des cycles) et **preuves d’exécution** jointes.
- **Documents** : circuit de l’annexe 2 — `En relecture` → `Visé` → `Validé` → `Publié` → `Archivé`. Le visa revient au Chef de Division, ou au Chef du Bureau Secrétariat de Direction pour son Bureau ; le document ne monte au Directeur qu’une fois visé. **Publication** par le Directeur : toute la Direction ou structures choisies, et le Secrétaire Général s’il le décide ; les destinataires sont notifiés et voient le document publié. Les documents existants sont convertis (« En examen » → « En relecture », « Validé (Division) » → « Visé ») ; l’historique conserve les anciens libellés.
- **Demandes d’information** du Secrétaire Général au Directeur : question, priorité, échéance, réponse avec pièces jointes, relance, clôture ; aucune tâche interne créée.
- Compteurs du menu : blocages et demandes de prolongation à décider, demandes d’information en attente.

## 1.12.3

### Carte de service
- Site web du ministère **www.numerique.cd** au pied du verso (nouvelle version du modèle de carte ; les cartes déjà validées conservent la leur).
- Le Bloc-armoirie officiel (PNG à fond transparent) se dépose par l’Admin Système dans Administration → Modèle de carte ; il n’est pas versé au dépôt de code.

## 1.12.2

### Carte de service
- Intitulé sur 3 lignes, taille de police réduite et ajustée pour garder au moins 4 mm d’espace avec l’adresse ; taille limitée aussi par la hauteur du bandeau.
- **Code à barres = code du QR code** : à la validation, la carte reçoit un code de vérification de 20 chiffres, porté par le QR code (dans le lien de vérification) et par le code à barres (Code 128 C, barres plus larges, lisibles à l’impression). La page /verification accepte ce code (lecteur de code à barres ou saisie) ou le lien du QR code collé, en plus du matricule. Les cartes validées auparavant gardent leur code.
- **Filigrane** : Bloc-armoirie en gris, plus visible, placé comme sur le modèle de la charte (p. 43) à droite des renseignements, la signature passant sur sa partie basse.
- Le **Directeur valide lui-même sa propre carte** ; un Directeur intérimaire ne peut pas valider la sienne.
- Vérification publique : **date d’expiration** affichée en évidence dans la fiche du titulaire (en rouge si la carte est expirée).

## 1.12.1

### Carte de service
- Intitulé officiel : MINISTÈRE DE L’ÉCONOMIE NUMÉRIQUE / SECRÉTARIAT GÉNÉRAL / DIRECTION D’ÉTUDES ET PLANIFICATION, en capitales grasses de taille homogène (charte, p. 8).
- Adresse en haut à droite du bandeau : 45, Avenue Lubefu, Quartier Royal, Kinshasa-Gombe.
- Numéro et dates (délivrance, expiration) retirés de la carte imprimée ; ils restent enregistrés et affichés par la vérification. Le code à barres de sécurité est conservé, sans numéro lisible.
- Recto réorganisé selon le modèle de la charte (p. 43) : Matricule, Prénom, Nom, Postnom, Grade, Fonction, Affectation, puis « Signature : ».
- Nouvelle version du modèle de carte (les cartes déjà validées conservent la leur).

## 1.12.0

### Cartes de service (cahier des charges, §§ 20 et 31 ; charte graphique du Gouvernement, p. 43)
- **Modèle conforme à la charte** : bandeau avec Bloc-armoirie, Ligne d’État (bleu #0095c9, jaune #fff24b, rouge #db3832 à parts égales) et intitulé officiel ; recto avec photo, matricule, nom, postnom, prénom, grade, fonction, affectation, code à barres et signature du Directeur ; verso « LAISSEZ PASSER », mention aux autorités et QR code. Format 85,6 × 54 mm ; planche A4 de 10 cartes avec traits de coupe et verso en miroir.
- **Modèle versionné** configuré par l’Admin Système (intitulé, adresse, couleurs, armoirie, validité, mention), sans pouvoir de validation.
- **Spécimen de signature** déposé par le Directeur (mot de passe exigé), appliqué aux cartes qu’il valide, y compris celles validées avant le dépôt.
- **Circuit** : préparation et contrôle du dossier par le Bureau Secrétariat de Direction, vérification, validation par le Directeur (numéro unique, jeton du QR code, renseignements et photo figés, **validité de 5 ans**), impression, remise, accusé de réception par le titulaire ; suspension, réactivation, annulation, perte (déclarable par le titulaire), remplacement, renouvellement, expiration automatique. Carte validée intangible en base.
- **Vérification publique** sans connexion, par QR code ou par matricule : photo, nom complet, grade, fonction, affectation et état de la carte. Journal des vérifications, limitation de débit, alerte en cas de recherches répétées sans résultat, vérification par matricule désactivable.
- « Ma carte de service » pour chaque agent ; nouvelle variable `PUBLIC_URL` (adresse encodée dans le QR code).

## 1.11.0

### Gouvernance du compte Admin Système (cahier des charges, § 12)
- **Double confirmation par le Directeur** des opérations critiques : réinitialisation de la base, politique de sécurité, migrations, permissions du rôle Admin Système. Demande créée à la première tentative, confirmation protégée par le mot de passe du Directeur, exécution unique dans les 24 heures avec les paramètres confirmés, refus motivé, expiration.
- Le rôle Admin Système devient modifiable sous double confirmation, sans jamais recevoir de permission métier.
- **Accès de support temporaire** aux pièces jointes : demande motivée de l’Admin (élément ou type d’élément, 4 heures au plus), validation par le Directeur, lecture seule, consultations auditées, révocation et expiration automatiques.
- **Compte d’urgence** scellé, distinct du compte Admin : activation par le Directeur ou le Secrétaire Général (24 heures au plus, mot de passe temporaire, double authentification à la connexion), alerte immédiate à chaque activation et connexion, fermeture manuelle ou automatique, procédure serveur `npm run urgence`.
- Page **Gouvernance** (Admin, Directeur, SG) ; compte d’urgence signalé dans la liste des comptes et dans la vérification de sécurité.

### Correction
- Le téléchargement d’une pièce jointe (`/api/attachments/fichier/:id`) était intercepté par une autre route et échouait : ordre des routes corrigé, test de non-régression ajouté.

## 1.10.0

### Actes administratifs, intérims et désignations (cahier des charges, §§ 9, 33 et 36)
- **Registre des actes administratifs** (Administration → Actes administratifs) : nomination, affectation, intérim, désignation, fin de fonction. Préparation par le Bureau Secrétariat de Direction avec la copie scannée de l’acte signé, validation ou refus motivé par le Directeur ; actes relatifs au poste de Directeur enregistrés par l’Admin Système et validés par le Secrétaire Général. Un acte validé est intangible (contrôle en base) : rectificatif ou révocation motivée. Nul ne valide un acte qui le concerne.
- **Intérims** : un seul par poste et par intérimaire sur une période ; l’intérimaire exerce le rôle du poste dans son seul périmètre, prend sa place dans la chaîne hiérarchique et reçoit les notifications du poste ; le titulaire est suspendu de ce rôle sans perdre sa titularité ; expiration automatique aux dates de l’acte. Bandeaux d’information pour l’intérimaire et le titulaire ; intérim affiché dans l’organigramme ; notifications d’entrée en vigueur, de fin prochaine et d’échéance.
- **Désignations** (remplacent les délégations) : opérations désignables accordées sur acte, pour une période, avec expiration automatique. Droits antérieurs sans acte à régulariser sous 30 jours, puis retirés.
- **Rôles d’autorité** attribués ou retirés par l’Admin Système uniquement sur un acte validé concernant la personne (référence inscrite dans l’audit).

### Sécurité du Directeur et du Secrétaire Général
- **Double authentification obligatoire**, adresse de récupération et règles de sécurité à la première connexion (également pour un Directeur par intérim).
- **Avis de connexion depuis un nouvel appareil** (Admin, Directeur, SG).
- **Sessions ouvertes** visibles dans le profil de chaque utilisateur, avec fermeture à distance.

## 1.9.0

### Conformité au cadre organique (cahier des charges, partie 2)
- **Codes organiques officiels** (section 5.3.3) : 5.3.3 pour la Direction, 5.3.3.0 pour le Bureau Secrétariat de Direction, 5.3.3.1 à 5.3.3.3 pour les Divisions, 5.3.3.N.M pour leurs Bureaux. Affichés dans l’organigramme, les fiches de structure et le cadre organique ; saisis à la création ou à la modification d’une structure, avec contrôle de cohérence (prolongement du code parent, unicité, `.0` réservé au Secrétariat).
- Nouvel onglet **Structure officielle** (code, structure, rang, supérieur direct).
- **Effectif organique de référence** (20 postes) comparé à l’effectif réel : écarts, vacances, sureffectifs, Agents hors cadre de référence, postes de commandement sans titulaire. Référence modifiable par le Directeur sur la base d’un acte, avec audit ; synthèse sur le tableau de bord du Directeur. La référence est conservée lors d’une réinitialisation de la base.
- Autorité de tutelle : **Secrétariat Général au Numérique**.
- **Bureau Études, Analyses et Prospective** (au lieu de « Perspective »). L’import de la liste reconnaît l’ancienne graphie ainsi que les sections précédées d’un code organique ; le modèle d’import affiche les codes.

## 1.8.0

### Compte Admin Système (lot 3 : sauvegardes et maintenance)
- **Sauvegardes automatiques** chaque nuit à 01:00 (heure de Kinshasa), conservation 7 quotidiennes / 4 hebdomadaires / 12 mensuelles, ponctuelles 90 jours.
- **Chiffrement** AES-256-GCM des sauvegardes (`BACKUP_ENC_KEY`) et **copie hors serveur** contrôlée (`BACKUP_COPY_DIR`).
- **Vérification d’intégrité** et **test de restauration réel** dans une base temporaire, à la demande et chaque semaine.
- **Restauration en double validation** : demande motivée de l’Admin, validation du Directeur (24 h), exécution par l’Admin (phrase, mot de passe, second facteur) ; sauvegarde préalable, retour arrière automatique en cas d’échec, réintégration des traces d’audit et de connexion postérieures, fermeture de toutes les sessions (`sauvegarde.valider_restauration`).
- **Mode maintenance** (page d’information, accès réservé aux Admins Système), **annonces système**, **migrations** depuis l’application avec sauvegarde préalable, **environnement** (secrets masqués).
- Vérification de sécurité et centre de santé : chiffrement, copie hors serveur et dernier test de restauration contrôlés.

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

# Plan de formation des utilisateurs — SIG-DEP

La formation se fait sur l’**environnement de démonstration** (voir `GUIDE-DEMONSTRATION.md`) :
chaque participant se connecte avec un compte fictif de sa fonction et réalise les exercices sur des
données fictives. Recharger la démonstration (`npm run demo:reset`) avant chaque groupe.

Mot de passe de tous les comptes : **Demo@2026**. Le code de double authentification du Directeur,
du Secrétaire Général et de l’Admin est affiché sur la page de connexion.

## Organisation proposée

| Séance | Public | Durée | Comptes |
|---|---|---|---|
| 1. Prise en main (commune) | Tous les agents | 1 h | `ag.prg1`, `ag.sev1`, `ag.doi1`… (un par participant) |
| 2. Agents | Agents des Bureaux | 2 h | compte de l’agent de son Bureau |
| 3. Chefs de Bureau | Chefs de Bureau | 2 h | `cb.prg`, `cb.sev`, `cb.eap`, `cb.doi`, `cb.str`, `cb.coi` |
| 4. Chefs de Division | Chefs de Division | 1 h 30 | `cd.ps`, `cd.edi`, `cd.sci` |
| 5. Secrétariat de Direction | Bureau Secrétariat de Direction | 2 h | `cb.secretariat`, `ag.secretariat1` |
| 6. Directeur | Directeur | 1 h | `directeur` |
| 7. Secrétaire Général | SG et collaborateurs | 45 min | `sg` |
| 8. Administration technique | Admin Système | 2 h | `admin` |

## 1. Prise en main (tous)

- Connexion, changement de mot de passe, déconnexion automatique après inactivité.
- Tableau de bord personnel, notifications (cloche), recherche globale (Ctrl K).
- Fiche « Ma carte de service », « Mon profil » et sessions ouvertes.
- **Exercice** : retrouver par la recherche la campagne de collecte en cours et l’acteur « Fleuve Fibre SA ».

## 2. Agents

- Instructions et tâches reçues : accuser réception, mettre à jour l’avancement, joindre une preuve,
  signaler un blocage, demander une prolongation, rendre compte.
- Documents de service : rédiger, soumettre au visa.
- **Bureau Programme** (`ag.prg1`) : préparer un PTBA (objectifs, activités, chronogramme), l’importer
  depuis Excel, le soumettre. *Exercice* : compléter l’avant-projet de l’exercice suivant et le soumettre.
- **Bureau Suivi-Évaluation** (`ag.sev1`) : saisir l’exécution trimestrielle d’une activité du PTBA
  validé, les réalisations des indicateurs, un jalon de projet, un risque.
- **Bureaux Études / Documentation** (`ag.eap1`, `ag.doi1`, `ag.doi2`) : saisir une réponse de
  campagne, comprendre les erreurs et alertes de qualité, joindre la pièce source, transmettre ;
  contrôler la réponse d’un collègue. *Exercice* : corriger le brouillon en erreur de la campagne
  ouverte (abonnés fixes supérieurs au total), le transmettre, puis le faire contrôler par un autre agent.

## 3. Chefs de Bureau

- Attribuer une tâche, suivre et valider les travaux de son Bureau ; présences hebdomadaires
  (saisie, vérification, soumission) ; organiser une réunion de Bureau.
- **Bureau Programme** (`cb.prg`) : vérifier le PTBA soumis par un autre service ; saisir les cibles
  et les crédits ; corriger la prévision de fonctionnement qui dépasse le plafond du CBMT ; préparer le PAP. **Bureau Études** (`cb.eap`) : créer un questionnaire et une
  campagne, définir un indicateur. **Bureau Documentation** (`cb.doi`) : tenir l’annuaire, importer
  des acteurs depuis le modèle Excel.
- *Exercice* : vérifier le PTBA soumis par le service des infrastructures (`cb.prg`) ; montrer aussi le retour pour correction avec un motif (sans l’exécuter, pour garder la suite du circuit).

## 4. Chefs de Division

- Superviser la Division (tableau de bord, performance des Bureaux), émettre des instructions,
  viser les documents.
- **Programme et Suivi** (`cd.ps`) : consolider les PTBA et les documents de programmation ;
  exécuter la décision qui lui est confiée (instruction issue de la réunion).
- **Études, Documentation et Information** (`cd.edi`) : valider une campagne (couverture
  rappelée), viser le baromètre en attente.

## 5. Secrétariat de Direction

- Courriers : enregistrer, transmettre au Directeur, classer. Agenda du Directeur. Préparer,
  convoquer et tenir une réunion présidée par le Directeur, rédiger le compte rendu et les décisions.
- Enrôlement des agents (comptes), cartes de service, actes administratifs à préparer.
- *Exercice* : reporter d’un jour la réunion « Revue de la programmation » (l’agenda du Directeur
  suit), préparer et convoquer une audience dans l’agenda ; le formateur montre ensuite, sur la
  réunion de coordination déjà tenue, le relevé des présences, le compte rendu et les décisions.

## 6. Directeur

- Tableau de bord de pilotage ; valider (comptes rendus, PTBA, documents, actes, cartes) ;
  transformer une décision en tâche ou instruction ; instruction exceptionnelle ; répondre au SG ;
  autoriser la diffusion d’un bulletin ; délégations et intérims.
- *Exercice* : valider le PTBA du service des infrastructures une fois vérifié (séance 3) et
  consolidé (séance 4) ; répondre à la demande du SG en attente ; autoriser la diffusion du baromètre
  une fois visé par le Chef de Division.

## 7. Secrétaire Général

- Supervision en lecture de la Direction, instructions au Directeur, demandes d’information,
  documents et bulletins diffusés, PTBA et campagnes validés.

## 8. Admin Système

- Comptes et sessions, politique de sécurité, journal d’audit, sauvegardes et restauration,
  maintenance, santé du système ; règles : aucune autorité administrative, opérations sensibles
  confirmées par le Directeur.

## Évaluation

À la fin de chaque séance, chaque participant réalise seul l’exercice de son rôle ; le formateur
vérifie le résultat dans l’historique de l’élément concerné (toutes les actions y sont tracées).

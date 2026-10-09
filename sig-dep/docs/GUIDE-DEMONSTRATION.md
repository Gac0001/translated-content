# Guide de démonstration — SIG-DEP

Ce guide prépare et déroule la présentation du SIG-DEP aux autorités et aux agents de la Direction
d’Études et Planification. Toutes les données sont **fictives**.

## 1. Préparer l’environnement (une fois)

Sur le poste de démonstration (Windows, Git Bash), installation faite selon le `README.md` :

1. Dans `backend/.env`, ajouter la ligne `DEMO_MODE=true` (et garder `NODE_ENV=development`).
2. Charger la démonstration : `cd backend && npm run demo:reset` (quelques secondes).
3. Démarrer : `npm run dev` dans `backend`, puis `npm run dev` dans `frontend` (second terminal).
4. Ouvrir http://localhost:5173 : un bandeau jaune « Environnement de démonstration » s’affiche.

**Avant chaque séance**, relancer `npm run demo:reset` : la base repart d’un état propre et toutes les
dates (réunions, échéances, agenda) sont recalculées à partir du jour même.

> Le mode démonstration est **refusé en production** : l’API ne démarre pas avec `DEMO_MODE=true`
> et `NODE_ENV=production`.

## 2. Se connecter pendant la démonstration

La page de connexion affiche les principaux comptes : un clic remplit l’identifiant et le mot de
passe (**Demo@2026** pour tous). Pour le Directeur, le Secrétaire Général et l’Admin Système, la
double authentification reste exigée, comme en réel ; le code du moment est affiché sur la page
(il change toutes les 30 secondes) et un clic le saisit.

Ouvrir plusieurs rôles en même temps : une fenêtre normale et une fenêtre de navigation privée, ou
deux navigateurs.

## 3. Ce que contient la démonstration

| Domaine | État préparé |
|---|---|
| Organisation et personnel | Organigramme 5.3.3, agents et comptes fictifs, liste déclarative validée, trois agents à enrôler |
| Instructions, tâches, courriers, documents, présences, PIP | Activité des deux dernières semaines, dont une tâche en retard |
| Réunions et décisions | Réunion de coordination tenue il y a six jours (compte rendu validé, trois décisions : une transformée en instruction, une exécutée, une à exécuter) ; deux réunions convoquées à venir et une d’hier à déclarer tenue |
| Agenda du Directeur | Audience demain, mission en province, cérémonie de lancement du bulletin |
| Demandes du Secrétaire Général | Une demande répondue, une en attente |
| Planification | Exercices en cours et suivant ; trois programmes et leurs actions ; PTBA de la DEP validé avec suivi d’exécution ; PTBA d’un autre service soumis (à vérifier) ; avant-projet de l’exercice suivant |
| Performance et programmation | CBMT fictif validé (plafonds sur trois ans, un dépassement volontaire), objectifs et indicateurs avec réalisations et cibles, crédits sur cinq ans, PAP en préparation, RAP validé, CDMT, banque des projets avec jalons, registre des risques |
| Données sectorielles | 12 acteurs du numérique, questionnaire publié, deux campagnes validées et une ouverte (réponses contrôlées, à contrôler, et un brouillon en erreur), 4 indicateurs, un bulletin diffusé, un baromètre en attente de visa |

## 4. Scénario de présentation (45 minutes environ)

| Temps | Compte | Montrer |
|---|---|---|
| 0–5 min | — | Page de connexion : sécurité (mot de passe, double authentification, journalisation), bandeau de démonstration |
| 5–12 min | `directeur` | **Tableau de bord** : bandeau « À traiter » (montrer aussi celui de `cb.prg` ou `cd.edi`), décisions à suivre, agenda du jour, demandes du SG, tâches en retard, performance des structures ; **Agenda** ; **Registre des décisions** (décision exécutée, décision transformée en instruction) |
| 12–18 min | `cb.secretariat` puis `directeur` | **Réunions** : la réunion tenue (présences, compte rendu verrouillé, décisions) ; préparer et convoquer une nouvelle réunion |
| 18–25 min | `cb.prg`, `cd.ps`, `directeur` | **Planification** : PTBA de la DEP (chronogramme, coûts par trimestre, exports Excel/PDF au format du Ministère) ; PTBA soumis à vérifier → vérifier, consolider, valider ; onglet **Exécution** |
| 25–30 min | `cb.prg` | **CBMT** (plafonds du Ministère, actions prioritaires), **Crédits** (respect du cadrage, dépassement signalé en rouge), **Performance**, **PAP · RAP · CDMT** (export Word et Excel), **Banque des projets**, **Risques** |
| 30–40 min | `ag.doi1`, `ag.doi2`, `cd.edi` | **Données sectorielles** : annuaire ; campagne ouverte → corriger le brouillon en erreur, transmettre, contrôler avec un autre agent ; **Indicateurs** (évolution, par province) ; **Tableaux croisés** ; **Bulletin** diffusé (PDF) |
| 40–45 min | `sg` | Vue du Secrétaire Général : supervision en lecture, demandes d’information, bulletin diffusé ; questions |

Conseils : préparer les onglets à l’avance ; ne pas montrer la page **Système** de l’Admin aux
autorités sauf demande ; terminer par la **recherche globale** (Ctrl K, par exemple « fibre »).

## 5. Après la démonstration

Pour la formation des utilisateurs, voir `docs/FORMATION.md`. La mise en service réelle se fera sur
une base distincte, sans `DEMO_MODE`, avec la liste déclarative et les données réelles (voir le
chapitre « Mise en production » du `README.md`).

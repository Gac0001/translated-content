---
name: verifier
description: Vérifications du SIG-DEP adaptées aux fichiers modifiés — tests du serveur (DEMO_MODE=false), analyse et construction de l’interface, tests de l’interface ciblés, et en option suite complète et accessibilité. À utiliser avant chaque commit d’une modification du SIG-DEP, ou quand l’utilisateur demande de vérifier, tester ou valider le travail.
---

# /verifier — contrôles du SIG-DEP

Script : `sig-dep/outils/verifier.sh` (depuis la racine du dépôt).

## Choisir le mode

| Demande ou situation | Commande |
|---|---|
| Par défaut, avant un commit | `bash sig-dep/outils/verifier.sh` |
| L’utilisateur veut tout vérifier sans attendre 30 min | `bash sig-dep/outils/verifier.sh --tout` |
| Argument « complet », ou version qui touche l’interface (avant `/publier-version`) | `bash sig-dep/outils/verifier.sh --complet` |

- Mode rapide : quelques minutes. Lancer en premier plan avec un délai d’au moins 15 minutes (`timeout` 900000).
- Mode `--complet` : environ 30 minutes. Le lancer **en arrière-plan** (`run_in_background`) et attendre la
  notification de fin ; ne pas lancer une seconde copie pendant qu’il tourne.

## Avant de lancer

- Les tests de l’interface exigent l’API (port 4000, mode démonstration) et l’interface (port 5173). En session cloud,
  le hook de session les démarre ; s’ils ne répondent pas : `cd sig-dep/backend && npm run dev:tout`
  (`-- --relancer` pour les redémarrer).
- Les tests de l’interface modifient la démonstration. Avant `--complet`, la recharger :
  `cd sig-dep/backend && npm run demo:reset`.

## Lire le résultat

Le script termine par un résumé (✅ réussi, ‼️ échec avec le chemin du journal, ⏭ sauté) et sort avec le code 1 en cas
d’échec. Pour chaque échec :

1. lire le journal indiqué (`/tmp/sigdep-verifier/…`) ;
2. corriger la cause — jamais en désactivant ou en sautant un test ;
3. relancer le script.

Un test d’interface qui échoue seul peut venir de l’environnement (serveur lent, données de démonstration modifiées par
un test précédent) : le relancer une fois seul, après `npm run demo:reset` ; s’il échoue encore, c’est un vrai défaut.

## Rendre compte

Reprendre le résumé dans la réponse : ce qui a été vérifié, les chiffres (tests réussis sur total) et ce qui ne l’a pas
été (par exemple « suite complète non lancée »). Ne jamais présenter comme vérifié ce qui a été sauté.

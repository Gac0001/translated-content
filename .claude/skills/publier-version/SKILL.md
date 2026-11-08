---
name: publier-version
description: Publier une version du SIG-DEP (x.y.z) selon CLAUDE.md — section du CHANGELOG, numéros de version du backend et du frontend, README, vérifications, commit protégé au format « SIG-DEP x.y.z — … » et push sur la branche de travail. À utiliser quand un lot ou une correction est terminé et doit être publié, ou quand l’utilisateur tape /publier-version x.y.z.
---

# /publier-version x.y.z

Le numéro est l’argument (`/publier-version 1.48.0`). Sans argument : proposer le suivant (version de
`sig-dep/backend/package.json` ; mineure + 1 pour un lot, correctif + 1 pour une correction) et le demander à l’utilisateur.

Préalable : le travail publié a été présenté à l’utilisateur et accepté (CLAUDE.md, règle 6). Ne pas publier un travail
non validé.

## Étapes

1. **CHANGELOG** — ajouter en tête de `sig-dep/CHANGELOG.md`, juste sous le titre, une section `## x.y.z` :
   un sous-titre `### <Lot ou thème> — <résumé>`, puis des lignes `- …` qui décrivent ce qui change pour les
   utilisateurs (fonctionnalités, règles, corrections, démonstration, tests). La rédiger à partir du diff
   (`git diff --stat`, `git log @{u}..HEAD`), en français, sans aucun vrai nom ni donnée réelle.
2. **README** — mettre à jour `sig-dep/README.md` si une fonctionnalité visible ou une commande a changé.
3. **Numéros de version** — `node sig-dep/outils/publier-version.js x.y.z`. Le script refuse un numéro qui n’est pas
   supérieur à la version courante, ou un CHANGELOG sans la section ; il met à jour `package.json` et
   `package-lock.json` du backend et du frontend.
4. **Vérifications** — suivre la compétence `/verifier` : mode rapide, puis `--complet` si la version touche l’interface.
   Tout doit passer. En cas d’échec, corriger avant de continuer.
5. **Commit** — `git add` des fichiers concernés (jamais `.env`, `storage/`, sauvegardes, fichiers réels), puis
   `git commit` avec un message en français : première ligne `SIG-DEP x.y.z — <lot> : <résumé>`, puis le détail, puis
   les lignes d’attribution prévues pour la session. Le contrôle avant commit (`sig-dep/outils/git-hooks`) bloque les
   termes sensibles et les nouveaux binaires : corriger, ne jamais utiliser `--no-verify`.
6. **Push** — `git push -u origin <branche de travail>` (CLAUDE.md : `claude/determined-maxwell-jl0avn`). En cas
   d’erreur réseau seulement, réessayer jusqu’à 4 fois en attendant 2, 4, 8 puis 16 secondes. Si le push est refusé
   parce que la branche distante a avancé : `git pull` (fusion, jamais de rebase ni de force-push), résoudre,
   relancer `/verifier`, puis pousser.
7. **Compte rendu** — à l’utilisateur : numéro de version, commit, ce qui change, résultats des vérifications (chiffres)
   et ce qui n’a pas été vérifié. Ne pas créer de pull request sauf demande explicite.

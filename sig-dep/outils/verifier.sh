#!/bin/bash
# Vérifications du SIG-DEP adaptées aux fichiers modifiés (CLAUDE.md, « Vérifier avant de publier »).
#
#   sig-dep/outils/verifier.sh            contrôles rapides sur les fichiers modifiés
#   sig-dep/outils/verifier.sh --tout     contrôles rapides sur tout le projet
#   sig-dep/outils/verifier.sh --complet  … puis suite complète de l’interface et accessibilité (≈ 30 min)
#
# Fichiers modifiés : non commités, non suivis, et commits pas encore poussés (par rapport à la branche suivie).
#  - backend modifié  → tests du serveur (DEMO_MODE=false, comme la CI) ;
#  - frontend modifié → analyse du code et construction ;
#  - tests de l’interface ciblés : fichiers e2e modifiés, et tests des modules touchés (pages ou routes de l’API) ;
#    socle (clavier, menu, À traiter) quand les composants communs, le style ou la mise en page changent.
# Les tests de l’interface exigent l’API (4000, mode démonstration) et l’interface (5173) démarrées.
# Code de sortie : 0 si tout passe, 1 sinon. Résumé en fin de sortie.
set -uo pipefail

MODE=rapide
case "${1:-}" in
  --tout) MODE=tout ;;
  --complet) MODE=complet ;;
  "") ;;
  *) echo "Usage : $0 [--tout|--complet]"; exit 2 ;;
esac

RACINE=$(git rev-parse --show-toplevel)
# Navigateur de la machine pour Playwright (sessions cloud), si le hook de session ne l’a pas déjà fixé.
if [ -z "${SIGDEP_CHROMIUM:-}" ] && [ -x /opt/pw-browsers/chromium ]; then export SIGDEP_CHROMIUM=/opt/pw-browsers/chromium; fi
SIG="$RACINE/sig-dep"
JOURNAUX=${TMPDIR:-/tmp}/sigdep-verifier
mkdir -p "$JOURNAUX"
RESUME=()
ECHEC=0
noter() { RESUME+=("$1"); }
lancer() { # lancer <libellé> <journal> <commande…>
  local libelle=$1 journal=$2; shift 2
  echo "▶ $libelle"
  local debut=$SECONDS
  if "$@" > "$journal" 2>&1; then
    noter "✅ $libelle ($((SECONDS - debut)) s)"
  else
    ECHEC=1
    noter "‼️ $libelle — échec ($((SECONDS - debut)) s), journal : $journal"
    tail -n 25 "$journal"
  fi
}

# ─── Fichiers modifiés ──────────────────────────────────────────────────────
cd "$RACINE"
amont=$(git rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null || true)
{
  [ -n "$amont" ] && git diff --name-only "$amont...HEAD"
  git diff --name-only HEAD
  git ls-files --others --exclude-standard
} 2>/dev/null | sort -u | grep '^sig-dep/' > "$JOURNAUX/fichiers.txt" || true
if [ "$MODE" != rapide ]; then
  printf 'sig-dep/backend/src/\nsig-dep/frontend/src/components/\n' >> "$JOURNAUX/fichiers.txt"
fi
nb=$(grep -c . "$JOURNAUX/fichiers.txt" || true)
echo "Fichiers pris en compte : $nb (liste : $JOURNAUX/fichiers.txt)"

backend=0; frontend=0; socle=0
declare -A MODULES=() SPECS=()
# Noms de l’API ou des pages → nom employé par les adresses et les tests de l’interface
alias_module() {
  case "$1" in
    ptba|programmation) echo planification ;;
    demandesInformation|demandes) echo demandes-information ;;
    tasks) echo taches ;;
    agents) echo personnel ;;
    evaluations) echo evaluations ;;
    *) echo "$1" ;;
  esac
}
while IFS= read -r f; do
  case "$f" in
    sig-dep/backend/*) backend=1 ;;
  esac
  case "$f" in
    sig-dep/frontend/*) frontend=1 ;;
  esac
  case "$f" in
    sig-dep/frontend/e2e/*.spec.js) SPECS[$(basename "$f")]=1 ;;
    sig-dep/frontend/src/pages/Dashboard.jsx) SPECS[a-traiter.spec.js]=1 ;;
    sig-dep/frontend/src/pages/Login.jsx|sig-dep/frontend/src/pages/VerificationCarte.jsx|sig-dep/frontend/src/pages/MaintenancePublique.jsx) SPECS[clavier.spec.js]=1 ;;
    sig-dep/frontend/src/pages/*/*) m=${f#sig-dep/frontend/src/pages/}; MODULES[$(alias_module "${m%%/*}")]=1 ;;
    sig-dep/backend/src/modules/*/*) m=${f#sig-dep/backend/src/modules/}; MODULES[$(alias_module "${m%%/*}")]=1 ;;
    sig-dep/backend/src/services/aTraiter.js) SPECS[a-traiter.spec.js]=1 ;;
    sig-dep/frontend/src/components/*|sig-dep/frontend/src/index.css|sig-dep/frontend/src/App.jsx|sig-dep/frontend/src/lib/*|sig-dep/frontend/tailwind.config.js) socle=1 ;;
  esac
done < "$JOURNAUX/fichiers.txt"
for m in "${!MODULES[@]}"; do
  for s in "$SIG"/frontend/e2e/*.spec.js; do
    n=$(basename "$s")
    [ "$n" = accessibilite.spec.js ] && continue
    if [[ "$n" == *"$m"* ]] || grep -qE "['\"\`]/$m([/?'\"\`]|$)" "$s"; then SPECS[$n]=1; fi
  done
done
if [ "$socle" = 1 ]; then SPECS[clavier.spec.js]=1; SPECS[menu.spec.js]=1; SPECS[a-traiter.spec.js]=1; fi

# ─── Serveur ────────────────────────────────────────────────────────────────
if [ "$backend" = 1 ]; then
  lancer "Tests du serveur (DEMO_MODE=false)" "$JOURNAUX/backend-tests.log" bash -c "cd '$SIG/backend' && DEMO_MODE=false npm test"
  r=$(grep -aE '^Tests:' "$JOURNAUX/backend-tests.log" | tail -1 | tr -s ' '); [ -n "$r" ] && RESUME[-1]="${RESUME[-1]} — $r"
else
  noter "⏭  Tests du serveur : aucun fichier du backend modifié"
fi

# ─── Interface ──────────────────────────────────────────────────────────────
if [ "$frontend" = 1 ]; then
  lancer "Analyse du code (lint)" "$JOURNAUX/lint.log" bash -c "cd '$SIG/frontend' && npm run lint"
  lancer "Construction (build)" "$JOURNAUX/build.log" bash -c "cd '$SIG/frontend' && npm run build"
else
  noter "⏭  Analyse et construction : aucun fichier de l’interface modifié"
fi

# Tests de l’interface inutiles si l’analyse ou la construction échoue : corriger d’abord.
BLOQUANT=$ECHEC
serveurs_ok() { curl -sf -o /dev/null --max-time 5 http://localhost:4000/api/health && curl -sf -o /dev/null --max-time 5 http://localhost:5173/; }
liste_specs=("${!SPECS[@]}")
if [ "$BLOQUANT" = 1 ]; then
  noter "⏭  Tests de l’interface : sautés tant que les contrôles ci-dessus échouent"
elif [ "$MODE" != complet ] && [ ${#liste_specs[@]} -gt 0 ]; then
  if serveurs_ok; then
    chemins=(); for s in "${liste_specs[@]}"; do chemins+=("e2e/$s"); done
    lancer "Tests de l’interface ciblés : ${liste_specs[*]}" "$JOURNAUX/e2e-cibles.log" \
      bash -c "cd '$SIG/frontend' && SIGDEP_SANS_ACCESSIBILITE=1 npx playwright test ${chemins[*]} --timeout=120000 --reporter=line"
    r=$(grep -aoE '[0-9]+ (passed|failed|flaky|skipped)' "$JOURNAUX/e2e-cibles.log" | tr '\n' ' '); [ -n "$r" ] && RESUME[-1]="${RESUME[-1]} —$r"
  else
    ECHEC=1; noter "‼️ Tests de l’interface ciblés : API ou interface arrêtée — démarrez-les : cd sig-dep/backend && npm run dev:tout"
  fi
elif [ "$MODE" != complet ]; then
  noter "⏭  Tests de l’interface : aucun test concerné par les fichiers modifiés"
fi

if [ "$MODE" = complet ] && [ "$BLOQUANT" = 0 ]; then
  if serveurs_ok; then
    lancer "Suite complète de l’interface" "$JOURNAUX/e2e-complet.log" \
      bash -c "cd '$SIG/frontend' && SIGDEP_SANS_ACCESSIBILITE=1 npx playwright test --timeout=120000 --reporter=line"
    r=$(grep -aoE '[0-9]+ (passed|failed|flaky|skipped)' "$JOURNAUX/e2e-complet.log" | tr '\n' ' '); [ -n "$r" ] && RESUME[-1]="${RESUME[-1]} —$r"
    lancer "Accessibilité (tous les rôles)" "$JOURNAUX/accessibilite.log" \
      bash -c "cd '$SIG/frontend' && npx playwright test e2e/accessibilite.spec.js --timeout=600000 --reporter=line"
    r=$(grep -aoE '[0-9]+ (passed|failed|flaky|skipped)' "$JOURNAUX/accessibilite.log" | tr '\n' ' '); [ -n "$r" ] && RESUME[-1]="${RESUME[-1]} —$r"
  else
    ECHEC=1; noter "‼️ Suite complète : API ou interface arrêtée — démarrez-les : cd sig-dep/backend && npm run dev:tout"
  fi
fi

echo
echo "══ Résumé ($MODE) ══"
printf '%s\n' "${RESUME[@]}"
exit $ECHEC

#!/bin/bash
# Après chaque modification d’un fichier de l’interface du SIG-DEP par Claude Code (Edit, Write, MultiEdit) :
# analyse eslint de ce seul fichier, erreurs uniquement (les avertissements sont tolérés par le projet).
# En cas d’erreur, le message est renvoyé à Claude (code 2) pour correction immédiate. Sinon, silence.
# Fonctionne sur le poste (Git Bash) comme dans le cloud ; sans effet si eslint n’est pas installé.
set -uo pipefail

fichier=$(node -e "
let d = '';
process.stdin.on('data', (c) => { d += c; }).on('end', () => {
  try {
    const j = JSON.parse(d);
    const f = (j.tool_input && (j.tool_input.file_path || j.tool_input.path)) || '';
    process.stdout.write(f.replace(/\\\\/g, '/'));
  } catch { /* entrée illisible : rien à faire */ }
});")

case "$fichier" in
  */sig-dep/frontend/src/*.js|*/sig-dep/frontend/src/*.jsx|*/sig-dep/frontend/e2e/*.js) ;;
  *) exit 0 ;;
esac
[ -f "$fichier" ] || exit 0

FRONTEND="${fichier%%/sig-dep/frontend/*}/sig-dep/frontend"
[ -e "$FRONTEND/node_modules/.bin/eslint" ] || exit 0

if ! sortie=$(cd "$FRONTEND" && node_modules/.bin/eslint --quiet --no-warn-ignored "$fichier" 2>&1); then
  echo "Analyse du code (eslint) — erreurs dans ${fichier#*/sig-dep/} : corrigez-les." >&2
  echo "$sortie" >&2
  exit 2
fi
exit 0

#!/bin/bash
# Démarrage d’une session Claude Code dans le cloud (SIG-DEP) : remet le conteneur en état de travailler.
#  1. dépendances npm (backend, frontend), réinstallées seulement si package.json ou package-lock.json changent ;
#  2. PostgreSQL : service, rôle « sigdep », bases de démonstration et de test ;
#  3. backend/.env de développement (démonstration, secrets générés sur place) s’il manque ;
#  4. migrations, et démonstration chargée si elle est absente ;
#  5. navigateur attendu par Playwright (version de la tête sans interface) ;
#  6. contrôle avant commit (git config core.hooksPath) ;
#  7. API (port 4000) et interface (port 5173) démarrées si elles ne répondent pas.
# Sans effet sur un poste local (Windows) : voir « npm run mise-a-jour » et README.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-.}"
SIG=sig-dep
JOURNAUX=/tmp/sigdep-session
mkdir -p "$JOURNAUX"

# 1. Dépendances
reinstalle=0
for d in backend frontend; do
  empreinte=$SIG/$d/node_modules/.session-start.sha256
  if ! sha256sum --check --status "$empreinte" 2>/dev/null; then
    rm -f "$empreinte"
    (cd "$SIG/$d" && npm ci --no-audit --no-fund --loglevel=error)
    reinstalle=1
    sha256sum .claude/hooks/session-start.sh "$SIG/$d/package.json" "$SIG/$d/package-lock.json" > "$empreinte"
  fi
done

# 2. PostgreSQL
service postgresql start >/dev/null 2>&1 || true
for _ in $(seq 1 30); do pg_isready -q && break; sleep 0.5; done
psql_admin() { su postgres -c "psql -qtAc \"$1\""; }
if [ "$(psql_admin "SELECT 1 FROM pg_roles WHERE rolname='sigdep'")" != "1" ]; then
  psql_admin "CREATE ROLE sigdep LOGIN SUPERUSER PASSWORD 'sigdep'"
fi
for base in sig_dep_demo sig_dep_test; do
  if [ "$(psql_admin "SELECT 1 FROM pg_database WHERE datname='$base'")" != "1" ]; then
    su postgres -c "createdb -O sigdep $base"
  fi
done

# 3. Configuration de développement (jamais versionnée)
ENV=$SIG/backend/.env
if [ ! -f "$ENV" ]; then
  sed -e "s#^DATABASE_URL=.*#DATABASE_URL=postgres://sigdep:sigdep@localhost:5432/sig_dep_demo#" \
      -e "s#^JWT_ACCESS_SECRET=.*#JWT_ACCESS_SECRET=$(openssl rand -hex 32)#" \
      -e "s#^JWT_REFRESH_SECRET=.*#JWT_REFRESH_SECRET=$(openssl rand -hex 32)#" \
      "$SIG/backend/.env.example" > "$ENV"
  echo "DEMO_MODE=true" >> "$ENV"
fi

# 4. Base de démonstration
(cd "$SIG/backend" && npm run --silent migrate > "$JOURNAUX/migrate.log" 2>&1)
# Démonstration absente (base neuve : les migrations ne créent que le compte Admin) → chargement complet.
demo=$(PGPASSWORD=sigdep psql -h localhost -U sigdep -d sig_dep_demo -qtAc "SELECT count(*) FROM users WHERE username = 'directeur'" 2>/dev/null || echo 0)
if [ "${demo:-0}" = "0" ]; then
  (cd "$SIG/backend" && npm run --silent demo:reset > "$JOURNAUX/demo.log" 2>&1)
fi

# 5. Navigateur de Playwright : relier la version attendue à celle qui est installée
attendue=$(node -e "const b=JSON.parse(require('fs').readFileSync('$SIG/frontend/node_modules/playwright-core/browsers.json','utf8'));process.stdout.write(b.browsers.find((x)=>x.name==='chromium-headless-shell').revision)")
cible=/opt/pw-browsers/chromium_headless_shell-$attendue/chrome-linux
if [ ! -e "$cible/headless_shell" ]; then
  installee=$(ls -d /opt/pw-browsers/chromium_headless_shell-*/chrome-headless-shell-linux64 2>/dev/null | head -1 || true)
  if [ -n "$installee" ]; then
    mkdir -p "$cible"
    for f in "$installee"/*; do ln -sfn "$f" "$cible/"; done
    ln -sfn "$installee/chrome-headless-shell" "$cible/headless_shell"
    touch "/opt/pw-browsers/chromium_headless_shell-$attendue/INSTALLATION_COMPLETE" "/opt/pw-browsers/chromium_headless_shell-$attendue/DEPENDENCIES_VALIDATED"
  fi
fi

# 6. Contrôle avant commit (termes sensibles, nouveaux binaires)
git config core.hooksPath "$SIG/outils/git-hooks"

# 7. Serveurs de développement
# Après une réinstallation, les serveurs déjà lancés tournent sur des modules supprimés : on les relance.
arreter_serveurs() {
  for p in /proc/[0-9]*; do
    c=$(tr '\0' ' ' 2>/dev/null < "$p/cmdline" || true)
    case "$c" in
      "node src/server.js"*|*"node_modules/.bin/vite --port 5173"*|"npm exec vite --port 5173"*) kill "${p#/proc/}" 2>/dev/null || true ;;
    esac
  done
  sleep 1
}
if [ "$reinstalle" = "1" ]; then arreter_serveurs; fi
if ! curl -sf -o /dev/null http://localhost:4000/api/health; then
  # Détaché (setsid, sorties redirigées) : le serveur ne garde pas ouverte la sortie du hook.
  (cd "$SIG/backend" && LOGIN_RATE_LIMIT_MAX=500 setsid -f node src/server.js > "$JOURNAUX/api.log" 2>&1 < /dev/null)
fi
if ! curl -sf -o /dev/null http://localhost:5173/; then
  (cd "$SIG/frontend" && setsid -f npx vite --port 5173 > "$JOURNAUX/vite.log" 2>&1 < /dev/null)
fi
for _ in $(seq 1 40); do
  curl -sf -o /dev/null http://localhost:4000/api/health && curl -sf -o /dev/null http://localhost:5173/ && break
  sleep 0.5
done

etat() { curl -sf -o /dev/null "$1" && echo "prête" || echo "ne répond pas (voir $JOURNAUX)"; }
echo "SIG-DEP : API $(etat http://localhost:4000/api/health), interface $(etat http://localhost:5173/) ; journaux dans $JOURNAUX."
echo "Tests du serveur : DEMO_MODE=false npm test (backend) ; interface : npx playwright test (frontend)."
if [ ! -s "$SIG/.termes-sensibles" ] && [ -z "${SIGDEP_TERMES_SENSIBLES:-}" ]; then
  echo "Attention : liste des termes sensibles absente (sig-dep/.termes-sensibles) ; le contrôle avant commit ne vérifie que les fichiers binaires."
fi

#!/bin/bash
# Démarrage d’une session Claude Code dans le cloud (SIG-DEP) : remet le conteneur en état de travailler.
#  1. dépendances npm (backend, frontend), réinstallées seulement si package.json ou package-lock.json changent ;
#  2. PostgreSQL : service, rôle « sigdep », bases de démonstration et de test ;
#  3. backend/.env de développement (démonstration, secrets générés sur place) s’il manque ;
#  4. migrations, et démonstration chargée si elle est absente ;
#  5. navigateur de la machine pour Playwright (variable SIGDEP_CHROMIUM) ;
#  6. contrôle avant commit (git config core.hooksPath) ;
#  7. API (port 4000) et interface (port 5173) démarrées si elles ne répondent pas (npm run dev:tout).
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

# 5. Navigateur de Playwright : celui de la machine (sa version peut différer de celle attendue par
#    @playwright/test) ; playwright.config.js le prend via SIGDEP_CHROMIUM.
if [ -x /opt/pw-browsers/chromium ] && [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  echo 'export SIGDEP_CHROMIUM=/opt/pw-browsers/chromium' >> "$CLAUDE_ENV_FILE"
fi

# 6. Contrôle avant commit (termes sensibles, nouveaux binaires)
git config core.hooksPath "$SIG/outils/git-hooks"

# 7. Serveurs de développement (détachés, journaux dans le dossier temporaire « sigdep-dev ») ; après une
#    réinstallation, ceux qui tournaient s’appuient sur des modules supprimés : on les relance.
if [ "$reinstalle" = "1" ]; then
  (cd "$SIG/backend" && node scripts/dev-tout.js --relancer > "$JOURNAUX/dev-tout.log" 2>&1) || true
else
  (cd "$SIG/backend" && node scripts/dev-tout.js > "$JOURNAUX/dev-tout.log" 2>&1) || true
fi

etat() { curl -sf -o /dev/null "$1" && echo "prête" || echo "ne répond pas (voir $JOURNAUX)"; }
echo "SIG-DEP : API $(etat http://localhost:4000/api/health), interface $(etat http://localhost:5173/) ; journaux dans $JOURNAUX et ${TMPDIR:-/tmp}/sigdep-dev."
echo "Vérifications : /verifier (ou bash sig-dep/outils/verifier.sh) ; serveurs : npm run dev:tout -- --relancer (backend)."
if [ ! -s "$SIG/.termes-sensibles" ] && [ -z "${SIGDEP_TERMES_SENSIBLES:-}" ]; then
  echo "Attention : liste des termes sensibles absente (sig-dep/.termes-sensibles) ; le contrôle avant commit ne vérifie que les fichiers binaires."
fi

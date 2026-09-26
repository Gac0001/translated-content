#!/usr/bin/env bash
# Sauvegarde PostgreSQL du SIG-DEP (format personnalisé pg_dump, compressé).
# Utilisable sous Linux et sous Windows (Git Bash). Lit DATABASE_URL dans backend/.env.
#   bash scripts/backup.sh            → storage/backups/sig-dep-AAAA-MM-JJ_HHMMSS.dump
# Restauration :
#   pg_restore --clean --if-exists -d "postgres://user:mdp@hote:5432/sig_dep" fichier.dump
set -euo pipefail
cd "$(dirname "$0")/.."
if [ -f .env ]; then
  DATABASE_URL="$(grep -E '^DATABASE_URL=' .env | head -1 | cut -d= -f2-)"
  BACKUP_DIR="$(grep -E '^BACKUP_DIR=' .env | head -1 | cut -d= -f2- || true)"
  PG_DUMP_PATH="$(grep -E '^PG_DUMP_PATH=' .env | head -1 | cut -d= -f2- | tr -d '"' || true)"
fi
: "${DATABASE_URL:?DATABASE_URL non défini}"
BACKUP_DIR="${BACKUP_DIR:-./storage/backups}"
PG_DUMP="${PG_DUMP_PATH:-pg_dump}"
mkdir -p "$BACKUP_DIR"
FILE="$BACKUP_DIR/sig-dep-$(date +%Y-%m-%d_%H%M%S).dump"
"$PG_DUMP" --format=custom --no-owner --file="$FILE" "$DATABASE_URL"
echo "Sauvegarde créée : $FILE"
# Rétention : conserver les 30 dernières sauvegardes
ls -1t "$BACKUP_DIR"/sig-dep-*.dump 2>/dev/null | tail -n +31 | xargs -r rm -f

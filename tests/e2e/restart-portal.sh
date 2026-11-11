#!/usr/bin/env bash
# Restarts ONLY the portal backend of the running e2e stack (same env as ../../../e2e-cross-system/02-backends.sh), optionally with
# MEDIA_BASE_URL=<file service origin> in the environment of this script (spec 46: the file service of that spec is a fake on port 3205).
# Scratch stack only (ports 3201-3205, Redis proxy 56390); secrets are read from the stack's work dir and never printed.
set -euo pipefail
X="$(cd "$(dirname "$0")/../../../e2e-cross-system" && pwd)"
source "$X/lib/common.sh"; W="$(work)"; source "$W/scratch.env"; source "$W/secrets.env"
kill "$(cat "$W/run/portal.pid")" 2>/dev/null || true; for i in $(seq 1 30); do lsof -nP -iTCP:$P_PORTAL_BE -sTCP:LISTEN >/dev/null 2>&1 || break; sleep 0.5; done
cd "$W/run/portal"
export DATABASE_ADMIN_HOST=127.0.0.1 DATABASE_ADMIN_PORT=$PG_PORT DATABASE_ADMIN_USER="$E2E_RO_ROLE" DATABASE_ADMIN_PASSWORD="$E2E_RO_PASSWORD" DATABASE_ADMIN_DBNAME=$E2E_DB DATABASE_ADMIN_SSLMODE=disable DATABASE_ADMIN_TIMEZONE=UTC
export REDIS_HOST=127.0.0.1 REDIS_PORT=$P_REDIS_PROXY REDIS_PASSWORD="$SCRATCH_REDIS_PASSWORD" REDIS_DB=0 REDIS_CLEARONSTART=false SERVER_ENV=dev LOG_FILE=off NO_COLOR=1
export SERVER_PORT=$P_PORTAL_BE PORTAL_FRONTENDKEYS=$PORTAL_KEY
export CACHE_INVALIDATEKEY=$INVALIDATE_KEY CACHE_INVALIDATECHANNEL=$INVALIDATE_CHANNEL RATELIMIT_READPERMINUTE=3000
export SITE_DEFAULTBASEURL="http://localhost:$P_PORTAL_FE"
[ -z "${MEDIA_BASE_URL:-}" ] || export MEDIA_BASE_URL
nohup "$W/bin/portal-backend" >> "$W/logs/portal-backend.log" 2>&1 & echo $! > "$W/run/portal.pid"
for i in $(seq 1 60); do curl -fsS "http://127.0.0.1:$P_PORTAL_BE/ready" >/dev/null 2>&1 && break; sleep 1; done; curl -s "http://127.0.0.1:$P_PORTAL_BE/ready"; echo

#!/usr/bin/env bash
# Admin E2E driver. Builds an isolated stack with the scripts of ../../../e2e-cross-system (scratch Postgres/Redis only,
# own throw-away database, HEAD clones + the WORKING TREE of this repo overlaid), runs tests/e2e/specs/*.mjs, tears down.
#   tests/e2e/run.sh            up + test + down (down also on failure)
#   tests/e2e/run.sh up|test|down
#   SPEC=40 tests/e2e/run.sh test     only specs whose file name starts with 40
#   XFLOWS="55 80" tests/e2e/run.sh test   also run these cross-system flows (preview-link UI, M5 posts/albums/FAQ/inbox/notifier)
#   KEEP=1 tests/e2e/run.sh           do not tear down at the end
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
FE="$(cd "$HERE/../.." && pwd)"
X="$(cd "$FE/../e2e-cross-system" && pwd)"      # existing cross-system harness: used; only edit = the scratch SECURITY_WEBHOOKSECRETKEY line in 02/05
cmd="${1:-all}"

up() {
  if [ -f "$X/.work-path" ]; then echo "e2e-cross-system already has a stack ($(cat "$X/.work-path")); run its 99-down.sh or '$0 down' first"; return 1; fi
  [ "$( cd "$FE/../materm-admin-backend" && ./scripts/testdb.sh status | grep -c 'materm-scratch-pg: running' )" = 1 ] \
    || { echo "scratch infra is down: (cd ../materm-admin-backend && make testdb-up)"; return 1; }
  "$X/01-prepare.sh" || return 1
  W="$(cat "$X/.work-path")"
  # video support (release 2): the portal backend / frontend changes are not committed yet and the harness clones HEAD, so overlay their
  # WORKING TREES too (never .git, env files, config.yaml, node_modules, build output) and rebuild the portal backend binary 01-prepare built.
  # OVERLAY_PORTAL=0 tests HEAD only. (The admin backend working tree is overlaid by 01-prepare itself.)
  if [ "${OVERLAY_PORTAL:-1}" = 1 ]; then
    for p in materm-web-portal-backend materm-web-portal-frontend; do
      rsync -a --exclude .git --exclude node_modules --exclude .next --exclude '.env*' --exclude config.yaml --exclude logs --exclude bin "$FE/../$p/" "$W/src/$p/"
      echo "$p overlay=worktree" >> "$X/results/shas.txt"
    done
    (cd "$W/src/materm-web-portal-backend" && go build -o "$W/bin/portal-backend" ./cmd/server) || return 1
  fi
  # overlay the working tree of this repo (uncommitted fixes) onto the HEAD clone; never env files, node_modules, build output
  rsync -a --exclude .git --exclude node_modules --exclude .next --exclude '.env*' --exclude 'tests/e2e/results' "$FE/" "$W/src/materm-admin-frontend/"
  "$X/02-backends.sh" && "$X/03-frontends.sh" && "$X/04-start-frontends.sh" || return 1
  [ -d "$W/pw/node_modules/playwright-core" ] || (mkdir -p "$W/pw" && cd "$W/pw" && npm init -y >/dev/null && npm i playwright-core >/dev/null)
}

test_() {
  [ -f "$X/.work-path" ] || { echo "no stack: run '$0 up' first"; return 1; }
  mkdir -p "$HERE/results"; rc=0
  for f in "$HERE"/specs/${SPEC:-}*.mjs; do
    echo "=== $(basename "$f")"; node "$f" || rc=1
  done
  # optional: flows of the cross-system harness, reused as they are (they write their screenshots / json to ../e2e-cross-system/results)
  for n in ${XFLOWS:-}; do for f in "$X"/${n}-*.mjs; do echo "=== cross-system $(basename "$f")"; (cd "$X" && node "$f") || rc=1; done; done
  return $rc
}

down() { [ -f "$X/.work-path" ] && "$X/99-down.sh"; return 0; }

case "$cmd" in
  up) up ;;
  test) test_ ;;
  down) down ;;
  all)
    trap '[ "${KEEP:-}" = 1 ] || down' EXIT
    up && test_ ;;
esac

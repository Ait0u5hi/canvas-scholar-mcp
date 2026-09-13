#!/usr/bin/env bash
# Roll back to the commit recorded by the last successful scripts/deploy.sh
# run on this host. Run it the same way you'd run deploy.sh (on the actual
# host, from the repo root).
#
# Env vars (all optional):
#   DEPLOY_SERVICE   systemd service name to restart (default: canvas-scholar-mcp)
#   DEPLOY_RUN_AS    user to run git/npm as via `sudo -u -H` (default: unset —
#                    run as whoever invoked this script). Same reasoning as
#                    deploy.sh: systemctl needs root, git/npm need to run as
#                    whichever user owns the checkout so file ownership stays
#                    correct for the systemd service's own `User=`.

set -euo pipefail

SERVICE="${DEPLOY_SERVICE:-canvas-scholar-mcp}"

run_as_owner() {
  if [ -n "${DEPLOY_RUN_AS:-}" ]; then
    sudo -u "$DEPLOY_RUN_AS" -H "$@"
  else
    "$@"
  fi
}

if [ ! -f .last-deployed-sha ]; then
  echo "error: no .last-deployed-sha found in $(pwd) — nothing recorded to roll back to." >&2
  echo "       (this file is written by scripts/deploy.sh on every run)" >&2
  exit 1
fi

PREV_SHA="$(cat .last-deployed-sha)"
CURRENT_SHA="$(run_as_owner git rev-parse HEAD)"

if [ "$PREV_SHA" = "$CURRENT_SHA" ]; then
  echo "error: .last-deployed-sha ($PREV_SHA) is the current HEAD — nothing to roll back," \
    "did you mean to run this before another deploy.sh?" >&2
  exit 1
fi

echo "==> Rolling back $CURRENT_SHA -> $PREV_SHA"
run_as_owner git checkout "$PREV_SHA"

echo "==> Installing + building"
run_as_owner npm ci
run_as_owner npm run build

echo "==> Restarting $SERVICE"
systemctl restart "$SERVICE"
sleep 1
if ! systemctl is-active --quiet "$SERVICE"; then
  echo "error: $SERVICE failed to start after rollback — check: journalctl -u $SERVICE -n 50" >&2
  exit 1
fi

echo "==> Rolled back to $PREV_SHA"
echo "note: HEAD is now detached at $PREV_SHA — run deploy.sh again once the" \
  "underlying issue is fixed to get back onto a branch."

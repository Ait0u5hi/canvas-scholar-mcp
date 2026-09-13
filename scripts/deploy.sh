#!/usr/bin/env bash
# Deploy the currently-checked-out repo to a running canvas-scholar-mcp
# instance: pull, install, build, restart, verify.
#
# Run this ON THE HOST the server actually runs on, from the repo's working
# directory. Getting onto that host (SSH, a container exec, whatever) is
# deliberately NOT part of this script — that's environment-specific, this
# isn't. Nothing here assumes any particular hosting setup (a bare VM, a
# container, a specific cloud, etc.) beyond "systemd manages the service and
# git/node/npm are on PATH".
#
# Two different privilege levels are often involved, and this script expects
# to be run as whichever one can do BOTH, or told how to bridge them:
#   - git/npm need to run as whatever user OWNS the checkout (often a
#     dedicated low-privilege service account, e.g. a systemd unit's `User=`)
#   - `systemctl restart` needs root (or equivalent), which that low-priv
#     account typically does NOT have
# If you invoke this as root but the checkout is owned by another user, set
# DEPLOY_RUN_AS to that user — git/npm run via `sudo -u`, systemctl runs
# directly as the invoker. If one account already has both permissions,
# leave DEPLOY_RUN_AS unset and everything runs as whoever invoked the script.
#
# Usage:
#   DEPLOY_SERVICE=canvas-scholar-mcp scripts/deploy.sh
#   DEPLOY_REF=v1.2.0 scripts/deploy.sh          # deploy a tag instead of a branch
#   DEPLOY_RUN_AS=canvas scripts/deploy.sh       # run as root, build as `canvas`
#   MCP_REGISTRY_SYNC_CMD=./scripts/examples/sync-mlflow-registry.py scripts/deploy.sh
#
# Env vars (all optional):
#   DEPLOY_REF               git ref to deploy (default: main)
#   DEPLOY_SERVICE            systemd service name to restart (default: canvas-scholar-mcp)
#   DEPLOY_RUN_AS             user to run git/npm as via `sudo -u -H` (default:
#                             unset — run as whoever invoked this script).
#                             systemctl always runs as the invoker, never via
#                             DEPLOY_RUN_AS, since that user usually lacks
#                             rights to restart a unit.
#   DEPLOY_HEALTHCHECK_GREP   string to look for in the service's recent journal
#                             output after restart, to confirm it actually came
#                             up (default: "listening") — set to "" to skip
#   MCP_REGISTRY_SYNC_CMD     optional command run after a successful deploy,
#                             with DEPLOY_NEW_VERSION/DEPLOY_NEW_SHA in its env.
#                             Unset = skip entirely; this script has no
#                             built-in registry integration of its own. See
#                             scripts/examples/ for a reference implementation.
#
# Records the pre-deploy commit in .last-deployed-sha so scripts/rollback.sh
# can undo this deploy without needing to know the ref history.

set -euo pipefail

REF="${DEPLOY_REF:-main}"
SERVICE="${DEPLOY_SERVICE:-canvas-scholar-mcp}"
HEALTHCHECK_GREP="${DEPLOY_HEALTHCHECK_GREP-listening}"

# Run $* as DEPLOY_RUN_AS (with that user's own HOME, so npm/git use its
# caches/config, not the invoker's) when set; otherwise just run it directly.
run_as_owner() {
  if [ -n "${DEPLOY_RUN_AS:-}" ]; then
    sudo -u "$DEPLOY_RUN_AS" -H "$@"
  else
    "$@"
  fi
}

if [ ! -f package.json ] || ! grep -q '"canvas-scholar-mcp"' package.json 2>/dev/null; then
  echo "error: run this from the canvas-scholar-mcp repo root (package.json not found/matched)" >&2
  exit 1
fi

echo "==> Recording current commit for rollback"
PREV_SHA="$(run_as_owner git rev-parse HEAD)"
echo "$PREV_SHA" > .last-deployed-sha

echo "==> Ensuring the remote is fully fetchable (not narrowed to one branch)"
# A clone made with e.g. `git clone -b X --single-branch` leaves
# remote.origin.fetch pointed at just that one branch, so `git fetch` can
# silently fail to see any other branch, including the one you're trying to
# deploy. Idempotent — safe to run every time.
run_as_owner git config remote.origin.fetch '+refs/heads/*:refs/remotes/origin/*'
run_as_owner git fetch --prune origin

echo "==> Checking out $REF"
# Distinguish "which ref FORM resolves" (branch vs. tag/commit) from "did the
# checkout itself succeed" — these used to be conflated via a blanket
# `checkout -B ... 2>/dev/null || checkout ...` that treated ANY failure
# (wrong ref form, but ALSO e.g. an untracked-file collision) as "fall back
# to a no-op checkout of whatever's already there", silently deploying the
# OLD commit while still reporting success. Pick the right form first, THEN
# let a real checkout failure halt the script loudly (set -e).
if run_as_owner git rev-parse --verify -q "origin/$REF" >/dev/null; then
  run_as_owner git checkout -B "$REF" "origin/$REF"
elif run_as_owner git rev-parse --verify -q "$REF" >/dev/null; then
  run_as_owner git checkout "$REF" # a tag or commit sha, not a branch
else
  echo "error: ref '$REF' not found as a branch (origin/$REF) or a tag/commit ($REF)" >&2
  exit 1
fi
NEW_SHA="$(run_as_owner git rev-parse HEAD)"

echo "==> Installing + building"
run_as_owner npm ci
run_as_owner npm run build

echo "==> Restarting $SERVICE"
systemctl restart "$SERVICE"
sleep 1
if ! systemctl is-active --quiet "$SERVICE"; then
  echo "error: $SERVICE failed to start after restart — check: journalctl -u $SERVICE -n 50" >&2
  exit 1
fi

if [ -n "$HEALTHCHECK_GREP" ]; then
  echo "==> Health check: looking for \"$HEALTHCHECK_GREP\" in the last 20 log lines"
  if ! journalctl -u "$SERVICE" -n 20 --no-pager 2>/dev/null | grep -qi "$HEALTHCHECK_GREP"; then
    echo "warning: didn't see \"$HEALTHCHECK_GREP\" in recent logs — service is" \
      "active but may not have finished starting; check manually." >&2
  fi
fi

NEW_VERSION="$(node -p "require('./package.json').version")"
echo "==> Deployed $PREV_SHA -> $NEW_SHA (version $NEW_VERSION)"

if [ -n "${MCP_REGISTRY_SYNC_CMD:-}" ]; then
  echo "==> Running registry sync: $MCP_REGISTRY_SYNC_CMD"
  DEPLOY_NEW_VERSION="$NEW_VERSION" DEPLOY_NEW_SHA="$NEW_SHA" "$MCP_REGISTRY_SYNC_CMD" \
    || echo "warning: registry sync command failed — deploy itself succeeded, sync did not" >&2
fi

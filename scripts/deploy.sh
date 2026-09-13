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
# Usage:
#   DEPLOY_SERVICE=canvas-scholar-mcp scripts/deploy.sh
#   DEPLOY_REF=v1.2.0 scripts/deploy.sh          # deploy a tag instead of a branch
#   MCP_REGISTRY_SYNC_CMD=./scripts/examples/sync-mlflow-registry.py scripts/deploy.sh
#
# Env vars (all optional):
#   DEPLOY_REF               git ref to deploy (default: main)
#   DEPLOY_SERVICE            systemd service name to restart (default: canvas-scholar-mcp)
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

if [ ! -f package.json ] || ! grep -q '"canvas-scholar-mcp"' package.json 2>/dev/null; then
  echo "error: run this from the canvas-scholar-mcp repo root (package.json not found/matched)" >&2
  exit 1
fi

echo "==> Recording current commit for rollback"
PREV_SHA="$(git rev-parse HEAD)"
echo "$PREV_SHA" > .last-deployed-sha

echo "==> Ensuring the remote is fully fetchable (not narrowed to one branch)"
# A clone made with e.g. `git clone -b X --single-branch` leaves
# remote.origin.fetch pointed at just that one branch, so `git fetch` can
# silently fail to see any other branch, including the one you're trying to
# deploy. Idempotent — safe to run every time.
git config remote.origin.fetch '+refs/heads/*:refs/remotes/origin/*'
git fetch --prune origin

echo "==> Checking out $REF"
git checkout -B "$REF" "origin/$REF" 2>/dev/null || git checkout "$REF"
NEW_SHA="$(git rev-parse HEAD)"

echo "==> Installing + building"
npm ci
npm run build

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

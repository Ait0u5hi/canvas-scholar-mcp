#!/usr/bin/env python3
"""
EXAMPLE registry-sync implementation for scripts/deploy.sh's
MCP_REGISTRY_SYNC_CMD hook — for MLflow's built-in MCP Server Registry
specifically. This is one possible implementation, not a default: deploy.sh
has no opinion on which registry (if any) you use, and works identically
with this hook unset.

What MLflow's MCP Server Registry actually is (verified against the
installed client library, not just docs): a metadata CATALOG — server /
version / tool-list / access-endpoint records, optionally linkable to
observability traces. It is NOT a proxy or gateway: clients still connect
directly to the real server URL either way. So this script is bookkeeping,
not something the deploy depends on — a failure here should never be treated
as a failed deploy (and deploy.sh already treats it that way).

Requires: pip install mlflow (only on whatever host runs this sync step —
not a canvas-scholar-mcp runtime dependency).

Env vars (all required; deploy.sh passes DEPLOY_NEW_VERSION/DEPLOY_NEW_SHA,
you provide the rest via your own environment or a wrapper):
  MLFLOW_TRACKING_URI        e.g. http://localhost:5555
  MCP_REGISTRY_SERVER_NAME   the name this server is ALREADY registered
                             under in MLflow (check with search_mcp_servers()
                             first — see the note on name casing below)
  MCP_REGISTRY_ENDPOINT_URL  the real, live URL clients connect to
  DEPLOY_NEW_VERSION         set by deploy.sh
  DEPLOY_NEW_SHA             set by deploy.sh (used as `source`)

Casing note: MLflow's `server_json["name"]` is free-form, but the public MCP
registry standard (registry.modelcontextprotocol.io) ties an `io.github.*`
name to OAuth-verified GitHub identity, which is case-sensitive. If your
repo's server.json name doesn't exactly match what's already registered in
MLflow (e.g. a casing mismatch), do NOT edit the tracked server.json to
match MLflow — pass MCP_REGISTRY_SERVER_NAME as a separate override instead,
the way this script does. Getting this wrong creates a duplicate server
record in MLflow (recoverable: deprecate + delete the stray version, then
delete the stray server — but better to just pass the right name here).
"""
import json
import os
import sys
from pathlib import Path

from mlflow.tracking import MlflowClient
from mlflow.store.tracking.mcp_server_registry.rest_mixin import (
    MCPStatus,
    MCPRemoteTransportType,
)

REPO_ROOT = Path(__file__).resolve().parent.parent.parent


def env(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        print(f"error: {name} is not set", file=sys.stderr)
        sys.exit(1)
    return value


def main() -> None:
    server_name = env("MCP_REGISTRY_SERVER_NAME")
    endpoint_url = env("MCP_REGISTRY_ENDPOINT_URL")
    new_version = env("DEPLOY_NEW_VERSION")
    new_sha = os.environ.get("DEPLOY_NEW_SHA", "")

    with open(REPO_ROOT / "server.json") as f:
        server_json = json.load(f)
    # Use the registered name, not necessarily the repo file's name — see
    # the casing note in this file's docstring.
    server_json = {**server_json, "name": server_name}

    repo_url = server_json.get("repository", {}).get("url", "")
    source = f"{repo_url}/commit/{new_sha}" if repo_url and new_sha else repo_url or None

    client = MlflowClient()

    version = client.create_mcp_server_version(
        server_json=server_json,
        source=source,
        status=MCPStatus.ACTIVE,
    )
    print(f"registered version {version.version}")

    client.create_mcp_access_endpoint(
        server_name=server_name,
        url=endpoint_url,
        transport_type=MCPRemoteTransportType.STREAMABLE_HTTP,
        server_version=version.version,
    )
    print(f"registered endpoint {endpoint_url} -> version {version.version}")

    # Deprecate every other ACTIVE version — this deploy's version is now
    # the one and only current one.
    for v in client.search_mcp_server_versions(server_name):
        if v.version != new_version and v.status == MCPStatus.ACTIVE:
            client.update_mcp_server_version(server_name, v.version, status=MCPStatus.DEPRECATED)
            print(f"deprecated superseded version {v.version}")


if __name__ == "__main__":
    main()

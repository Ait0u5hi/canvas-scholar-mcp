# Security & Privacy

## Trust boundary

Canvas Scholar runs entirely on your machine and talks to exactly one remote: your
institution's Canvas host, using **your** personal access token. It makes only
read (`GET`) requests and only to `/users/self/…` or your own enrollment records.

- It **cannot** read another student's data. The one call that hits a class-wide
  endpoint (`/courses/:id/enrollments`) is always scoped with `user_id: "self"`,
  and a regression test (`tests/privacy.test.ts`) fails the build if that scope
  is ever removed.
- It **never writes** to Canvas.
- It **never logs** your token, request bodies, or personal data. Diagnostics go
  to stderr and contain only high-level status.

## Network exposure (opt-in HTTP mode)

By default the server runs over **stdio** and only communicates with the local
client that spawned it — the boundary above holds with no network surface.

The optional `MCP_TRANSPORT=http` mode (see the README "Remote / LAN" section)
turns it into a network service that can read *your* Canvas data, which widens
the boundary:

- Every request must carry a valid `Authorization: Bearer <MCP_AUTH_TOKEN>`;
  the server **refuses to start** in HTTP mode without `MCP_AUTH_TOKEN` and
  returns `401` for missing/invalid tokens (verified in `tests/http-auth.test.ts`).
- `MCP_AUTH_TOKEN` is a **server-access** secret, separate from your Canvas
  token. Compared in constant time; treat it as a credential.
- This is an **API-key** pattern — a deliberate, proportionate deviation from the
  MCP HTTP-auth spec's (optional) OAuth 2.1 resource-server model, appropriate
  for a single-user LAN deployment, **not** for open-internet exposure.
- The transport is plain HTTP. Bind to `127.0.0.1` by default; only use
  `0.0.0.0` on a trusted LAN, and front it with TLS (e.g. a Caddy reverse proxy)
  for anything more exposed.

## Token handling

- Via the `.mcpb` one-click installer, your token is marked `sensitive` and stored
  in your OS keychain (macOS Keychain / Windows Credential Manager), not in a
  plaintext config file.
- Via `npx`/manual config, the token lives in your client's MCP config env. Protect
  that file as you would any credential.
- Create the token with an **expiration date** and the narrowest scope your
  institution offers. You can revoke it any time in Canvas → Account → Settings.

## Reporting a vulnerability

Open a private security advisory on the GitHub repository, or email the maintainer.
Please do not file a public issue for a sensitive report.

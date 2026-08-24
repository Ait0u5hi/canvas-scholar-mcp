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

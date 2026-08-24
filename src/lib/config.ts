/**
 * Runtime configuration, read from the environment.
 *
 * CANVAS_API_TOKEN — a Canvas personal access token (Account → Settings →
 *   "+ New Access Token"). Give it an expiration date; treat it like a password.
 * CANVAS_DOMAIN — your institution's Canvas host, e.g. "school.instructure.com"
 *   (no scheme, no trailing slash). A full URL is also accepted and normalized.
 */
export interface CanvasConfig {
  token: string;
  baseUrl: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): CanvasConfig {
  const token = env.CANVAS_API_TOKEN?.trim();
  const rawDomain = env.CANVAS_DOMAIN?.trim();

  if (!token) {
    throw new Error(
      "CANVAS_API_TOKEN is not set. Create one at Canvas → Account → Settings → New Access Token.",
    );
  }
  if (!rawDomain) {
    throw new Error(
      "CANVAS_DOMAIN is not set. Use your Canvas host, e.g. school.instructure.com",
    );
  }

  return { token, baseUrl: normalizeBaseUrl(rawDomain) };
}

/** Accept "school.instructure.com", "https://school.instructure.com/", etc. */
export function normalizeBaseUrl(domain: string): string {
  let host = domain.replace(/^https?:\/\//i, "").replace(/\/+$/, "");
  // Strip an accidental trailing /api/v1 if a user pasted a full API URL.
  host = host.replace(/\/api\/v1$/i, "");
  return `https://${host}/api/v1`;
}

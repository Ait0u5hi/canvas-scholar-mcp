import type { CanvasConfig } from "./config.js";

/**
 * A thin, read-only Canvas REST client built on the platform `fetch`
 * (Node 18+). No third-party HTTP dependency — this keeps the bundle a clean
 * single ESM file and avoids CJS/ESM interop hazards.
 *
 * Written against the public Canvas LMS API documentation
 * (https://canvas.instructure.com/doc/api/). It does not adapt any other
 * project's client code.
 */
export interface UsageInfo {
  requestsThisSession: number;
  /** Canvas's reported remaining rate-limit budget (bucket starts ~700). */
  canvasQuotaRemaining: number | null;
  status: "ok" | "getting low" | "unknown";
}

export class CanvasClient {
  private readonly baseUrl: string;
  private readonly headers: Record<string, string>;

  // Rate-limit / usage tracking (from Canvas response headers).
  private requests = 0;
  private remaining: number | null = null;
  private lastNoticeAtRequest = -Infinity;

  constructor(config: CanvasConfig) {
    this.baseUrl = config.baseUrl;
    this.headers = {
      Authorization: `Bearer ${config.token}`,
      Accept: "application/json",
    };
  }

  /** A snapshot of API usage this session. */
  usage(): UsageInfo {
    return {
      requestsThisSession: this.requests,
      canvasQuotaRemaining: this.remaining,
      status:
        this.remaining == null
          ? "unknown"
          : this.remaining < 150
            ? "getting low"
            : "ok",
    };
  }

  /**
   * A short friendly heads-up when the Canvas budget is running low — returned
   * at most once every ~10 requests so it's an occasional reminder, not spam.
   * Returns null when there's nothing worth saying.
   */
  consumeUsageNotice(): string | null {
    if (this.remaining != null && this.remaining < 150) {
      if (this.requests - this.lastNoticeAtRequest >= 10) {
        this.lastNoticeAtRequest = this.requests;
        return (
          `⚠️ Heads-up: your Canvas API budget is getting low ` +
          `(~${Math.round(this.remaining)} left in this window; it refills over ~a minute). ` +
          `Spacing out heavy requests will avoid hitting the limit.`
        );
      }
    }
    return null;
  }

  private track(res: Response): void {
    this.requests += 1;
    const rem = Number(res.headers.get("x-rate-limit-remaining"));
    if (!Number.isNaN(rem)) this.remaining = rem;
  }

  /** GET a single resource (or the first page, un-paginated). */
  async get<T = unknown>(
    path: string,
    params: Record<string, unknown> = {},
  ): Promise<T> {
    const res = await this.fetch(this.buildUrl(path, params));
    return (await this.parse(res)) as T;
  }

  /**
   * GET a list resource, following RFC 5988 `Link: rel="next"` pagination until
   * exhausted. Canvas caps `per_page`; we request 100 and let it clamp.
   */
  async getPaginated<T = unknown>(
    path: string,
    params: Record<string, unknown> = {},
    maxPages = 20,
  ): Promise<T[]> {
    const out: T[] = [];
    let url: string | undefined = this.buildUrl(path, {
      per_page: 100,
      ...params,
    });
    let pages = 0;
    while (url && pages < maxPages) {
      const res = await this.fetch(url);
      const page = (await this.parse(res)) as T[];
      out.push(...(Array.isArray(page) ? page : [page]));
      url = nextLink(res.headers.get("link"));
      pages += 1;
    }
    return out;
  }

  private async fetch(url: string): Promise<Response> {
    const res = await fetch(url, { headers: this.headers });
    this.track(res);
    if (!res.ok) {
      // Canvas signals throttling with a 403 (sometimes 429) whose body mentions
      // the rate limit; surface that as a friendly, actionable message.
      if (res.status === 403 || res.status === 429) {
        const body = await res.text().catch(() => "");
        if (res.status === 429 || /rate limit/i.test(body)) {
          throw new Error(
            `Canvas API rate limit hit (${res.status}). Your request budget is ` +
              `temporarily exhausted — wait ~a minute for it to refill, then retry.`,
          );
        }
        throw new Error(`Canvas API 403 Forbidden for ${redact(url)}`);
      }
      throw new Error(
        `Canvas API ${res.status} ${res.statusText} for ${redact(url)}` +
          (res.status === 401
            ? " — the token is likely invalid or expired."
            : ""),
      );
    }
    return res;
  }

  /**
   * Guard against an HTML error/login page masquerading as a 200. Canvas serves
   * HTML (not JSON) when a token is invalid or a route is wrong. Coercing the
   * header to a string keeps the check total regardless of header representation.
   */
  private async parse(res: Response): Promise<unknown> {
    const contentType = String(res.headers.get("content-type") ?? "");
    if (contentType && !contentType.includes("application/json")) {
      throw new Error(
        `Canvas returned a non-JSON response (content-type: ${contentType}). ` +
          "This usually means the API token is invalid/expired or the domain is wrong.",
      );
    }
    return res.json();
  }

  private buildUrl(path: string, params: Record<string, unknown>): string {
    // `path` may be an absolute URL (a paginated `next` link) or a relative path.
    const url = new URL(
      path.startsWith("http") ? path : `${this.baseUrl}${path}`,
    );
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === null) continue;
      if (Array.isArray(value)) {
        // Canvas expects array params as `key[]=a&key[]=b`.
        for (const v of value) url.searchParams.append(`${key}[]`, String(v));
      } else {
        url.searchParams.set(key, String(value));
      }
    }
    return url.toString();
  }
}

/** Extract the rel="next" URL from a Link header, if present. */
export function nextLink(linkHeader: unknown): string | undefined {
  const header = String(linkHeader ?? "");
  if (!header) return undefined;
  for (const part of header.split(",")) {
    const [urlPart, ...rel] = part.split(";");
    if (rel.some((r) => /rel="?next"?/.test(r))) {
      const m = urlPart.match(/<([^>]+)>/);
      if (m) return m[1];
    }
  }
  return undefined;
}

/** Never surface the token if a URL ever carries it. */
function redact(url: string): string {
  return url.replace(/access_token=[^&]+/g, "access_token=REDACTED");
}

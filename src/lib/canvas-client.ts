import type { CanvasConfig } from "./config.js";

/**
 * A thin Canvas REST client built on the platform `fetch` (Node 18+). No
 * third-party HTTP dependency — this keeps the bundle a clean single ESM
 * file and avoids CJS/ESM interop hazards.
 *
 * Written against the public Canvas LMS API documentation
 * (https://canvas.instructure.com/doc/api/). It does not adapt any other
 * project's client code.
 *
 * Mostly read-only (`get`/`getPaginated`); `post`/`put` exist only for the
 * two deliberately-destructive calendar-write tools — see register.ts.
 */
export interface UsageInfo {
  requestsThisSession: number;
  /** Canvas's reported remaining rate-limit budget (bucket starts ~700). */
  canvasQuotaRemaining: number | null;
  status: "ok" | "getting low" | "unknown";
}

/**
 * A failed Canvas API call, carrying the real HTTP status and a coarse
 * `kind` classification as structured fields — not just prose. Error
 * handling elsewhere in this codebase used to classify failures by regexing
 * the thrown message (e.g. `/\b403\b/`), which is fragile: Canvas's
 * rate-limit message also contains the literal substring "403"
 * (`"Canvas API rate limit hit (403)..."`), so a naive substring match
 * misclassifies a throttled request as a permission failure. Check `.status`
 * or `.kind` instead of matching on `.message`.
 */
export class CanvasApiError extends Error {
  readonly status: number;
  readonly kind: "rate_limit" | "forbidden" | "unauthorized" | "other";

  constructor(message: string, status: number, kind: CanvasApiError["kind"]) {
    super(message);
    this.name = "CanvasApiError";
    this.status = status;
    this.kind = kind;
  }
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

  /** POST a JSON body to Canvas (e.g. creating a calendar event). */
  async post<T = unknown>(path: string, body: unknown): Promise<T> {
    return this.write<T>("POST", path, body);
  }

  /** PUT a JSON body to Canvas (e.g. updating a calendar event). */
  async put<T = unknown>(path: string, body: unknown): Promise<T> {
    return this.write<T>("PUT", path, body);
  }

  private async write<T>(
    method: "POST" | "PUT",
    path: string,
    body: unknown,
  ): Promise<T> {
    const res = await this.fetch(this.buildUrl(path, {}), {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return (await this.parse(res)) as T;
  }

  private async fetch(url: string, init: RequestInit = {}): Promise<Response> {
    const res = await fetch(url, {
      ...init,
      headers: { ...this.headers, ...(init.headers as Record<string, string>) },
    });
    this.track(res);
    if (!res.ok) {
      // Canvas signals throttling with a 403 (sometimes 429) whose body mentions
      // the rate limit; surface that as a friendly, actionable message.
      if (res.status === 403 || res.status === 429) {
        const body = await res.text().catch(() => "");
        if (res.status === 429 || /rate limit/i.test(body)) {
          throw new CanvasApiError(
            `Canvas API rate limit hit (${res.status}). Your request budget is ` +
              `temporarily exhausted — wait ~a minute for it to refill, then retry.`,
            res.status,
            "rate_limit",
          );
        }
        throw new CanvasApiError(
          `Canvas API 403 Forbidden for ${redact(url)}`,
          403,
          "forbidden",
        );
      }
      // Canvas write failures normally carry a JSON `errors[]`/`message` body
      // (e.g. "end_at can't be before start_at") — surface it instead of a
      // bare, useless "400 Bad Request".
      const detail = await extractErrorDetail(res);
      throw new CanvasApiError(
        `Canvas API ${res.status} ${res.statusText} for ${redact(url)}` +
          (res.status === 401
            ? " — the token is likely invalid or expired."
            : "") +
          (detail ? ` — ${detail}` : ""),
        res.status,
        res.status === 401 ? "unauthorized" : "other",
      );
    }
    return res;
  }

  /**
   * Guard against an HTML error/login page masquerading as a 200. Canvas serves
   * HTML (not JSON) when a token is invalid or a route is wrong. Coercing the
   * header to a string keeps the check total regardless of header representation.
   * A `PUT` can legitimately return `204 No Content` (no body to parse at all).
   */
  private async parse(res: Response): Promise<unknown> {
    if (res.status === 204) return undefined;
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

/**
 * Best-effort extraction of Canvas's error detail from a failed response body
 * — Canvas write failures typically return `{"errors": [{"message": "..."}]}`
 * or `{"message": "..."}`. Falls back to a truncated raw body, and never
 * throws itself (a malformed error body shouldn't hide the original error).
 */
async function extractErrorDetail(res: Response): Promise<string> {
  try {
    const text = await res.text();
    if (!text) return "";
    const parsed = JSON.parse(text) as {
      errors?: Array<{ message?: string }> | Record<string, unknown>;
      message?: string;
    };
    if (Array.isArray(parsed?.errors)) {
      return parsed.errors
        .map((e) => e?.message ?? JSON.stringify(e))
        .join("; ");
    }
    if (typeof parsed?.message === "string") return parsed.message;
    if (parsed?.errors) return JSON.stringify(parsed.errors);
    return text.slice(0, 300);
  } catch {
    return "";
  }
}

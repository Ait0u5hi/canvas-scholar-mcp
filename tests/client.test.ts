import { describe, it, expect } from "vitest";
import { normalizeBaseUrl, loadConfig } from "../src/lib/config.js";
import { nextLink } from "../src/lib/canvas-client.js";

describe("config", () => {
  it("normalizes a bare domain to an /api/v1 base url", () => {
    expect(normalizeBaseUrl("school.instructure.com")).toBe(
      "https://school.instructure.com/api/v1",
    );
  });

  it("tolerates a full URL, scheme, trailing slash, and pasted /api/v1", () => {
    expect(normalizeBaseUrl("https://school.instructure.com/")).toBe(
      "https://school.instructure.com/api/v1",
    );
    expect(normalizeBaseUrl("http://school.instructure.com/api/v1")).toBe(
      "https://school.instructure.com/api/v1",
    );
  });

  it("throws a clear error when the token is missing", () => {
    expect(() => loadConfig({ CANVAS_DOMAIN: "x.instructure.com" })).toThrow(
      /CANVAS_API_TOKEN/,
    );
  });

  it("throws a clear error when the domain is missing", () => {
    expect(() => loadConfig({ CANVAS_API_TOKEN: "t" })).toThrow(/CANVAS_DOMAIN/);
  });
});

describe("pagination Link parsing", () => {
  it("extracts rel=next", () => {
    const header =
      '<https://x/api/v1/courses?page=2>; rel="next", <https://x/api/v1/courses?page=1>; rel="prev"';
    expect(nextLink(header)).toBe("https://x/api/v1/courses?page=2");
  });

  it("returns undefined when there is no next page", () => {
    const header = '<https://x/api/v1/courses?page=1>; rel="prev"';
    expect(nextLink(header)).toBeUndefined();
    expect(nextLink(undefined)).toBeUndefined();
  });
});

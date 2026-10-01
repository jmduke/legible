import { describe, expect, it } from "vitest";
import { displayPath, isInternal, normalizeUrl } from "./url";

describe("normalizeUrl", () => {
  it("resolves relative URLs against a base", () => {
    expect(normalizeUrl("/pricing", "https://example.com/blog/post")).toBe(
      "https://example.com/pricing",
    );
    expect(normalizeUrl("../a", "https://example.com/b/c/d")).toBe(
      "https://example.com/b/a",
    );
  });

  it("drops fragments but keeps query strings", () => {
    expect(normalizeUrl("https://example.com/a?page=2#section")).toBe(
      "https://example.com/a?page=2",
    );
  });

  it("rejects non-http(s) schemes", () => {
    expect(normalizeUrl("mailto:hi@example.com")).toBeNull();
    expect(
      normalizeUrl("javascript:void(0)", "https://example.com"),
    ).toBeNull();
    expect(normalizeUrl("tel:+15555555555", "https://example.com")).toBeNull();
  });

  it("returns null for garbage", () => {
    expect(normalizeUrl("http://")).toBeNull();
    expect(normalizeUrl("not a url")).toBeNull();
  });
});

describe("isInternal", () => {
  it("treats www and bare hostnames as the same site", () => {
    expect(isInternal("https://www.example.com/a", "https://example.com")).toBe(
      true,
    );
    expect(isInternal("https://example.com/a", "https://www.example.com")).toBe(
      true,
    );
  });

  it("excludes other hosts and subdomains", () => {
    expect(isInternal("https://other.com/a", "https://example.com")).toBe(
      false,
    );
    expect(
      isInternal("https://docs.example.com/a", "https://example.com"),
    ).toBe(false);
  });
});

describe("displayPath", () => {
  it("shows the site-relative path with query", () => {
    expect(displayPath("https://example.com/a/b?x=1")).toBe("/a/b?x=1");
  });
});

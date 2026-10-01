import { describe, expect, it } from "vitest";
import { crawlSite } from "../crawler";
import { checkExternal } from "../crawler/external";
import { findingsOfType } from "../findings";
import { runSiteChecks } from "../sitechecks";
import { routeFetch } from "../testing";
import { runDetectors } from "./index";

/**
 * Tranche-3 detectors: anchors, rendering artifacts, staging leaks, soft
 * 404s, canonicals, structured data, social cards, deep pages, external
 * links, embeds, and site-level checks.
 */
const ORIGIN = "https://example.com";

const page = (head: string, body: string) =>
  `<html lang="en"><head><title>t</title><meta name="description" content="d">${head}</head><body><h1>h</h1>${body}</body></html>`;

const routes: Record<
  string,
  { body?: string; status?: number; headers?: Record<string, string> }
> = {
  "/robots.txt": { status: 200, body: "User-agent: *\nDisallow:" },
  "/": {
    body: page(
      '<link rel="icon" href="/icon.png"><link rel="alternate" type="application/rss+xml" href="/feed.xml">',
      `<a href="/docs#real-section">ok anchor</a>
       <a href="/docs#missing-section">bad anchor</a>
       <a href="/broken-json">x</a>
       <a href="/artifacts">x</a>
       <a href="/soft">x</a>
       <a href="/canon-redirect">x</a>
       <a href="/canon-dead">x</a>
       <a href="/og">x</a>
       <a href="https://dead-external.example.net/page">external</a>
       <a href="http://localhost:3000/dev">dev link</a>
       <iframe src="https://www.youtube.com/embed/deadvideo123"></iframe>
       <a href="/d1">x</a>`,
    ),
  },
  "/docs": {
    body: page("", '<h2 id="real-section">Real</h2>'),
  },
  "/broken-json": {
    body: page(
      '<script type="application/ld+json">{"@context": broken}</script>',
      "x",
    ),
  },
  "/artifacts": {
    body: page(
      "",
      "<p>Price: <span>undefined</span></p><p>Hello {{ user.name }}</p>",
    ),
  },
  "/soft": {
    body: `<html lang="en"><head><title>Page not found</title><meta name="description" content="d"></head><body><h1>h</h1></body></html>`,
  },
  "/canon-redirect": {
    body: page('<link rel="canonical" href="/moved">', "x"),
  },
  "/moved": { status: 301, headers: { location: "/docs" } },
  "/canon-dead": {
    body: page('<link rel="canonical" href="/gone-forever">', "x"),
  },
  "/gone-forever": { status: 404 },
  "/og": {
    body: page('<meta property="og:image" content="/og-image.png">', "x"),
  },
  "/og-image.png": { status: 404 },
  // Chain /d1 -> /d2 -> ... -> /d6 for depth testing.
  "/d1": { body: page("", '<a href="/d2">x</a>') },
  "/d2": { body: page("", '<a href="/d3">x</a>') },
  "/d3": { body: page("", '<a href="/d4">x</a>') },
  "/d4": { body: page("", '<a href="/d5">x</a>') },
  "/d5": { body: page("", '<a href="/d6">x</a>') },
  "/d6": { body: page("", "deep!") },
  "/icon.png": { body: "png" },
  "/feed.xml": { status: 500 },
};

const fakeFetch = routeFetch(async (url) => {
  if (url.hostname === "dead-external.example.net") {
    return new Response("gone", { status: 404 });
  }
  if (url.hostname === "www.youtube.com" && url.pathname === "/oembed") {
    return new Response("not found", { status: 404 });
  }
  if (url.hostname === "www.example.com") {
    // www variant redirects properly — no www_duplicate finding.
    return new Response(null, {
      status: 301,
      headers: { location: "https://example.com/" },
    });
  }
  const route = routes[url.pathname];
  if (!route) return new Response("not found", { status: 404 });
  return new Response(route.body ?? "x", {
    status: route.status ?? 200,
    headers: { "content-type": "text/html", ...route.headers },
  });
});

async function scanAll() {
  const crawl = await crawlSite({ origin: ORIGIN, fetchImpl: fakeFetch });
  const external = await checkExternal(crawl, fakeFetch);
  const detectorFindings = runDetectors({ crawl, sitemapUrls: [], external });
  const siteFindings = await runSiteChecks({
    origin: ORIGIN,
    crawl,
    sitemapEntries: [
      { url: `${ORIGIN}/`, lastmod: "2020-01-01" },
      { url: `${ORIGIN}/docs`, lastmod: "2199-01-01" },
    ],
    fetchImpl: fakeFetch,
    certExpiry: async () => new Date(Date.now() + 200 * 86_400_000),
  });
  return [...detectorFindings, ...siteFindings];
}

describe("tranche 3", () => {
  it("flags broken anchors but not valid ones", async () => {
    const findings = await scanAll();
    const anchors = findingsOfType(findings, "broken_anchor");
    expect(anchors.map((f) => f.key)).toEqual([
      `${ORIGIN}/docs#missing-section`,
    ]);
    expect(anchors[0].detail.linkedFrom).toEqual([`${ORIGIN}/`]);
  });

  it("flags rendering artifacts (bare undefined, unrendered template)", async () => {
    const findings = await scanAll();
    const artifacts = findingsOfType(findings, "rendering_artifact").map(
      (f) => f.detail.artifact,
    );
    expect(artifacts).toContain('bare "undefined"');
    expect(artifacts).toContain("unrendered template");
  });

  it("flags staging/localhost leaks", async () => {
    const findings = await scanAll();
    const leaks = findingsOfType(findings, "staging_leak");
    expect(leaks.map((f) => f.key)).toEqual(["http://localhost:3000/dev"]);
  });

  it("flags soft 404s by title", async () => {
    const findings = await scanAll();
    const soft = findingsOfType(findings, "soft_404");
    expect(soft.map((f) => f.detail.url)).toEqual([`${ORIGIN}/soft`]);
  });

  it("flags canonicals pointing at redirects and dead pages", async () => {
    const findings = await scanAll();
    const kinds = findingsOfType(findings, "canonical_issue").map((f) => [
      f.detail.url,
      f.detail.kind,
    ]);
    expect(kinds).toContainEqual([
      `${ORIGIN}/canon-redirect`,
      "canonical_to_redirect",
    ]);
    expect(kinds).toContainEqual([`${ORIGIN}/canon-dead`, "canonical_to_dead"]);
  });

  it("flags malformed JSON-LD", async () => {
    const findings = await scanAll();
    const jsonld = findingsOfType(findings, "structured_data_issue").filter(
      (f) => f.detail.kind === "parse_error",
    );
    expect(jsonld.map((f) => f.detail.url)).toEqual([`${ORIGIN}/broken-json`]);
  });

  it("flags broken social-card images via the asset check", async () => {
    const crawl = await crawlSite({ origin: ORIGIN, fetchImpl: fakeFetch });
    const { checkAssets } = await import("../crawler");
    const assets = await checkAssets(crawl, fakeFetch);
    const findings = runDetectors({ crawl, sitemapUrls: [], assets });
    const cards = findingsOfType(findings, "social_card_issue");
    expect(cards.map((f) => f.key)).toEqual([`${ORIGIN}/og-image.png`]);
    expect(cards[0].detail.linkedFrom).toEqual([`${ORIGIN}/og`]);
  });

  it("flags sitemap-listed pages five or more clicks deep", async () => {
    const crawl = await crawlSite({ origin: ORIGIN, fetchImpl: fakeFetch });
    // /d5 and /d6 are in the sitemap (declared to matter); /d6-not-listed
    // depth alone doesn't flag pages the sitemap omits.
    const sitemapUrls = [`${ORIGIN}/d4`, `${ORIGIN}/d5`, `${ORIGIN}/d6`];
    const findings = runDetectors({ crawl, sitemapUrls });
    const deep = findingsOfType(findings, "deep_page");
    expect(deep.map((f) => f.detail.url).sort()).toEqual([
      `${ORIGIN}/d5`,
      `${ORIGIN}/d6`,
    ]);
  });

  it("flags dead external links and dead YouTube embeds", async () => {
    const findings = await scanAll();
    const external = findingsOfType(findings, "broken_external_link");
    expect(external.map((f) => f.key)).toEqual(
      expect.arrayContaining([
        "https://dead-external.example.net/page",
        "youtube:deadvideo123",
      ]),
    );
  });

  it("runs site checks: dead feed, sitemap-not-in-robots, future lastmod; no false www/tls/favicon", async () => {
    const findings = await scanAll();
    const kinds = findingsOfType(findings, "site_issue").map(
      (f) => f.detail.kind,
    );
    expect(kinds).toContain("sitemap_not_in_robots");
    expect(kinds).toContain("sitemap_lastmod_future");
    expect(kinds).not.toContain("www_duplicate");
    expect(kinds).not.toContain("tls_expiring");
    expect(kinds).not.toContain("favicon_missing");
    expect(kinds).not.toContain("robots_blocks_all");
    // The fake site sends no security headers and no security.txt, and its
    // probe path correctly 404s.
    expect(kinds).toContain("missing_hsts");
    expect(kinds).toContain("missing_csp");
    expect(kinds).toContain("security_txt_missing");
    expect(kinds).not.toContain("no_404_status");

    const feeds = findingsOfType(findings, "feed_issue");
    expect(feeds.map((f) => f.detail.url)).toEqual([`${ORIGIN}/feed.xml`]);
  });

  it("flags sites that answer 200 for nonexistent URLs and honors security headers", async () => {
    const wildcardFetch = routeFetch(async (url) => {
      if (url.pathname.startsWith("/legible-404-probe-")) {
        return new Response("<html>totally a page</html>", { status: 200 });
      }
      if (url.pathname === "/") {
        return new Response("<html></html>", {
          status: 200,
          headers: {
            "content-type": "text/html",
            "strict-transport-security": "max-age=31536000",
            "x-content-type-options": "nosniff",
            "content-security-policy":
              "default-src 'self'; frame-ancestors 'none'",
            "referrer-policy": "strict-origin-when-cross-origin",
          },
        });
      }
      return fakeFetch(url);
    });
    const crawl = await crawlSite({ origin: ORIGIN, fetchImpl: wildcardFetch });
    const findings = await runSiteChecks({
      origin: ORIGIN,
      crawl,
      sitemapEntries: [],
      fetchImpl: wildcardFetch,
      certExpiry: async () => null,
    });
    const kinds = findingsOfType(findings, "site_issue").map(
      (f) => f.detail.kind,
    );
    expect(kinds).toContain("no_404_status");
    expect(kinds).not.toContain("missing_hsts");
    expect(kinds).not.toContain("missing_nosniff");
    expect(kinds).not.toContain("missing_csp");
    expect(kinds).not.toContain("missing_frame_protection");
    expect(kinds).not.toContain("missing_referrer_policy");
  });

  it("flags robots.txt that blocks everything", async () => {
    const blockingFetch = routeFetch(async (url) => {
      if (url.pathname === "/robots.txt") {
        return new Response("User-agent: *\nDisallow: /", { status: 200 });
      }
      return fakeFetch(url);
    });
    const crawl = await crawlSite({ origin: ORIGIN, fetchImpl: blockingFetch });
    const findings = await runSiteChecks({
      origin: ORIGIN,
      crawl,
      sitemapEntries: [],
      fetchImpl: blockingFetch,
      certExpiry: async () => null,
    });
    expect(
      findingsOfType(findings, "site_issue").filter(
        (f) => f.detail.kind === "robots_blocks_all",
      ),
    ).toHaveLength(1);
  });
});

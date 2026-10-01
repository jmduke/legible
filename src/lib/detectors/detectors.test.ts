import { describe, expect, it } from "vitest";
import { crawlSite } from "../crawler";
import { findingsOfType } from "../findings";
import { routeFetch } from "../testing";
import { runDetectors } from "./index";

/**
 * End-to-end: crawl a fake in-memory site and assert each detector fires.
 *
 * Site map:
 *   /            -> links to /about, /dead, /chain-start
 *   /about       -> links to /
 *   /dead        -> 404 (broken link)
 *   /chain-start -> 301 -> /chain-mid -> 301 -> /chain-end (redirect chain)
 *   /chain-end   -> 200
 *   /orphan      -> 200, in sitemap, linked from nowhere (orphan)
 *   /gone        -> in sitemap, 404 (sitemap mismatch)
 */
const ORIGIN = "https://example.com";

const html = (links: string[]) =>
  `<html><body>${links.map((l) => `<a href="${l}">x</a>`).join("")}</body></html>`;

const routes: Record<
  string,
  { status: number; body?: string; location?: string }
> = {
  "/robots.txt": { status: 404 },
  "/": { status: 200, body: html(["/about", "/dead", "/chain-start"]) },
  "/about": { status: 200, body: html(["/"]) },
  "/dead": { status: 404, body: "not found" },
  "/chain-start": { status: 301, location: "/chain-mid" },
  "/chain-mid": { status: 301, location: "/chain-end" },
  "/chain-end": { status: 200, body: html([]) },
  "/orphan": { status: 200, body: html([]) },
  "/gone": { status: 404, body: "not found" },
};

const fakeFetch = routeFetch(async (url) => {
  const route = routes[url.pathname];
  if (!route) return new Response("not found", { status: 404 });
  const headers: Record<string, string> = { "content-type": "text/html" };
  if (route.location) headers.location = route.location;
  return new Response(route.body ?? null, { status: route.status, headers });
});

describe("crawl + detectors", () => {
  it("finds broken links, redirect chains, orphans, and sitemap mismatches", async () => {
    const sitemapUrls = [
      `${ORIGIN}/`,
      `${ORIGIN}/about`,
      `${ORIGIN}/orphan`,
      `${ORIGIN}/gone`,
    ];
    const crawl = await crawlSite({
      origin: ORIGIN,
      seeds: sitemapUrls,
      fetchImpl: fakeFetch,
    });
    const findings = runDetectors({ crawl, sitemapUrls });
    const byType = {
      broken_internal_link: findingsOfType(findings, "broken_internal_link"),
      redirect_chain: findingsOfType(findings, "redirect_chain"),
      orphan_page: findingsOfType(findings, "orphan_page"),
      sitemap_broken_url: findingsOfType(findings, "sitemap_broken_url"),
    };

    expect(byType.broken_internal_link?.map((f) => f.key)).toEqual([
      `${ORIGIN}/dead`,
    ]);
    expect(byType.broken_internal_link?.[0].detail.linkedFrom).toEqual([
      `${ORIGIN}/`,
    ]);

    expect(byType.redirect_chain?.map((f) => f.key)).toEqual([
      `${ORIGIN}/chain-start`,
    ]);
    expect(byType.redirect_chain?.[0].detail.chain).toEqual([
      `${ORIGIN}/chain-start`,
      `${ORIGIN}/chain-mid`,
      `${ORIGIN}/chain-end`,
    ]);

    expect(byType.orphan_page?.map((f) => f.key)).toEqual([`${ORIGIN}/orphan`]);

    expect(byType.sitemap_broken_url?.map((f) => f.key)).toEqual([
      `${ORIGIN}/gone`,
    ]);
  });

  it("flags not-indexed pages from GSC inspections", async () => {
    const crawl = await crawlSite({ origin: ORIGIN, fetchImpl: fakeFetch });
    const findings = runDetectors({
      crawl,
      sitemapUrls: [],
      inspections: [
        {
          url: `${ORIGIN}/about`,
          verdict: "FAIL",
          coverageState: "Discovered - currently not indexed",
        },
        { url: `${ORIGIN}/`, verdict: "PASS", coverageState: "Indexed" },
      ],
    });
    expect(findingsOfType(findings, "not_indexed").map((f) => f.key)).toEqual([
      `${ORIGIN}/about`,
    ]);
  });

  it("respects robots.txt disallows", async () => {
    const robotsFetch = routeFetch(async (url) => {
      if (url.pathname === "/robots.txt") {
        return new Response("User-agent: *\nDisallow: /dead", { status: 200 });
      }
      return fakeFetch(url);
    });

    const crawl = await crawlSite({ origin: ORIGIN, fetchImpl: robotsFetch });
    const findings = runDetectors({ crawl, sitemapUrls: [] });
    expect(findingsOfType(findings, "broken_internal_link")).toEqual([]);
    expect(crawl.pages.get(`${ORIGIN}/dead`)?.blockedByRobots).toBe(true);
  });

  it("skips orphan detection when the crawl budget was exhausted", async () => {
    const sitemapUrls = [`${ORIGIN}/orphan`];
    const crawl = await crawlSite({
      origin: ORIGIN,
      seeds: sitemapUrls,
      maxPages: 2,
      fetchImpl: fakeFetch,
    });
    expect(crawl.budgetExhausted).toBe(true);
    const findings = runDetectors({ crawl, sitemapUrls });
    expect(findingsOfType(findings, "orphan_page")).toEqual([]);
  });

  it("status-checks but does not recurse into no-follow paths", async () => {
    const nfFetch = routeFetch(async (url) => {
      if (url.pathname === "/") {
        return new Response(html(["/archive/post"]), {
          status: 200,
          headers: { "content-type": "text/html" },
        });
      }
      if (url.pathname === "/archive/post") {
        return new Response(html(["/archive/dead-deeper-link"]), {
          status: 200,
          headers: { "content-type": "text/html" },
        });
      }
      return fakeFetch(url);
    });

    const crawl = await crawlSite({
      origin: ORIGIN,
      noFollowPatterns: [/^\/archive\//],
      fetchImpl: nfFetch,
    });
    // The linked archive page itself was fetched and verified...
    expect(crawl.pages.get(`${ORIGIN}/archive/post`)?.status).toBe(200);
    // ...but its own outbound links were never enqueued.
    expect(crawl.pages.has(`${ORIGIN}/archive/dead-deeper-link`)).toBe(false);
  });

  it("flags pages missing from the sitemap only when live, linked, and indexable", async () => {
    // Sitemap only lists the homepage; /about is linked and indexable so it
    // should be flagged. /dead (404) and /chain-start (redirects) should not.
    const sitemapUrls = [`${ORIGIN}/`];
    const crawl = await crawlSite({
      origin: ORIGIN,
      seeds: sitemapUrls,
      fetchImpl: fakeFetch,
    });
    const findings = runDetectors({ crawl, sitemapUrls });
    expect(
      findingsOfType(findings, "missing_from_sitemap").map((f) => f.key),
    ).toEqual([`${ORIGIN}/about`]);
  });

  it("emits nothing for missing_from_sitemap when the site has no sitemap", async () => {
    const crawl = await crawlSite({ origin: ORIGIN, fetchImpl: fakeFetch });
    const findings = runDetectors({ crawl, sitemapUrls: [] });
    expect(findingsOfType(findings, "missing_from_sitemap")).toEqual([]);
  });

  it("ignores infrastructure paths like Cloudflare's email-protection", async () => {
    const cfFetch = routeFetch(async (url) => {
      if (url.pathname === "/") {
        return new Response(html(["/cdn-cgi/l/email-protection", "/dead"]), {
          status: 200,
          headers: { "content-type": "text/html" },
        });
      }
      return fakeFetch(url);
    });

    const crawl = await crawlSite({ origin: ORIGIN, fetchImpl: cfFetch });
    const findings = runDetectors({ crawl, sitemapUrls: [] });
    expect(
      findingsOfType(findings, "broken_internal_link").map((f) => f.key),
    ).toEqual([`${ORIGIN}/dead`]);
  });
});

import { describe, expect, it } from "vitest";
import {
  type CrawlResult,
  checkAssets,
  crawlSite,
  type PageRecord,
} from "../crawler";
import { findingsOfType } from "../findings";
import { routeFetch } from "../testing";
import { runDetectors } from "./index";
import { SLOW_PAGE_MS } from "./slow-pages";

/**
 * Tranche-2 detectors: images (alt/broken/oversized), mixed content,
 * hreflang reciprocity, slow pages.
 */
const ORIGIN = "https://example.com";

const routes: Record<
  string,
  { body?: string; status?: number; headers?: Record<string, string> }
> = {
  "/": {
    body: `<html lang="en"><head><title>Home</title><meta name="description" content="d"></head><body><h1>h</h1>
      <img src="/img/ok.png" alt="fine">
      <img src="/img/no-alt.png">
      <img src="/img/dead.png" alt="dead">
      <img src="/img/huge.jpg" alt="huge">
      <img src="/img/decorative.png" alt="">
      <script src="http://legacy.example.com/analytics.js"></script>
      <a href="/en">en</a></body></html>`,
  },
  "/en": {
    body: `<html lang="en"><head><title>En</title><meta name="description" content="d">
      <link rel="alternate" hreflang="fr" href="/fr">
      </head><body><h1>h</h1><a href="/fr">fr</a></body></html>`,
  },
  // /fr has hreflang annotations but none pointing back at /en.
  "/fr": {
    body: `<html lang="fr"><head><title>Fr</title><meta name="description" content="d">
      <link rel="alternate" hreflang="de" href="/de">
      </head><body><h1>h</h1></body></html>`,
  },
  "/img/ok.png": {
    headers: { "content-type": "image/png", "content-length": "1000" },
  },
  "/img/no-alt.png": {
    headers: { "content-type": "image/png", "content-length": "1000" },
  },
  "/img/huge.jpg": {
    headers: { "content-type": "image/jpeg", "content-length": "900000" },
  },
  "/img/dead.png": { status: 404 },
  "/img/decorative.png": {
    headers: { "content-type": "image/png", "content-length": "500" },
  },
};

const fakeFetch = routeFetch(async (url) => {
  const route = routes[url.pathname];
  if (!route) return new Response("not found", { status: 404 });
  return new Response(route.body ?? "x", {
    status: route.status ?? 200,
    headers: { "content-type": "text/html", ...route.headers },
  });
});

async function scan() {
  const crawl = await crawlSite({ origin: ORIGIN, fetchImpl: fakeFetch });
  const assets = await checkAssets(crawl, fakeFetch);
  return runDetectors({ crawl, sitemapUrls: [], assets });
}

describe("image issues", () => {
  it("flags images with an absent alt attribute, not alt=''", async () => {
    const findings = await scan();
    const altFindings = findingsOfType(findings, "image_issue").filter(
      (f) => f.detail.kind === "missing_alt",
    );
    expect(altFindings).toHaveLength(1);
    expect(altFindings[0].detail.url).toBe(`${ORIGIN}/`);
    expect(altFindings[0].detail.images).toEqual([`${ORIGIN}/img/no-alt.png`]);
  });

  it("flags broken and oversized images from the asset check", async () => {
    const findings = await scan();
    const broken = findingsOfType(findings, "image_issue").filter(
      (f) => f.detail.kind === "broken_image",
    );
    expect(broken.map((f) => f.detail.url)).toEqual([`${ORIGIN}/img/dead.png`]);
    expect(broken[0].detail.linkedFrom).toEqual([`${ORIGIN}/`]);

    const oversized = findingsOfType(findings, "image_issue").filter(
      (f) => f.detail.kind === "oversized_image",
    );
    expect(oversized.map((f) => f.detail.url)).toEqual([
      `${ORIGIN}/img/huge.jpg`,
    ]);
  });
});

describe("mixed content", () => {
  it("flags http resources on https pages", async () => {
    const findings = await scan();
    const mixed = findingsOfType(findings, "mixed_content");
    expect(mixed.map((f) => f.detail.resource)).toEqual([
      "http://legacy.example.com/analytics.js",
    ]);
    expect(mixed[0].detail.linkedFrom).toEqual([`${ORIGIN}/`]);
  });
});

describe("hreflang reciprocity", () => {
  it("flags one-way hreflang pairs between crawled pages", async () => {
    const findings = await scan();
    const issues = findingsOfType(findings, "hreflang_issue");
    expect(issues).toHaveLength(1);
    expect(issues[0].detail.page).toBe(`${ORIGIN}/en`);
    expect(issues[0].detail.declares).toBe(`${ORIGIN}/fr`);
  });
});

describe("slow pages", () => {
  it("flags pages over the TTFB threshold from crawl data", () => {
    const page = (url: string, ttfbMs: number): PageRecord => ({
      url,
      status: 200,
      finalUrl: url,
      redirectHops: [],
      contentType: "text/html",
      internalLinks: [],
      referrers: [],
      ttfbMs,
    });
    const crawl: CrawlResult = {
      origin: ORIGIN,
      pages: new Map([
        [`${ORIGIN}/fast`, page(`${ORIGIN}/fast`, 120)],
        [`${ORIGIN}/slow`, page(`${ORIGIN}/slow`, SLOW_PAGE_MS + 500)],
      ]),
      pagesCrawled: 2,
      budgetExhausted: false,
    };
    const findings = runDetectors({ crawl, sitemapUrls: [] });
    const slow = findingsOfType(findings, "slow_page");
    expect(slow.map((f) => f.key)).toEqual([`${ORIGIN}/slow`]);
  });
});

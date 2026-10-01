import { describe, expect, it } from "vitest";
import { crawlSite } from "../crawler";
import { findingsOfType } from "../findings";
import { routeFetch } from "../testing";
import { runDetectors } from "./index";

/**
 * Head-tag detectors: meta_tag_issue (per-page defects), duplicate_meta
 * (site-wide), and noindexed-URL-in-sitemap.
 */
const ORIGIN = "https://example.com";

interface FakePage {
  head?: string;
  body?: string;
  lang?: string;
}

function render({ head = "", body = "", lang }: FakePage): string {
  const langAttr = lang ? ` lang="${lang}"` : "";
  // Skeleton is standards-clean (doctype/charset/viewport) so tests exercise
  // one defect at a time.
  return `<!doctype html><html${langAttr}><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">${head}</head><body>${body}</body></html>`;
}

const CLEAN_HEAD =
  '<title>Clean page</title><meta name="description" content="A fine page.">' +
  '<meta name="theme-color" content="#000"><meta name="color-scheme" content="light">' +
  '<meta property="og:title" content="Clean page"><meta property="og:description" content="A fine page.">' +
  '<meta property="og:url" content="https://example.com/clean"><meta property="og:type" content="website">' +
  '<meta property="og:image" content="https://example.com/og.png">' +
  '<meta name="twitter:card" content="summary">' +
  '<link rel="canonical" href="https://example.com/clean">';

const routes: Record<string, FakePage> = {
  "/": {
    lang: "en",
    head:
      '<title>Home</title><meta name="description" content="Welcome.">' +
      '<meta name="theme-color" content="#000"><meta name="color-scheme" content="light">' +
      '<meta property="og:title" content="Home"><meta property="og:description" content="Welcome.">' +
      '<meta property="og:url" content="https://example.com/"><meta property="og:type" content="website">' +
      '<meta property="og:image" content="https://example.com/og.png">',
    body: '<h1>Home</h1><a href="/bare">x</a><a href="/doubled">x</a><a href="/twin-a">x</a><a href="/twin-b">x</a><a href="/hidden">x</a><a href="/clean">x</a><a href="/skippy">x</a>',
  },
  // No title, no description, no h1, no lang.
  "/bare": { body: "<p>nothing here</p>" },
  // Two titles, two h1s.
  "/doubled": {
    lang: "en",
    head:
      '<title>One</title><title>Two</title><meta name="description" content="d">' +
      '<meta name="theme-color" content="#000"><meta name="color-scheme" content="light">' +
      '<meta property="og:title" content="One"><meta property="og:description" content="d">' +
      '<meta property="og:url" content="https://example.com/doubled"><meta property="og:type" content="website">' +
      '<meta property="og:image" content="https://example.com/og.png">' +
      '<meta name="twitter:card" content="summary">' +
      '<link rel="canonical" href="https://example.com/doubled">',
    body: "<h1>a</h1><h1>b</h1>",
  },
  // Identical title + description across two pages.
  "/twin-a": {
    lang: "en",
    head:
      '<title>Twin</title><meta name="description" content="Same words.">' +
      '<meta name="theme-color" content="#000"><meta name="color-scheme" content="light">' +
      '<meta property="og:title" content="Twin"><meta property="og:description" content="Same words.">' +
      '<meta property="og:url" content="https://example.com/twin-a"><meta property="og:type" content="website">' +
      '<meta property="og:image" content="https://example.com/og.png">',
    body: "<h1>a</h1>",
  },
  "/twin-b": {
    lang: "en",
    head:
      '<title>Twin</title><meta name="description" content="Same words.">' +
      '<meta name="theme-color" content="#000"><meta name="color-scheme" content="light">' +
      '<meta property="og:title" content="Twin"><meta property="og:description" content="Same words.">' +
      '<meta property="og:url" content="https://example.com/twin-b"><meta property="og:type" content="website">' +
      '<meta property="og:image" content="https://example.com/og.png">',
    body: "<h1>b</h1>",
  },
  // Noindexed: excluded from meta checks, but flagged if the sitemap lists it.
  "/hidden": {
    lang: "en",
    head: `<meta name="robots" content="noindex">${CLEAN_HEAD}`,
    body: "<h1>hi</h1>",
  },
  "/clean": {
    lang: "en",
    head: CLEAN_HEAD,
    body: "<h1>Clean</h1>",
  },
  // h1 jumps straight to h3.
  "/skippy": {
    lang: "en",
    head:
      '<title>Skippy</title><meta name="description" content="Heading skips.">' +
      '<meta name="theme-color" content="#000"><meta name="color-scheme" content="light">' +
      '<meta property="og:title" content="Skippy"><meta property="og:description" content="Heading skips.">' +
      '<meta property="og:url" content="https://example.com/skippy"><meta property="og:type" content="website">' +
      '<meta property="og:image" content="https://example.com/og.png">',
    body: "<h1>Top</h1><h3>Skipped</h3>",
  },
};

const fakeFetch = routeFetch(async (url) => {
  const page = routes[url.pathname];
  if (!page) return new Response("not found", { status: 404 });
  return new Response(render(page), {
    status: 200,
    headers: { "content-type": "text/html" },
  });
});

async function findingsFor(sitemapUrls: string[] = []) {
  const crawl = await crawlSite({ origin: ORIGIN, fetchImpl: fakeFetch });
  return runDetectors({ crawl, sitemapUrls });
}

describe("meta-tags detector", () => {
  it("flags missing title/description/h1/lang on a bare page", async () => {
    const findings = await findingsFor();
    const kinds = findingsOfType(findings, "meta_tag_issue")
      .filter((f) => f.detail.url === `${ORIGIN}/bare`)
      .map((f) => f.detail.kind)
      .sort();
    expect(kinds).toEqual([
      "missing_canonical",
      "missing_color_scheme",
      "missing_description",
      "missing_h1",
      "missing_lang",
      "missing_og_description",
      "missing_og_image",
      "missing_og_title",
      "missing_og_type",
      "missing_og_url",
      "missing_theme_color",
      "missing_title",
    ]);
  });

  it("flags duplicated tags within a page", async () => {
    const findings = await findingsFor();
    const kinds = findingsOfType(findings, "meta_tag_issue")
      .filter((f) => f.detail.url === `${ORIGIN}/doubled`)
      .map((f) => f.detail.kind)
      .sort();
    expect(kinds).toEqual(["multiple_h1s", "multiple_titles"]);
  });

  it("flags heading-level skips", async () => {
    const findings = await findingsFor();
    const skips = findingsOfType(findings, "meta_tag_issue").filter(
      (f) => f.detail.kind === "heading_skip",
    );
    expect(skips.map((f) => f.detail.url)).toEqual([`${ORIGIN}/skippy`]);
    expect(skips[0].detail.skip).toBe("h1 → h3");
  });

  it("leaves clean and noindexed pages alone", async () => {
    const findings = await findingsFor();
    const urls = findingsOfType(findings, "meta_tag_issue").map((f) =>
      String(f.detail.url),
    );
    expect(urls).not.toContain(`${ORIGIN}/clean`);
    expect(urls).not.toContain(`${ORIGIN}/hidden`);
  });
});

describe("duplicate-meta detector", () => {
  it("groups pages sharing a title and description", async () => {
    const findings = await findingsFor();
    const dupes = findingsOfType(findings, "duplicate_meta");
    expect(dupes).toHaveLength(2); // one for title, one for description
    for (const dupe of dupes) {
      expect(dupe.detail.pageCount).toBe(2);
      expect(dupe.detail.pages).toEqual(["/twin-a", "/twin-b"]);
    }
  });
});

describe("noindex in sitemap", () => {
  it("flags sitemap entries that are noindexed", async () => {
    const findings = await findingsFor([`${ORIGIN}/hidden`, `${ORIGIN}/clean`]);
    const flagged = findingsOfType(findings, "sitemap_broken_url").filter(
      (f) => f.detail.problem === "noindex",
    );
    expect(flagged.map((f) => f.key)).toEqual([`${ORIGIN}/hidden`]);
  });
});

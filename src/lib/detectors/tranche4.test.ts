import { describe, expect, it } from "vitest";
import { crawlSite } from "../crawler";
import { checkAssets } from "../crawler/assets";
import { findingsOfType } from "../findings";
import { runSiteChecks } from "../sitechecks";
import { routeFetch } from "../testing";
import { runDetectors } from "./index";

const ORIGIN = "https://example.com";

const ogHead =
  '<meta property="og:title" content="T"><meta property="og:description" content="D">' +
  '<meta property="og:url" content="https://example.com/page"><meta property="og:type" content="website">' +
  '<meta property="og:image" content="https://example.com/og.png">' +
  '<meta name="theme-color" content="#000"><meta name="color-scheme" content="light">';

const page = (head: string, body: string) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">${head}</head><body>${body}</body></html>`;

const routes: Record<
  string,
  { body?: string; status?: number; headers?: Record<string, string> }
> = {
  "/robots.txt": { status: 200, body: "User-agent: *\nDisallow:" },
  "/llms.txt": { status: 200, body: "# docs" },
  "/.well-known/mcp/server-card.json": { status: 404 },
  "/.well-known/agent-skills/index.json": { status: 404 },
  "/privacy": { status: 404 },
  "/assets/app.a1b2c3d4e5f67890.js": {
    status: 200,
    body: "js",
    headers: { "cache-control": "no-cache" },
  },
  "/": {
    body: page(
      `<title>Home</title><meta name="description" content="Welcome home page title">${ogHead}`,
      `<h1>Home</h1>
       <a href="/mid">mid</a>
       <a href="/meta-bad">meta</a>
       <a href="/lazy">lazy</a>
       <a href="/privacy">Privacy</a>`,
    ),
  },
  "/mid": {
    body: page(
      `<title>Mid</title><meta name="description" content="Mid"><link rel="canonical" href="/mid">${ogHead}`,
      `<h1>Mid</h1><a href="/deep">deep</a>`,
    ),
  },
  "/deep": {
    body: page(
      `<title>Deep</title><meta name="description" content="Deep page"><link rel="canonical" href="/deep">${ogHead}`,
      `<h1>Deep</h1><p>content</p>`,
    ),
  },
  "/meta-bad": {
    body: page(
      `<title>This title is way too long for Google search results snippets and will get truncated badly</title>
       <meta name="description" content="D">
       <meta property="og:url" content="/relative">
       <meta property="og:image" content="/rel.png">
       <meta property="og:title" content="T"><meta property="og:description" content="D"><meta property="og:type" content="website">`,
      `<h1>Bad meta</h1>`,
    ),
  },
  "/lazy": {
    body: page(
      `<title>Lazy</title><meta name="description" content="D">${ogHead}`,
      `<h1>Lazy</h1><img loading="lazy" src="/hero.png">
       <script src="/assets/app.a1b2c3d4e5f67890.js"></script>`,
    ),
  },
  "/hero.png": { status: 200, body: "png" },
};

const fakeFetch = routeFetch(async (url) => {
  if (url.protocol === "http:" && url.hostname === "example.com") {
    return new Response(null, {
      status: 200,
      headers: { "content-type": "text/html" },
    });
  }
  const route = routes[url.pathname];
  if (!route) return new Response("not found", { status: 404 });
  return new Response(route.body ?? "", {
    status: route.status ?? 200,
    headers: {
      "content-type": "text/html",
      ...(route.headers ?? {}),
    },
  });
});

async function scanAll() {
  const crawl = await crawlSite({ origin: ORIGIN, fetchImpl: fakeFetch });
  const assets = await checkAssets(crawl, fakeFetch);
  const detectorFindings = runDetectors({
    crawl,
    sitemapUrls: [`${ORIGIN}/deep`],
    assets,
  });
  const siteFindings = await runSiteChecks({
    origin: ORIGIN,
    crawl,
    sitemapEntries: [],
    fetchImpl: fakeFetch,
    certExpiry: async () => null,
  });
  return [...detectorFindings, ...siteFindings];
}

describe("tranche-4 specification.website checks", () => {
  it("flags missing canonical, long titles, relative OG, and breadcrumbs", async () => {
    const findings = await scanAll();
    expect(
      findingsOfType(findings, "meta_tag_issue").some(
        (f) =>
          f.detail.url === `${ORIGIN}/meta-bad` &&
          f.detail.kind === "title_too_long",
      ),
    ).toBe(true);
    expect(
      findingsOfType(findings, "meta_tag_issue").some(
        (f) =>
          f.detail.url === `${ORIGIN}/meta-bad` &&
          f.detail.kind === "relative_og_url",
      ),
    ).toBe(true);
    expect(
      findingsOfType(findings, "structured_data_issue").some(
        (f) =>
          f.detail.url === `${ORIGIN}/deep` &&
          f.detail.kind === "missing_breadcrumbs",
      ),
    ).toBe(true);
  });

  it("flags lazy-loaded first image", async () => {
    const findings = await scanAll();
    expect(
      findingsOfType(findings, "image_issue").some(
        (f) => f.detail.kind === "lazy_lcp_candidate",
      ),
    ).toBe(true);
  });

  it("flags weak cache policy on fingerprinted assets", async () => {
    const crawl = await crawlSite({ origin: ORIGIN, fetchImpl: fakeFetch });
    const assets = await checkAssets(crawl, fakeFetch);
    const findings = runDetectors({
      crawl,
      sitemapUrls: [],
      assets,
    });
    expect(
      findingsOfType(findings, "image_issue").some(
        (f) => f.detail.kind === "poor_cache_policy",
      ),
    ).toBe(true);
  });

  it("runs extended site checks", async () => {
    const findings = await scanAll();
    const kinds = findingsOfType(findings, "site_issue").map(
      (f) => f.detail.kind,
    );
    expect(kinds).toContain("no_ai_crawler_policy");
    expect(kinds).toContain("no_http_redirect");
    expect(kinds).toContain("llms_not_in_link_header");
    expect(kinds).toContain("missing_agent_discovery");
    expect(kinds).toContain("privacy_policy_dead");
  });
});

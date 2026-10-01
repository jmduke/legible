import { describe, expect, it } from "vitest";
import { crawlSite } from "../crawler";
import { findingsOfType } from "../findings";
import { runSiteChecks } from "../sitechecks";
import { routeFetch } from "../testing";
import { runDetectors } from "./index";

/**
 * Detectors derived from specification.website gaps — Open Graph completeness,
 * accessibility heuristics, SRI, and extended site checks.
 */
const ORIGIN = "https://example.com";

const page = (head: string, body: string) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">${head}</head><body>${body}</body></html>`;

const routes: Record<
  string,
  { body?: string; status?: number; headers?: Record<string, string> }
> = {
  "/robots.txt": { status: 200, body: "User-agent: *\nDisallow:" },
  "/llms.txt": { status: 404 },
  "/": {
    body: page(
      '<title>Home</title><meta name="description" content="Welcome.">',
      `<h1>Home</h1>
       <a href="/bare-og">bare og</a>
       <a href="/a11y-bad">a11y</a>
       <a href="/sri-bad">sri</a>
       <a href="/clean">clean</a>`,
    ),
  },
  "/bare-og": {
    body: page(
      '<title>Bare OG</title><meta name="description" content="No social tags.">',
      "<h1>Bare</h1>",
    ),
  },
  "/a11y-bad": {
    body: page(
      `<title>A11y bad</title><meta name="description" content="d">
       <meta property="og:title" content="t"><meta property="og:description" content="d">
       <meta property="og:url" content="${ORIGIN}/a11y-bad"><meta property="og:type" content="website">
       <meta property="og:image" content="${ORIGIN}/og.png">`,
      `<nav><a href="/">home</a></nav>
       <a href="/docs">click here</a>
       <a href="/docs"><img src="/icon.png" alt=""></a>
       <input type="email" name="email">
       <h1>Page</h1>`,
    ),
  },
  "/sri-bad": {
    body: page(
      `<title>SRI bad</title><meta name="description" content="d">
       <meta property="og:title" content="t"><meta property="og:description" content="d">
       <meta property="og:url" content="${ORIGIN}/sri-bad"><meta property="og:type" content="website">
       <meta property="og:image" content="${ORIGIN}/og.png">`,
      `<h1>SRI</h1><script src="https://cdn.example.net/lib.js"></script>`,
    ),
  },
  "/clean": {
    body: page(
      `<title>Clean</title><meta name="description" content="All good.">
       <meta name="theme-color" content="#111"><meta name="color-scheme" content="light dark">
       <meta property="og:title" content="Clean"><meta property="og:description" content="All good.">
       <meta property="og:url" content="${ORIGIN}/clean"><meta property="og:type" content="website">
       <meta property="og:image" content="${ORIGIN}/og.png">
       <meta name="twitter:card" content="summary_large_image">
       <link rel="canonical" href="${ORIGIN}/clean">`,
      `<a href="#main-content">Skip to main content</a>
       <main id="main-content"><h1>Clean</h1><label>Email <input type="email" id="e"></label></main>`,
    ),
  },
  "/docs": { body: page("<title>Docs</title>", "<h1>Docs</h1>") },
  "/og.png": { status: 200, body: "png" },
  "/icon.png": { status: 200, body: "png" },
};

const fakeFetch = routeFetch(async (url) => {
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
  const detectorFindings = runDetectors({ crawl, sitemapUrls: [] });
  const siteFindings = await runSiteChecks({
    origin: ORIGIN,
    crawl,
    sitemapEntries: [],
    fetchImpl: fakeFetch,
    certExpiry: async () => null,
  });
  return [...detectorFindings, ...siteFindings];
}

describe("specification.website gap detectors", () => {
  it("flags missing Open Graph tags", async () => {
    const findings = await scanAll();
    const ogKinds = findingsOfType(findings, "meta_tag_issue")
      .filter((f) => f.detail.url === `${ORIGIN}/bare-og`)
      .map((f) => f.detail.kind)
      .sort();
    expect(ogKinds).toEqual([
      "missing_canonical",
      "missing_color_scheme",
      "missing_og_description",
      "missing_og_image",
      "missing_og_title",
      "missing_og_type",
      "missing_og_url",
      "missing_theme_color",
    ]);
  });

  it("flags accessibility defects", async () => {
    const findings = await scanAll();
    const kinds = findingsOfType(findings, "accessibility_issue")
      .filter((f) => f.detail.url === `${ORIGIN}/a11y-bad`)
      .map((f) => f.detail.kind)
      .sort();
    expect(kinds).toEqual([
      "empty_links",
      "generic_link_text",
      "link_image_empty_alt",
      "missing_main_landmark",
      "missing_skip_link",
      "unlabeled_inputs",
    ]);
  });

  it("flags external resources without SRI", async () => {
    const findings = await scanAll();
    const sri = findingsOfType(findings, "security_issue");
    expect(sri.map((f) => f.detail.url)).toEqual([`${ORIGIN}/sri-bad`]);
    expect(sri[0].detail.kind).toBe("missing_sri");
  });

  it("leaves a fully-tagged clean page alone", async () => {
    const findings = await scanAll();
    const urls = [
      ...findingsOfType(findings, "meta_tag_issue"),
      ...findingsOfType(findings, "accessibility_issue"),
      ...findingsOfType(findings, "security_issue"),
    ].map((f) => String(f.detail.url));
    expect(urls).not.toContain(`${ORIGIN}/clean`);
  });

  it("runs extended site checks", async () => {
    const findings = await scanAll();
    const kinds = findingsOfType(findings, "site_issue").map(
      (f) => f.detail.kind,
    );
    expect(kinds).toContain("llms_txt_missing");
    expect(kinds).toContain("apple_touch_icon_missing");
    expect(kinds).toContain("missing_permissions_policy");
    expect(kinds).toContain("missing_compression");
  });
});

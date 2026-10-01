import * as tls from "node:tls";
import * as cheerio from "cheerio";
import type { CrawlResult } from "./crawler";
import { FETCH_TIMEOUT_MS, USER_AGENT } from "./crawler/constants";
import type { RawFinding } from "./findings";
import type { SitemapEntry } from "./sitemap";

const TLS_EXPIRY_WARN_DAYS = 21;
const MAX_FEEDS_CHECKED = 10;
const SITEMAP_URL_LIMIT = 50_000;

/** Major AI crawlers named in specification.website agent-readiness docs. */
const AI_CRAWLER_AGENTS = [
  "GPTBot",
  "ClaudeBot",
  "Google-Extended",
  "Bytespider",
  "CCBot",
  "anthropic-ai",
  "ChatGPT-User",
];

export interface SiteCheckOptions {
  origin: string;
  crawl: CrawlResult;
  sitemapEntries: SitemapEntry[];
  fetchImpl?: typeof fetch;
  /** Injectable for tests; defaults to a real TLS peek. */
  certExpiry?: (host: string) => Promise<Date | null>;
}

/**
 * Site-level (once-per-scan) checks that don't fit the per-page detector
 * shape: robots.txt sanity, favicon presence, www/bare-domain duplication,
 * TLS expiry, sitemap lastmod sanity, and advertised-feed health.
 * These perform their own IO, so they live outside the pure detector layer.
 */
export async function runSiteChecks(
  options: SiteCheckOptions,
): Promise<RawFinding[]> {
  const {
    origin,
    crawl,
    sitemapEntries,
    fetchImpl = fetch,
    certExpiry = realCertExpiry,
  } = options;
  const findings: RawFinding[] = [];
  const get = (url: string) =>
    fetchImpl(url, {
      headers: { "user-agent": USER_AGENT },
      redirect: "manual",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

  // --- robots.txt sanity ----------------------------------------------------
  let robotsBody: string | null = null;
  try {
    const res = await get(new URL("/robots.txt", origin).toString());
    if (res.ok) robotsBody = await res.text();
    else await res.body?.cancel();
  } catch {
    /* unreachable robots.txt is not itself a finding */
  }
  if (robotsBody) {
    if (robotsBlocksEverything(robotsBody)) {
      findings.push({
        type: "site_issue",
        key: `${origin} robots_blocks_all`,
        title: "robots.txt blocks all crawling (Disallow: /)",
        detail: {
          kind: "robots_blocks_all",
          url: new URL("/robots.txt", origin).toString(),
          note: "Every search engine is told to ignore the entire site.",
        },
      });
    }
    if (sitemapEntries.length > 0 && !/^\s*sitemap\s*:/im.test(robotsBody)) {
      findings.push({
        type: "site_issue",
        key: `${origin} sitemap_not_in_robots`,
        title: "robots.txt doesn't declare the sitemap",
        detail: {
          kind: "sitemap_not_in_robots",
          url: new URL("/robots.txt", origin).toString(),
          suggestion: `Add "Sitemap: ${new URL("/sitemap.xml", origin).toString()}" to robots.txt.`,
        },
      });
    }
    if (
      !robotsBlocksEverything(robotsBody) &&
      !robotsMentionsAiCrawlers(robotsBody)
    ) {
      findings.push({
        type: "site_issue",
        key: `${origin} no_ai_crawler_policy`,
        title: "robots.txt has no explicit rules for AI crawlers",
        detail: {
          kind: "no_ai_crawler_policy",
          url: new URL("/robots.txt", origin).toString(),
          suggestion:
            "Add User-agent blocks for GPTBot, ClaudeBot, Google-Extended, etc. so your AI crawling policy is explicit.",
        },
      });
    }
  }

  if (sitemapEntries.length >= SITEMAP_URL_LIMIT) {
    findings.push({
      type: "site_issue",
      key: `${origin} sitemap_too_large`,
      title: `Sitemap lists ${sitemapEntries.length} URLs (≥${SITEMAP_URL_LIMIT}) without an index`,
      detail: {
        kind: "sitemap_too_large",
        url: new URL("/sitemap.xml", origin).toString(),
        count: sitemapEntries.length,
        suggestion:
          "Split into a sitemap index with child sitemaps — crawlers cap single sitemaps at 50,000 URLs.",
      },
    });
  }

  // --- security response headers (checked on the homepage response) --------
  let homeHeaders: Headers | null = null;
  let llmsTxtExists = false;
  try {
    const res = await fetchImpl(new URL("/", origin).toString(), {
      headers: { "user-agent": USER_AGENT },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    homeHeaders = res.headers;
    await res.body?.cancel();
    const csp =
      res.headers.get("content-security-policy") ??
      res.headers.get("content-security-policy-report-only") ??
      "";
    const headerChecks: Array<{
      kind: string;
      missing: boolean;
      title: string;
      suggestion: string;
    }> = [
      {
        kind: "missing_hsts",
        missing: !res.headers.get("strict-transport-security"),
        title: "No Strict-Transport-Security (HSTS) header",
        suggestion:
          "Send `Strict-Transport-Security: max-age=31536000; includeSubDomains` so browsers never downgrade to http.",
      },
      {
        kind: "missing_nosniff",
        missing:
          res.headers.get("x-content-type-options")?.toLowerCase() !==
          "nosniff",
        title: "No X-Content-Type-Options: nosniff header",
        suggestion:
          "Send `X-Content-Type-Options: nosniff` to prevent MIME-sniffing attacks.",
      },
      {
        kind: "missing_csp",
        missing:
          !res.headers.get("content-security-policy") &&
          !res.headers.get("content-security-policy-report-only"),
        title: "No Content-Security-Policy header",
        suggestion:
          "Deploy a CSP (start with report-only) to restrict where scripts, styles, and frames can load from.",
      },
      {
        kind: "missing_frame_protection",
        missing:
          !res.headers.get("x-frame-options") &&
          !(res.headers.get("content-security-policy") ?? "").includes(
            "frame-ancestors",
          ),
        title: "No clickjacking protection (X-Frame-Options / frame-ancestors)",
        suggestion:
          "Send `X-Frame-Options: DENY` or a CSP `frame-ancestors` directive so other sites can't frame yours.",
      },
      {
        kind: "missing_referrer_policy",
        missing: !res.headers.get("referrer-policy"),
        title: "No Referrer-Policy header",
        suggestion:
          "Send `Referrer-Policy: strict-origin-when-cross-origin` to stop leaking full URLs to other sites.",
      },
      {
        kind: "missing_permissions_policy",
        missing:
          !res.headers.get("permissions-policy") &&
          !res.headers.get("feature-policy"),
        title: "No Permissions-Policy header",
        suggestion:
          "Send a Permissions-Policy header to disable powerful features (camera, microphone, geolocation) your pages don't use.",
      },
      {
        kind: "missing_compression",
        missing: !hasTextCompression(res.headers.get("content-encoding")),
        title: "Homepage response is not compressed",
        suggestion:
          "Enable gzip or brotli compression for HTML responses — text compresses well and cuts transfer size.",
      },
    ];
    for (const check of headerChecks) {
      if (!check.missing) continue;
      findings.push({
        type: "site_issue",
        key: `${origin} ${check.kind}`,
        title: check.title,
        detail: { kind: check.kind, url: origin, suggestion: check.suggestion },
      });
    }
    if (
      csp &&
      (csp.includes("'unsafe-inline'") || csp.includes("'unsafe-eval'"))
    ) {
      findings.push({
        type: "site_issue",
        key: `${origin} csp_unsafe_directives`,
        title: "Content-Security-Policy allows unsafe-inline or unsafe-eval",
        detail: {
          kind: "csp_unsafe_directives",
          url: origin,
          suggestion:
            "Tighten CSP by removing 'unsafe-inline' and 'unsafe-eval' — they largely defeat XSS protection.",
        },
      });
    }
    if (csp && !res.headers.get("reporting-endpoints")) {
      findings.push({
        type: "site_issue",
        key: `${origin} missing_reporting_endpoints`,
        title: "CSP present but no Reporting-Endpoints header",
        detail: {
          kind: "missing_reporting_endpoints",
          url: origin,
          suggestion:
            "Add a Reporting-Endpoints header pointing at a collector so CSP violations surface in production.",
        },
      });
    }
  } catch {
    /* homepage unreachable — the crawl already reflects that */
  }

  // --- HTTP → HTTPS redirect ------------------------------------------------
  if (origin.startsWith("https://")) {
    try {
      const httpHome = `${origin.replace(/^https:/, "http:")}/`;
      const res = await get(httpHome);
      await res.body?.cancel();
      if (res.status !== 301 && res.status !== 308) {
        findings.push({
          type: "site_issue",
          key: `${origin} no_http_redirect`,
          title: "Plain HTTP does not redirect to HTTPS",
          detail: {
            kind: "no_http_redirect",
            url: httpHome,
            note: `HTTP homepage returned ${res.status}; browsers may hit an insecure copy first.`,
            suggestion:
              "Redirect all http:// traffic to https:// with a 301 or 308 at the edge.",
          },
        });
      }
    } catch {
      /* http unreachable is fine */
    }
  }

  // --- llms.txt (agent readiness) -------------------------------------------
  try {
    const res = await get(new URL("/llms.txt", origin).toString());
    await res.body?.cancel();
    if (res.ok) llmsTxtExists = true;
    if (res.status === 404) {
      findings.push({
        type: "site_issue",
        key: `${origin} llms_txt_missing`,
        title: "No /llms.txt for agent discovery",
        detail: {
          kind: "llms_txt_missing",
          url: `${origin}/llms.txt`,
          suggestion:
            "Publish a /llms.txt markdown index of your key pages so LLM agents can discover content without scraping HTML.",
        },
      });
    }
  } catch {
    /* skip */
  }

  if (llmsTxtExists) {
    const linkHeader = homeHeaders?.get("link") ?? "";
    if (!linkHeader.includes("llms.txt")) {
      findings.push({
        type: "site_issue",
        key: `${origin} llms_not_in_link_header`,
        title: "/llms.txt exists but isn't advertised via Link header",
        detail: {
          kind: "llms_not_in_link_header",
          url: origin,
          suggestion:
            'Send `Link: </llms.txt>; rel="alternate"; type="text/markdown"` on HTML responses so agents discover it without guessing.',
        },
      });
    }
    for (const [path, label] of [
      ["/.well-known/mcp/server-card.json", "MCP server card"],
      ["/.well-known/agent-skills/index.json", "Agent Skills index"],
    ] as const) {
      try {
        const res = await get(new URL(path, origin).toString());
        await res.body?.cancel();
        if (res.status === 404) {
          findings.push({
            type: "site_issue",
            key: `${origin} missing_${path.slice(path.lastIndexOf("/") + 1)}`,
            title: `No ${label} at ${path} (site publishes /llms.txt)`,
            detail: {
              kind: "missing_agent_discovery",
              url: `${origin}${path}`,
              suggestion: `Publish ${path} so agents can discover tools and skills beyond the llms.txt index.`,
            },
          });
        }
      } catch {
        /* skip */
      }
    }
  }

  // --- apple-touch-icon -----------------------------------------------------
  const homeForIcons = crawl.pages.get(new URL("/", origin).toString());
  if (homeForIcons && !homeForIcons.appleTouchIconHref) {
    findings.push({
      type: "site_issue",
      key: `${origin} apple_touch_icon_missing`,
      title: "No apple-touch-icon link on the homepage",
      detail: {
        kind: "apple_touch_icon_missing",
        url: origin,
        suggestion:
          'Add `<link rel="apple-touch-icon" href="/apple-touch-icon.png">` so iOS home-screen bookmarks get a proper icon.',
      },
    });
  }

  // --- security.txt ---------------------------------------------------------
  try {
    const res = await get(
      new URL("/.well-known/security.txt", origin).toString(),
    );
    await res.body?.cancel();
    if (res.status === 404) {
      findings.push({
        type: "site_issue",
        key: `${origin} security_txt_missing`,
        title: "No /.well-known/security.txt",
        detail: {
          kind: "security_txt_missing",
          url: `${origin}/.well-known/security.txt`,
          suggestion:
            "Publish a security.txt (RFC 9116) with a Contact and Expires field so researchers can report vulnerabilities.",
        },
      });
    }
  } catch {
    /* skip */
  }

  // --- 404 handling probe ---------------------------------------------------
  try {
    const probe = new URL(
      `/legible-404-probe-${Math.random().toString(36).slice(2, 10)}`,
      origin,
    ).toString();
    const res = await get(probe);
    if (res.status === 200) {
      await res.body?.cancel();
      findings.push({
        type: "site_issue",
        key: `${origin} no_404_status`,
        title: "Nonexistent URLs return 200 instead of 404",
        detail: {
          kind: "no_404_status",
          url: probe,
          note: "Every mistyped or removed URL looks like a real page to crawlers — a site-wide soft-404 factory.",
        },
      });
    } else if (res.status === 404) {
      const body = await res.text();
      if (!isHelpful404Body(body)) {
        findings.push({
          type: "site_issue",
          key: `${origin} weak_404_page`,
          title: "404 page doesn't link back to the site",
          detail: {
            kind: "weak_404_page",
            url: probe,
            suggestion:
              "Custom 404 pages should explain what happened and link to the homepage or search — not a blank response.",
          },
        });
      }
    } else {
      await res.body?.cancel();
    }
  } catch {
    /* skip */
  }

  // --- privacy policy link --------------------------------------------------
  const privacyUrls = new Set<string>();
  for (const page of crawl.pages.values()) {
    if (page.privacyPolicyHref) privacyUrls.add(page.privacyPolicyHref);
  }
  for (const privacyUrl of privacyUrls) {
    try {
      const res = await get(privacyUrl);
      await res.body?.cancel();
      if (res.status >= 400) {
        findings.push({
          type: "site_issue",
          key: privacyUrl,
          title: `Privacy policy link is dead (${res.status})`,
          detail: {
            kind: "privacy_policy_dead",
            url: privacyUrl,
            suggestion:
              "Restore the privacy policy page or update footer links site-wide.",
          },
        });
      }
    } catch {
      findings.push({
        type: "site_issue",
        key: privacyUrl,
        title: "Privacy policy link is unreachable",
        detail: {
          kind: "privacy_policy_dead",
          url: privacyUrl,
          suggestion:
            "Restore the privacy policy page or update footer links site-wide.",
        },
      });
    }
  }

  // --- favicon --------------------------------------------------------------
  const home = crawl.pages.get(new URL("/", origin).toString());
  const declaredIcons = home?.iconHrefs ?? [];
  if (declaredIcons.length === 0) {
    try {
      const res = await get(new URL("/favicon.ico", origin).toString());
      await res.body?.cancel();
      if (res.status >= 400) {
        findings.push({
          type: "site_issue",
          key: `${origin} favicon_missing`,
          title: "No favicon: no icon link tags and /favicon.ico is missing",
          detail: { kind: "favicon_missing", url: `${origin}/favicon.ico` },
        });
      }
    } catch {
      /* network failure: skip rather than guess */
    }
  }

  // --- www / bare-domain duplication ---------------------------------------
  try {
    const url = new URL(origin);
    const altHost = url.hostname.startsWith("www.")
      ? url.hostname.slice(4)
      : `www.${url.hostname}`;
    const altOrigin = `${url.protocol}//${altHost}`;
    const res = await get(`${altOrigin}/`);
    await res.body?.cancel();
    if (res.status === 200) {
      findings.push({
        type: "site_issue",
        key: `${origin} www_duplicate`,
        title: `Both ${url.hostname} and ${altHost} serve content without redirecting`,
        detail: {
          kind: "www_duplicate",
          url: `${altOrigin}/`,
          note: "Two hostnames serving the same site splits link equity and indexing; one should 301 to the other.",
        },
      });
    }
  } catch {
    /* alternate host doesn't resolve — that's the correct state */
  }

  // --- TLS expiry -----------------------------------------------------------
  try {
    const host = new URL(origin).hostname;
    const expiry = await certExpiry(host);
    if (expiry) {
      const daysLeft = Math.floor((expiry.getTime() - Date.now()) / 86_400_000);
      if (daysLeft <= TLS_EXPIRY_WARN_DAYS) {
        findings.push({
          type: "site_issue",
          key: `${origin} tls_expiring`,
          title: `TLS certificate expires in ${daysLeft} day${daysLeft === 1 ? "" : "s"}`,
          detail: {
            kind: "tls_expiring",
            url: origin,
            expiresAt: expiry.toISOString(),
            daysLeft,
          },
        });
      }
    }
  } catch {
    /* TLS peek failed; don't fabricate a finding */
  }

  // --- sitemap lastmod sanity ----------------------------------------------
  const now = Date.now() + 86_400_000; // one day of clock-skew tolerance
  const future = sitemapEntries.filter((e) => {
    if (!e.lastmod) return false;
    const t = Date.parse(e.lastmod);
    return !Number.isNaN(t) && t > now;
  });
  if (future.length > 0) {
    findings.push({
      type: "site_issue",
      key: `${origin} sitemap_lastmod_future`,
      title: `Sitemap has ${future.length} lastmod date${future.length === 1 ? "" : "s"} in the future`,
      detail: {
        kind: "sitemap_lastmod_future",
        count: future.length,
        examples: future.slice(0, 5).map((e) => `${e.url} (${e.lastmod})`),
        note: "Future lastmod values make the whole sitemap untrustworthy to crawlers.",
      },
    });
  }

  // --- advertised feed health ----------------------------------------------
  const feedReferrers = new Map<string, Set<string>>();
  for (const page of crawl.pages.values()) {
    for (const feed of page.feedUrls ?? []) {
      const refs = feedReferrers.get(feed) ?? new Set();
      refs.add(page.url);
      feedReferrers.set(feed, refs);
    }
  }
  for (const [feedUrl, refs] of [...feedReferrers.entries()].slice(
    0,
    MAX_FEEDS_CHECKED,
  )) {
    try {
      const res = await fetchImpl(feedUrl, {
        headers: { "user-agent": USER_AGENT },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!res.ok) {
        await res.body?.cancel();
        findings.push({
          type: "feed_issue",
          key: feedUrl,
          title: `Advertised feed ${feedUrl} returns ${res.status}`,
          detail: {
            url: feedUrl,
            status: res.status,
            problem: "dead",
            linkedFrom: [...refs],
          },
        });
        continue;
      }
      const xml = await res.text();
      const $ = cheerio.load(xml, { xml: true });
      const valid = $("rss").length > 0 || $("feed").length > 0;
      if (!valid) {
        findings.push({
          type: "feed_issue",
          key: feedUrl,
          title: `Advertised feed ${feedUrl} is not valid RSS/Atom`,
          detail: {
            url: feedUrl,
            problem: "invalid",
            linkedFrom: [...refs],
          },
        });
      }
    } catch (err) {
      findings.push({
        type: "feed_issue",
        key: feedUrl,
        title: `Advertised feed ${feedUrl} is unreachable`,
        detail: {
          url: feedUrl,
          problem: "unreachable",
          error: err instanceof Error ? err.message : String(err),
          linkedFrom: [...refs],
        },
      });
    }
  }

  return findings;
}

function robotsBlocksEverything(body: string): boolean {
  // True when a `User-agent: *` group contains a bare `Disallow: /`.
  let inStarGroup = false;
  for (const raw of body.split("\n")) {
    const line = raw.replace(/#.*$/, "").trim();
    if (line === "") continue;
    const agent = line.match(/^user-agent\s*:\s*(.+)$/i);
    if (agent) {
      inStarGroup = agent[1].trim() === "*";
      continue;
    }
    if (inStarGroup && /^disallow\s*:\s*\/\s*$/i.test(line)) return true;
  }
  return false;
}

function hasTextCompression(contentEncoding: string | null): boolean {
  if (!contentEncoding) return false;
  const encodings = contentEncoding.toLowerCase().split(/\s*,\s*/);
  return encodings.some((e) =>
    ["gzip", "br", "deflate", "zstd"].includes(e.trim()),
  );
}

function robotsMentionsAiCrawlers(body: string): boolean {
  return AI_CRAWLER_AGENTS.some((agent) =>
    new RegExp(`^\\s*user-agent\\s*:\\s*${agent}\\s*$`, "im").test(body),
  );
}

function isHelpful404Body(html: string): boolean {
  const lower = html.toLowerCase();
  return (
    lower.includes('href="/"') ||
    lower.includes("href='/") ||
    /href=["'][^"']*\/(home)?["']/.test(lower) ||
    lower.includes("go home") ||
    lower.includes("back to")
  );
}

function realCertExpiry(host: string): Promise<Date | null> {
  return new Promise((resolve) => {
    const socket = tls.connect(
      { host, port: 443, servername: host, timeout: 10_000 },
      () => {
        const cert = socket.getPeerCertificate();
        socket.end();
        resolve(cert?.valid_to ? new Date(cert.valid_to) : null);
      },
    );
    socket.on("error", () => resolve(null));
    socket.on("timeout", () => {
      socket.destroy();
      resolve(null);
    });
  });
}

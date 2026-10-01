import type { JsonLdIssue } from "../json-ld";
import {
  DEFAULT_CONCURRENCY,
  FETCH_TIMEOUT_MS,
  MAX_REDIRECT_HOPS,
  USER_AGENT,
} from "./constants";
import {
  type PageA11y,
  type PageMeta,
  type ParsedPage,
  parsePage,
} from "./parse";
import { loadRobots } from "./robots";
import { isInternal, normalizeUrl } from "./url";

export interface PageRecord {
  /** Normalized URL as discovered (pre-redirect). */
  url: string;
  /** Final HTTP status after following redirects; 0 on network error. */
  status: number;
  /** URL that ultimately responded, after redirects. */
  finalUrl: string;
  /** Every URL traversed via 3xx, in order, excluding `url` itself. */
  redirectHops: string[];
  contentType: string | null;
  /** Outgoing internal links found in the HTML (normalized). */
  internalLinks: string[];
  /** Pages that linked to this URL (populated across the whole crawl). */
  referrers: string[];
  /** True if meta robots or X-Robots-Tag declares noindex. */
  noindex?: boolean;
  /** rel=canonical target (normalized), when present. */
  canonicalUrl?: string;
  /** Head-tag details, present for 200 HTML pages we parsed. */
  meta?: PageMeta;
  /** <img> elements found on the page (absolute src, alt presence). */
  images?: Array<{ src: string; hasAlt: boolean }>;
  /** http:// subresources referenced by this https page. */
  mixedContent?: string[];
  /** rel=alternate hreflang annotations declared by this page. */
  hreflangs?: Array<{ lang: string; href: string }>;
  /** All element ids (+ <a name>) on the page — anchor-link targets. */
  ids?: string[];
  /** Internal links that carry a #fragment (target normalized, hash-less). */
  fragmentLinks?: Array<{ target: string; fragment: string }>;
  /** og:image / twitter:image URLs (absolute). */
  socialImages?: string[];
  /** Count of application/ld+json blocks that fail JSON.parse. */
  jsonLdErrors?: number;
  /** Feed URLs advertised via <link rel=alternate type=rss/atom>. */
  feedUrls?: string[];
  /** External (off-site) http(s) links found on the page. */
  externalLinks?: string[];
  /** YouTube video ids embedded via iframe. */
  youtubeEmbeds?: string[];
  /** Template/encoding debris visible in rendered text. */
  textArtifacts?: Array<{ artifact: string; sample: string }>;
  /** Title smells like an error page despite a 200 status. */
  softNotFound?: boolean;
  /** Links/assets pointing at localhost/staging/preview hosts. */
  stagingRefs?: string[];
  /** <link rel=icon> hrefs, for favicon presence checks. */
  iconHrefs?: string[];
  /** apple-touch-icon href when declared. */
  appleTouchIconHref?: string;
  /** Accessibility signals parsed from static HTML. */
  a11y?: PageA11y;
  /** External scripts/stylesheets loaded without Subresource Integrity. */
  externalWithoutSri?: string[];
  /** Schema.org validation issues from JSON-LD blocks. */
  jsonLdIssues?: JsonLdIssue[];
  hasBreadcrumbList?: boolean;
  lazyLcpImage?: string;
  scriptHrefs?: string[];
  stylesheetHrefs?: string[];
  privacyPolicyHref?: string;
  /** Milliseconds until the final response's headers arrived. */
  ttfbMs?: number;
  /**
   * Page matched a noFollowPattern: it was fetched to verify it exists, but
   * it isn't the site owner's content to fix. Content-quality detectors
   * (meta tags, alt text, slowness…) should skip it; existence checks
   * (broken links) still apply.
   */
  noFollow?: boolean;
  blockedByRobots?: boolean;
  error?: string;
}

/** Result of a lightweight status/size check on a subresource URL. */
export interface AssetRecord {
  url: string;
  status: number;
  contentLength: number | null;
  cacheControl: string | null;
  /** Pages that reference this asset. */
  referrers: string[];
}

export interface CrawlResult {
  origin: string;
  pages: Map<string, PageRecord>;
  pagesCrawled: number;
  /**
   * True when the crawl stopped because it hit maxPages rather than running
   * out of URLs. Detectors that reason about the *absence* of links (orphan
   * detection) are unreliable on an incomplete link graph and should skip.
   */
  budgetExhausted: boolean;
}

export interface CrawlOptions {
  origin: string;
  /** Extra seeds beyond the homepage — typically sitemap URLs. */
  seeds?: string[];
  maxPages?: number;
  concurrency?: number;
  /**
   * Pathname patterns to fetch-but-not-follow: matching pages are still
   * status-checked when linked (so broken-link detection stays complete),
   * but their own links aren't crawled. Use this to stop the crawl from
   * ballooning into user-generated or app-like sections of a host.
   */
  noFollowPatterns?: RegExp[];
  fetchImpl?: typeof fetch;
}

/**
 * BFS crawl of a single site. Follows redirects manually so chains are
 * observable, respects robots.txt, and never leaves the site's host.
 */
export async function crawlSite(options: CrawlOptions): Promise<CrawlResult> {
  const {
    origin,
    seeds = [],
    maxPages = 2000,
    concurrency = DEFAULT_CONCURRENCY,
    noFollowPatterns = [],
    fetchImpl = fetch,
  } = options;

  const isNoFollow = (url: string) =>
    noFollowPatterns.some((p) => p.test(new URL(url).pathname));

  const isAllowed = await loadRobots(origin, fetchImpl);
  const pages = new Map<string, PageRecord>();
  const queue: string[] = [];
  const enqueued = new Set<string>();
  let budgetExhausted = false;

  const enqueue = (url: string, referrer?: string) => {
    const existing = pages.get(url);
    if (existing) {
      if (referrer && !existing.referrers.includes(referrer)) {
        existing.referrers.push(referrer);
      }
      return;
    }
    if (enqueued.has(url)) {
      if (referrer) pendingReferrers.get(url)?.push(referrer);
      return;
    }
    if (enqueued.size >= maxPages) {
      budgetExhausted = true;
      return;
    }
    enqueued.add(url);
    pendingReferrers.set(url, referrer ? [referrer] : []);
    queue.push(url);
  };

  const pendingReferrers = new Map<string, string[]>();

  const home = normalizeUrl("/", origin);
  if (home) enqueue(home);
  for (const seed of seeds) {
    const normalized = normalizeUrl(seed);
    if (normalized && isInternal(normalized, origin)) enqueue(normalized);
  }

  const visit = async (url: string): Promise<void> => {
    const record: PageRecord = isAllowed(url)
      ? await fetchPage(url, origin, fetchImpl)
      : {
          url,
          status: 0,
          finalUrl: url,
          redirectHops: [],
          contentType: null,
          internalLinks: [],
          referrers: [],
          blockedByRobots: true,
        };

    // Publish the record before draining pending referrers: any enqueue()
    // that races with us will then append to the record directly, so no
    // referrer is lost while the page was mid-fetch.
    pages.set(url, record);
    const pending = pendingReferrers.get(url) ?? [];
    pendingReferrers.delete(url);
    for (const referrer of pending) {
      if (!record.referrers.includes(referrer)) record.referrers.push(referrer);
    }

    if (isNoFollow(url)) {
      record.noFollow = true;
    } else {
      for (const link of record.internalLinks) {
        enqueue(link, url);
      }
      // Canonical targets get fetched too (without counting as "linked"),
      // so canonical-to-dead/redirect defects are observable.
      if (record.canonicalUrl && isInternal(record.canonicalUrl, origin)) {
        enqueue(record.canonicalUrl);
      }
    }
  };

  // Simple worker pool over the shared queue.
  let inFlight = 0;
  const workers = Array.from({ length: concurrency }, async () => {
    while (true) {
      const url = queue.shift();
      if (url === undefined) {
        // Queue may refill while other workers are mid-fetch; poll briefly.
        await new Promise((r) => setTimeout(r, 50));
        if (queue.length === 0 && inFlight === 0) return;
        continue;
      }
      inFlight++;
      try {
        await visit(url);
      } finally {
        inFlight--;
      }
    }
  });
  await Promise.all(workers);

  return { origin, pages, pagesCrawled: pages.size, budgetExhausted };
}

async function fetchPage(
  url: string,
  origin: string,
  fetchImpl: typeof fetch,
): Promise<PageRecord> {
  const redirectHops: string[] = [];
  let current = url;

  for (let hop = 0; hop <= MAX_REDIRECT_HOPS; hop++) {
    let res: Response;
    const hopStarted = Date.now();
    try {
      res = await fetchImpl(current, {
        redirect: "manual",
        headers: { "user-agent": USER_AGENT, accept: "text/html,*/*;q=0.8" },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
    } catch (err) {
      return {
        url,
        status: 0,
        finalUrl: current,
        redirectHops,
        contentType: null,
        internalLinks: [],
        referrers: [],
        error: err instanceof Error ? err.message : String(err),
      };
    }

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      // Redirect responses can still carry a body; discard it.
      await res.body?.cancel();
      const next = location ? normalizeUrl(location, current) : null;
      if (!next || hop === MAX_REDIRECT_HOPS || redirectHops.includes(next)) {
        return {
          url,
          status: res.status,
          finalUrl: current,
          redirectHops,
          contentType: null,
          internalLinks: [],
          referrers: [],
          error: next
            ? "redirect loop or too many hops"
            : "redirect without location",
        };
      }
      redirectHops.push(next);
      current = next;
      continue;
    }

    const ttfbMs = Date.now() - hopStarted;
    const contentType = res.headers.get("content-type");
    const isHtml = contentType?.includes("text/html") ?? false;
    const headerNoindex =
      res.headers.get("x-robots-tag")?.includes("noindex") ?? false;
    let parsed: ParsedPage | undefined;
    if (res.ok && isHtml && isInternal(current, origin)) {
      const html = await res.text();
      parsed = parsePage(html, current, origin);
    } else {
      await res.body?.cancel();
    }

    return {
      url,
      status: res.status,
      finalUrl: current,
      redirectHops,
      contentType,
      referrers: [],
      ttfbMs,
      ...(parsed ?? { internalLinks: [] }),
      noindex: headerNoindex || (parsed?.noindex ?? false),
    };
  }

  // Unreachable, but satisfies the type checker.
  return {
    url,
    status: 0,
    finalUrl: current,
    redirectHops,
    contentType: null,
    internalLinks: [],
    referrers: [],
    error: "redirect limit exceeded",
  };
}

export { checkAssets } from "./assets";
export {
  type PageA11y,
  type PageMeta,
  type ParsedPage,
  parsePage,
} from "./parse";

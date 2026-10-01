import { displayPath, normalizeUrl } from "../crawler/url";
import type { RawFinding } from "../findings";
import { hasQueryString, isOwnedIndexablePage } from "./guards";
import type { Detector } from "./types";

/** Pages this many clicks or more from the homepage get flagged. */
export const DEEP_PAGE_THRESHOLD = 5;

/**
 * Click-depth from the homepage over the crawled link graph. Two guards keep
 * this honest: skipped when the crawl budget was exhausted (missing pages
 * could hide shorter paths), and only sitemap-listed pages are flagged — the
 * site has declared those matter, whereas deep pagination tails are normal.
 */
export const deepPages: Detector = {
  name: "deep-pages",
  detect({ crawl, sitemapUrls }) {
    if (crawl.budgetExhausted || sitemapUrls.length === 0) return [];
    const inSitemap = new Set(sitemapUrls);
    const home = normalizeUrl("/", crawl.origin);
    if (!home || !crawl.pages.has(home)) return [];

    const depth = new Map<string, number>([[home, 0]]);
    const queue = [home];
    while (queue.length > 0) {
      const url = queue.shift();
      if (url === undefined) break;
      const page = crawl.pages.get(url);
      const d = depth.get(url) ?? 0;
      for (const link of page?.internalLinks ?? []) {
        if (!depth.has(link) && crawl.pages.has(link)) {
          depth.set(link, d + 1);
          queue.push(link);
        }
      }
    }

    const findings: RawFinding[] = [];
    for (const [url, d] of depth) {
      if (d < DEEP_PAGE_THRESHOLD) continue;
      if (!inSitemap.has(url)) continue;
      const page = crawl.pages.get(url);
      if (!page || !isOwnedIndexablePage(page)) continue;
      if (hasQueryString(page)) continue;
      findings.push({
        type: "deep_page",
        key: url,
        title: `${displayPath(url)} is ${d} clicks from the homepage`,
        detail: {
          url,
          depth: d,
          note: "Pages this deep get less crawl attention and less link equity; add links from shallower pages.",
        },
      });
    }
    return findings;
  },
};

import { displayPath, normalizeUrl } from "../crawler/url";
import type { RawFinding } from "../findings";
import type { Detector } from "./types";

/**
 * Pages the site declares in its sitemap but that no crawled page links to.
 * These are reachable only by knowing the URL — invisible to users browsing
 * the site and starved of internal link signals for search engines.
 */
export const orphanPages: Detector = {
  name: "orphan-pages",
  detect({ crawl, sitemapUrls }) {
    // An incomplete crawl can't prove a page is unlinked — the link might be
    // on a page we never fetched. Silence beats false accusations here.
    if (crawl.budgetExhausted) return [];

    const findings: RawFinding[] = [];
    const home = normalizeUrl("/", crawl.origin);
    for (const url of sitemapUrls) {
      if (url === home) continue;
      const page = crawl.pages.get(url);
      // Only flag pages we actually crawled and that exist; missing/broken
      // sitemap entries are the sitemap detector's job.
      if (page?.status !== 200) continue;
      if (page.referrers.length > 0) continue;
      findings.push({
        type: "orphan_page",
        key: url,
        title: `Orphaned page: ${displayPath(url)} has no internal links`,
        detail: {
          url,
          inSitemap: true,
          note: "Page is in the sitemap and returns 200, but no crawled page links to it.",
        },
      });
    }
    return findings;
  },
};

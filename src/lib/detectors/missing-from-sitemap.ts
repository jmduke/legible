import { displayPath, normalizeUrl } from "../crawler/url";
import type { RawFinding } from "../findings";
import { isOwnedIndexablePage } from "./guards";
import type { Detector } from "./types";

/**
 * The inverse of the sitemap-mismatch detector: pages that are live, linked,
 * and indexable but absent from the sitemap. Requires positive evidence only
 * (the page exists and is linked), so unlike orphan detection it's safe to
 * run on a budget-exhausted crawl.
 *
 * Deliberately conservative about what "should" be listed:
 *  - only clean 200 HTML pages reached without redirects
 *  - only pages some other page links to
 *  - no query-string URLs (pagination/filter variants aren't sitemap material)
 *  - not noindex'd, and canonical is self or absent — a page that points its
 *    canonical elsewhere is intentionally not in the sitemap
 */
export const missingFromSitemap: Detector = {
  name: "missing-from-sitemap",
  detect({ crawl, sitemapUrls }) {
    // No sitemap at all is a different (site-level) problem; without one,
    // flagging every page would be noise, not signal.
    if (sitemapUrls.length === 0) return [];

    const inSitemap = new Set(sitemapUrls);
    const findings: RawFinding[] = [];

    for (const page of crawl.pages.values()) {
      if (!isOwnedIndexablePage(page)) continue;
      if (page.redirectHops.length > 0) continue;
      if (!page.contentType?.includes("text/html")) continue;
      if (page.referrers.length === 0) continue;
      if (inSitemap.has(page.url)) continue;

      const url = new URL(page.url);
      if (url.search !== "") continue;

      // Canonicalized-elsewhere pages are intentionally unlisted; treat a
      // trailing-slash-only difference as self.
      if (page.canonicalUrl) {
        const self = normalizeUrl(page.url);
        const selfSlashless = self?.replace(/\/$/, "");
        const canonical = page.canonicalUrl.replace(/\/$/, "");
        if (canonical !== self && canonical !== selfSlashless) continue;
        if (inSitemap.has(page.canonicalUrl)) continue;
      }

      findings.push({
        type: "missing_from_sitemap",
        key: page.url,
        title: `Missing from sitemap: ${displayPath(page.url)}`,
        detail: {
          url: page.url,
          linkedFrom: page.referrers,
          note: "Live, indexable, internally linked page that the sitemap does not list.",
        },
      });
    }
    return findings;
  },
};

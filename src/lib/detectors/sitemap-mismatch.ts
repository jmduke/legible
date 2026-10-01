import { displayPath } from "../crawler/url";
import type { RawFinding } from "../findings";
import type { Detector } from "./types";

/**
 * Sitemap entries that don't resolve to a clean 200: dead URLs poison crawl
 * budget, and redirecting entries should list their destination instead.
 */
export const sitemapMismatch: Detector = {
  name: "sitemap-mismatch",
  detect({ crawl, sitemapUrls }) {
    const findings: RawFinding[] = [];
    for (const url of sitemapUrls) {
      const page = crawl.pages.get(url);
      if (!page || page.blockedByRobots) continue;

      if (page.status >= 400 || (page.status === 0 && page.error)) {
        findings.push({
          type: "sitemap_broken_url",
          key: url,
          title: `Sitemap lists dead URL ${displayPath(url)} (${page.status || "unreachable"})`,
          detail: {
            url,
            status: page.status,
            error: page.error,
            problem: "dead",
          },
        });
      } else if (page.redirectHops.length > 0 && page.status === 200) {
        findings.push({
          type: "sitemap_broken_url",
          key: url,
          title: `Sitemap lists redirecting URL ${displayPath(url)}`,
          detail: {
            url,
            finalUrl: page.finalUrl,
            problem: "redirect",
            suggestion: `Replace with ${page.finalUrl} in the sitemap.`,
          },
        });
      } else if (page.status === 200 && page.noindex) {
        findings.push({
          type: "sitemap_broken_url",
          key: url,
          title: `Sitemap lists noindexed URL ${displayPath(url)}`,
          detail: {
            url,
            problem: "noindex",
            suggestion:
              "A page can't be both promoted for indexing and marked noindex — remove it from the sitemap or drop the noindex.",
          },
        });
      }
    }
    return findings;
  },
};

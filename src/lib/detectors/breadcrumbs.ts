import { displayPath, normalizeUrl } from "../crawler/url";
import type { RawFinding } from "../findings";
import { hasQueryString, isOwnedIndexablePage } from "./guards";
import type { Detector } from "./types";

/** Pages at or below this depth should declare BreadcrumbList JSON-LD. */
const BREADCRUMB_DEPTH_THRESHOLD = 2;

/**
 * Deep pages (≥2 clicks from home) without BreadcrumbList structured data.
 * Shallow pages and the homepage are exempt.
 */
export const breadcrumbs: Detector = {
  name: "breadcrumbs",
  detect({ crawl }) {
    if (crawl.budgetExhausted) return [];
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
      if (d < BREADCRUMB_DEPTH_THRESHOLD) continue;
      const page = crawl.pages.get(url);
      if (!page || !isOwnedIndexablePage(page)) continue;
      if (hasQueryString(page)) continue;
      if (page.hasBreadcrumbList) continue;
      findings.push({
        type: "structured_data_issue",
        key: `${url} missing_breadcrumbs`,
        title: `No BreadcrumbList JSON-LD on ${displayPath(url)} (${d} clicks deep)`,
        detail: {
          url,
          kind: "missing_breadcrumbs",
          count: 1,
          note: "Deep pages benefit from breadcrumb markup for search snippets and agent navigation.",
        },
      });
    }
    return findings;
  },
};

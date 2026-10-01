import { displayPath } from "../crawler/url";
import type { RawFinding } from "../findings";
import { hasQueryString, isOwnedPage } from "./guards";
import type { Detector } from "./types";

/**
 * Pages whose final response headers took longer than this. Deliberately a
 * high bar: a single crawl sample can't distinguish a slow page from a slow
 * moment, so we only flag times no healthy page should ever produce.
 */
export const SLOW_PAGE_MS = 3_000;

export const slowPages: Detector = {
  name: "slow-pages",
  detect({ crawl }) {
    const findings: RawFinding[] = [];
    for (const page of crawl.pages.values()) {
      if (!isOwnedPage(page) || page.ttfbMs === undefined) continue;
      if (page.ttfbMs <= SLOW_PAGE_MS) continue;
      if (hasQueryString(page)) continue;
      findings.push({
        type: "slow_page",
        key: page.url,
        title: `Slow page: ${displayPath(page.url)} took ${(page.ttfbMs / 1000).toFixed(1)}s to respond`,
        detail: {
          url: page.url,
          ttfbMs: page.ttfbMs,
          note: "Single-sample measurement from the crawl; treat as a smoke signal, not a benchmark.",
        },
      });
    }
    return findings;
  },
};

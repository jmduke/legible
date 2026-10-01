import { displayPath } from "../crawler/url";
import type { RawFinding } from "../findings";
import { hasQueryString, isOwnedPage } from "./guards";
import type { Detector } from "./types";

/**
 * Performance anti-patterns detectable from static HTML: lazy-loading on the
 * first prominent image (likely LCP candidate).
 */
export const performanceHints: Detector = {
  name: "performance-hints",
  detect({ crawl }) {
    const findings: RawFinding[] = [];
    for (const page of crawl.pages.values()) {
      if (!isOwnedPage(page) || !page.lazyLcpImage) continue;
      if (hasQueryString(page)) continue;
      findings.push({
        type: "image_issue",
        key: `${page.url} lazy_lcp`,
        title: `First content image uses loading="lazy" on ${displayPath(page.url)} (likely hurts LCP)`,
        detail: {
          url: page.url,
          kind: "lazy_lcp_candidate",
          images: [page.lazyLcpImage],
        },
      });
    }
    return findings;
  },
};

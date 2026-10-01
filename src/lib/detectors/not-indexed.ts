import { displayPath } from "../crawler/url";
import type { RawFinding } from "../findings";
import type { Detector } from "./types";

/**
 * URLs Google reports as not indexed despite being live and in the sitemap.
 * Powered by GSC URL-inspection sampling (subject to its 2,000/day quota),
 * so coverage is partial by design.
 */
export const notIndexed: Detector = {
  name: "not-indexed",
  detect({ crawl, inspections }) {
    if (!inspections) return [];
    const findings: RawFinding[] = [];
    for (const inspection of inspections) {
      if (inspection.verdict === "PASS") continue;
      const page = crawl.pages.get(inspection.url);
      // Dead pages are already covered by other detectors.
      if (page && page.status !== 200) continue;
      findings.push({
        type: "not_indexed",
        key: inspection.url,
        title: `Not indexed by Google: ${displayPath(inspection.url)}`,
        detail: {
          url: inspection.url,
          verdict: inspection.verdict,
          coverageState: inspection.coverageState,
        },
      });
    }
    return findings;
  },
};

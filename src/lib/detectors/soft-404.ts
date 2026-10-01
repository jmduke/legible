import { displayPath } from "../crawler/url";
import type { RawFinding } from "../findings";
import { isOwnedPage } from "./guards";
import type { Detector } from "./types";

/**
 * Pages that answer 200 but whose title says "not found". Search engines
 * index them as real content; users hit dead ends that never show up in
 * error monitoring because nothing errored.
 */
export const soft404s: Detector = {
  name: "soft-404s",
  detect({ crawl }) {
    const findings: RawFinding[] = [];
    for (const page of crawl.pages.values()) {
      if (!isOwnedPage(page) || !page.softNotFound) continue;
      findings.push({
        type: "soft_404",
        key: page.url,
        title: `Soft 404: ${displayPath(page.url)} returns 200 but titles itself "${page.meta?.title}"`,
        detail: {
          url: page.url,
          pageTitle: page.meta?.title,
          linkedFrom: page.referrers,
        },
      });
    }
    return findings;
  },
};

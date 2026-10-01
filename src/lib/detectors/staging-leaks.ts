import type { RawFinding } from "../findings";
import { isOwnedPage } from "./guards";
import type { Detector } from "./types";

/**
 * Production pages referencing localhost, staging hosts, or preview deploys.
 * One finding per leaked URL, with every referencing page as evidence.
 */
export const stagingLeaks: Detector = {
  name: "staging-leaks",
  detect({ crawl }) {
    const referrers = new Map<string, string[]>();
    for (const page of crawl.pages.values()) {
      if (!isOwnedPage(page)) continue;
      for (const ref of page.stagingRefs ?? []) {
        referrers.set(ref, [...(referrers.get(ref) ?? []), page.url]);
      }
    }
    const findings: RawFinding[] = [];
    for (const [leaked, pages] of referrers) {
      findings.push({
        type: "staging_leak",
        key: leaked,
        title: `Staging/localhost URL ${leaked} referenced on ${pages.length} page${pages.length > 1 ? "s" : ""}`,
        detail: { resource: leaked, linkedFrom: pages },
      });
    }
    return findings;
  },
};

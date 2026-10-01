import { displayPath } from "../crawler/url";
import type { RawFinding } from "../findings";
import type { Detector } from "./types";

/**
 * Linked URLs that take two or more redirect hops (or loop) before landing.
 * Single redirects are normal site hygiene; chains waste crawl budget and
 * dilute link equity, and loops break the page outright.
 */
export const redirectChains: Detector = {
  name: "redirect-chains",
  detect({ crawl }) {
    const findings: RawFinding[] = [];
    for (const page of crawl.pages.values()) {
      if (page.blockedByRobots || page.referrers.length === 0) continue;
      const isLoop = page.error?.includes("redirect loop") ?? false;
      if (page.redirectHops.length < 2 && !isLoop) continue;
      findings.push({
        type: "redirect_chain",
        key: page.url,
        title: isLoop
          ? `Redirect loop at ${displayPath(page.url)}`
          : `Redirect chain (${page.redirectHops.length} hops) from ${displayPath(page.url)}`,
        detail: {
          url: page.url,
          chain: [page.url, ...page.redirectHops],
          finalUrl: page.finalUrl,
          finalStatus: page.status,
          loop: isLoop,
          linkedFrom: page.referrers,
        },
      });
    }
    return findings;
  },
};

import { displayPath } from "../crawler/url";
import type { RawFinding } from "../findings";
import type { Detector } from "./types";

/**
 * Infrastructure-generated link targets that always 404 for crawlers but
 * aren't real site content — flagging them is pure noise.
 */
const IGNORED_PATH_PREFIXES = [
  "/cdn-cgi/", // Cloudflare artifacts, e.g. email-protection fallback links
];

function isIgnoredPath(url: string): boolean {
  try {
    const { pathname } = new URL(url);
    return IGNORED_PATH_PREFIXES.some((prefix) => pathname.startsWith(prefix));
  } catch {
    return false;
  }
}

/**
 * Internal links whose target returns 4xx/5xx (or fails at the network
 * level). One finding per broken target; the pages linking to it are the
 * evidence an engineer needs to fix every occurrence.
 */
export const brokenLinks: Detector = {
  name: "broken-links",
  detect({ crawl }) {
    const findings: RawFinding[] = [];
    for (const page of crawl.pages.values()) {
      if (page.blockedByRobots || page.referrers.length === 0) continue;
      if (isIgnoredPath(page.url)) continue;
      const broken = page.status >= 400 || (page.status === 0 && !!page.error);
      if (!broken) continue;
      findings.push({
        type: "broken_internal_link",
        key: page.url,
        title: `Broken link to ${displayPath(page.url)} (${page.status || "unreachable"})`,
        detail: {
          url: page.url,
          status: page.status,
          error: page.error,
          linkedFrom: page.referrers,
        },
      });
    }
    return findings;
  },
};

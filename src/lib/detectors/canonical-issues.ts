import { displayPath, isInternal } from "../crawler/url";
import type { RawFinding } from "../findings";
import { isOwnedIndexablePage } from "./guards";
import type { Detector } from "./types";

/**
 * Canonical tags pointing somewhere they shouldn't: a dead page, a redirect,
 * a noindexed page, or another host entirely. Each silently sabotages the
 * page's own indexing.
 */
export const canonicalIssues: Detector = {
  name: "canonical-issues",
  detect({ crawl }) {
    const findings: RawFinding[] = [];
    for (const page of crawl.pages.values()) {
      if (!isOwnedIndexablePage(page) || !page.canonicalUrl) continue;
      if (page.canonicalUrl === page.url) continue;
      const path = displayPath(page.url);

      if (!isInternal(page.canonicalUrl, crawl.origin)) {
        findings.push({
          type: "canonical_issue",
          key: `${page.url} offsite`,
          title: `Canonical on ${path} points to another site (${page.canonicalUrl})`,
          detail: {
            url: page.url,
            canonical: page.canonicalUrl,
            kind: "canonical_offsite",
            note: "Legitimate only for deliberate syndication; otherwise this deindexes the page.",
          },
        });
        continue;
      }

      const target = crawl.pages.get(page.canonicalUrl);
      if (!target) continue;
      if (target.status >= 400 || (target.status === 0 && target.error)) {
        findings.push({
          type: "canonical_issue",
          key: `${page.url} dead`,
          title: `Canonical on ${path} points to a dead URL (${target.status || "unreachable"})`,
          detail: {
            url: page.url,
            canonical: page.canonicalUrl,
            canonicalStatus: target.status,
            kind: "canonical_to_dead",
          },
        });
      } else if (target.redirectHops.length > 0) {
        findings.push({
          type: "canonical_issue",
          key: `${page.url} redirect`,
          title: `Canonical on ${path} points to a redirecting URL`,
          detail: {
            url: page.url,
            canonical: page.canonicalUrl,
            resolvesTo: target.finalUrl,
            kind: "canonical_to_redirect",
            suggestion: `Point the canonical directly at ${target.finalUrl}.`,
          },
        });
      } else if (target.noindex) {
        findings.push({
          type: "canonical_issue",
          key: `${page.url} noindex`,
          title: `Canonical on ${path} points to a noindexed page`,
          detail: {
            url: page.url,
            canonical: page.canonicalUrl,
            kind: "canonical_to_noindex",
            note: "Canonicalizing into a noindexed page asks Google to drop both.",
          },
        });
      }
    }
    return findings;
  },
};

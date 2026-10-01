import { displayPath } from "../crawler/url";
import type { RawFinding } from "../findings";
import { hasQueryString, isOwnedIndexablePage } from "./guards";
import type { Detector } from "./types";

const MAX_PAGES_LISTED = 10;

/**
 * Site-level duplicate titles and meta descriptions across indexable pages.
 * Fingerprinted on the duplicated text, so the work item persists until the
 * pages are actually differentiated (and reopens if a new page reuses it).
 */
export const duplicateMeta: Detector = {
  name: "duplicate-meta",
  detect({ crawl }) {
    const byTitle = new Map<string, string[]>();
    const byDescription = new Map<string, string[]>();

    for (const page of crawl.pages.values()) {
      if (!isOwnedIndexablePage(page) || !page.meta) continue;
      if (page.redirectHops.length > 0) continue;
      if (hasQueryString(page)) continue;
      // Pages canonicalized elsewhere legitimately share tags with their target.
      if (page.canonicalUrl && page.canonicalUrl !== page.url) continue;

      if (page.meta.title !== "") {
        byTitle.set(page.meta.title, [
          ...(byTitle.get(page.meta.title) ?? []),
          page.url,
        ]);
      }
      if (page.meta.description !== "") {
        byDescription.set(page.meta.description, [
          ...(byDescription.get(page.meta.description) ?? []),
          page.url,
        ]);
      }
    }

    const findings: RawFinding[] = [];
    for (const [field, groups] of [
      ["title", byTitle],
      ["description", byDescription],
    ] as const) {
      for (const [text, urls] of groups) {
        if (urls.length < 2) continue;
        const shown = urls.slice(0, MAX_PAGES_LISTED);
        findings.push({
          type: "duplicate_meta",
          key: `${field} ${text}`,
          title: `${urls.length} pages share the same ${field}: “${truncate(text, 60)}”`,
          detail: {
            field,
            value: text,
            pageCount: urls.length,
            pages: shown.map(displayPath),
            pagesTruncated: urls.length > MAX_PAGES_LISTED,
          },
        });
      }
    }
    return findings;
  },
};

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

import { displayPath } from "../crawler/url";
import type { RawFinding } from "../findings";
import { isOwnedIndexablePage } from "./guards";
import type { Detector } from "./types";

/**
 * hreflang reciprocity: if page A declares an alternate B, B must declare an
 * alternate pointing back at A (Google ignores non-reciprocal pairs). Only
 * pairs where both pages were crawled are judged — absence of evidence about
 * an uncrawled page is not a defect.
 */
export const hreflang: Detector = {
  name: "hreflang",
  detect({ crawl }) {
    const findings: RawFinding[] = [];

    for (const page of crawl.pages.values()) {
      if (!isOwnedIndexablePage(page) || !page.hreflangs?.length) continue;
      for (const alternate of page.hreflangs) {
        if (alternate.href === page.url) continue;
        const target = crawl.pages.get(alternate.href);
        if (target?.status !== 200 || !target.hreflangs) continue;
        const reciprocal = target.hreflangs.some((h) => h.href === page.url);
        if (reciprocal) continue;
        findings.push({
          type: "hreflang_issue",
          key: `${page.url} -> ${alternate.href}`,
          title: `hreflang not reciprocated: ${displayPath(alternate.href)} doesn't link back to ${displayPath(page.url)}`,
          detail: {
            page: page.url,
            declares: alternate.href,
            declaredLang: alternate.lang,
            note: "Search engines ignore hreflang pairs unless both pages reference each other.",
          },
        });
      }
    }
    return findings;
  },
};

import { displayPath } from "../crawler/url";
import type { RawFinding } from "../findings";
import { isOwnedPage } from "./guards";
import type { Detector } from "./types";

/**
 * og:image / twitter:image URLs that don't resolve. The page works, but
 * every share of it renders a blank card — invisible until someone shares.
 * Internal images come from the asset check; external ones are skipped.
 */
export const socialCards: Detector = {
  name: "social-cards",
  detect({ crawl, assets }) {
    if (!assets) return [];
    // One finding per broken image, not per page: a site-wide og:image that
    // 404s would otherwise produce a finding for every page on the site.
    const pagesByImage = new Map<string, string[]>();
    for (const page of crawl.pages.values()) {
      if (!isOwnedPage(page) || !page.socialImages?.length) continue;
      for (const src of page.socialImages) {
        const asset = assets.get(src);
        if (!asset || (asset.status < 400 && asset.status !== 0)) continue;
        pagesByImage.set(src, [...(pagesByImage.get(src) ?? []), page.url]);
      }
    }

    const findings: RawFinding[] = [];
    for (const [src, pages] of pagesByImage) {
      const asset = assets.get(src);
      findings.push({
        type: "social_card_issue",
        key: src,
        title: `Social-card image ${displayPath(src)} is broken (${asset?.status || "unreachable"}) on ${pages.length} page${pages.length > 1 ? "s" : ""}`,
        detail: {
          image: src,
          url: src,
          status: asset?.status ?? 0,
          pageCount: pages.length,
          linkedFrom: pages.slice(0, 10),
        },
      });
    }
    return findings;
  },
};

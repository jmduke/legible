import { hasStrongCachePolicy, looksFingerprinted } from "../crawler/assets";
import { displayPath } from "../crawler/url";
import type { RawFinding } from "../findings";
import { hasQueryString, isOwnedPage } from "./guards";
import type { Detector } from "./types";

/** Images larger than this (per Content-Length) get flagged. */
export const OVERSIZED_IMAGE_BYTES = 500_000;

/**
 * Image hygiene, three defects:
 *  - missing alt attributes (per page — alt="" is a valid decorative marker
 *    and is not flagged; only an *absent* attribute is)
 *  - broken internal images (per image, from the post-crawl asset check)
 *  - oversized internal images (per image, Content-Length permitting)
 *  - fingerprinted assets with weak Cache-Control (via post-crawl asset check)
 */
export const imageIssues: Detector = {
  name: "image-issues",
  detect({ crawl, assets }) {
    const findings: RawFinding[] = [];

    for (const page of crawl.pages.values()) {
      // Alt text is a user-facing quality bar, so noindex pages count too.
      if (!isOwnedPage(page) || !page.images?.length) continue;
      if (hasQueryString(page)) continue;
      const missing = page.images.filter((i) => !i.hasAlt);
      if (missing.length === 0) continue;
      findings.push({
        type: "image_issue",
        key: `${page.url} missing_alt`,
        title: `${missing.length} image${missing.length > 1 ? "s" : ""} missing alt text on ${displayPath(page.url)}`,
        detail: {
          url: page.url,
          kind: "missing_alt",
          count: missing.length,
          images: missing.slice(0, 10).map((i) => i.src),
        },
      });
    }

    if (assets) {
      // Assets referenced only as og:image/twitter:image belong to the
      // social-cards detector; flagging them here would double-count.
      const inlineImageUrls = new Set<string>();
      for (const page of crawl.pages.values()) {
        for (const image of page.images ?? []) inlineImageUrls.add(image.src);
      }
      for (const asset of assets.values()) {
        if (!inlineImageUrls.has(asset.url)) continue;
        if (asset.status >= 400 || asset.status === 0) {
          findings.push({
            type: "image_issue",
            key: `${asset.url} broken_image`,
            title: `Broken image ${displayPath(asset.url)} (${asset.status || "unreachable"})`,
            detail: {
              url: asset.url,
              kind: "broken_image",
              status: asset.status,
              linkedFrom: asset.referrers,
            },
          });
        } else if (
          asset.contentLength !== null &&
          asset.contentLength > OVERSIZED_IMAGE_BYTES
        ) {
          findings.push({
            type: "image_issue",
            key: `${asset.url} oversized_image`,
            title: `Oversized image ${displayPath(asset.url)} (${Math.round(asset.contentLength / 1024)} KB)`,
            detail: {
              url: asset.url,
              kind: "oversized_image",
              bytes: asset.contentLength,
              linkedFrom: asset.referrers,
            },
          });
        }
      }
      for (const asset of assets.values()) {
        if (!looksFingerprinted(asset.url)) continue;
        if (asset.status >= 400 || asset.status === 0) continue;
        if (hasStrongCachePolicy(asset.cacheControl)) continue;
        findings.push({
          type: "image_issue",
          key: `${asset.url} poor_cache_policy`,
          title: `Weak Cache-Control on fingerprinted asset ${displayPath(asset.url)}`,
          detail: {
            url: asset.url,
            kind: "poor_cache_policy",
            cacheControl: asset.cacheControl,
            linkedFrom: asset.referrers,
          },
        });
      }
    }

    return findings;
  },
};

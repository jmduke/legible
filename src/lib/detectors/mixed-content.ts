import type { RawFinding } from "../findings";
import { isOwnedPage } from "./guards";
import type { Detector } from "./types";

/**
 * http:// subresources on https pages. Browsers block or warn on these, so
 * they're broken-in-practice regardless of whether the URL still resolves.
 * One finding per insecure resource, with every referencing page as evidence.
 */
export const mixedContent: Detector = {
  name: "mixed-content",
  detect({ crawl }) {
    const referrersByResource = new Map<string, string[]>();
    for (const page of crawl.pages.values()) {
      if (!isOwnedPage(page)) continue;
      for (const resource of page.mixedContent ?? []) {
        referrersByResource.set(resource, [
          ...(referrersByResource.get(resource) ?? []),
          page.url,
        ]);
      }
    }

    const findings: RawFinding[] = [];
    for (const [resource, pages] of referrersByResource) {
      findings.push({
        type: "mixed_content",
        key: resource,
        title: `Insecure (http) resource ${resource} loaded on ${pages.length} https page${pages.length > 1 ? "s" : ""}`,
        detail: { resource, linkedFrom: pages },
      });
    }
    return findings;
  },
};

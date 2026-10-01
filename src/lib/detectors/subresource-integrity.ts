import { displayPath } from "../crawler/url";
import type { RawFinding } from "../findings";
import { hasQueryString, isOwnedPage } from "./guards";
import type { Detector } from "./types";

/**
 * External scripts and stylesheets loaded without a Subresource Integrity hash
 * (specification.website/security/subresource-integrity).
 */
export const subresourceIntegrity: Detector = {
  name: "subresource-integrity",
  detect({ crawl }) {
    const findings: RawFinding[] = [];

    for (const page of crawl.pages.values()) {
      if (!isOwnedPage(page) || !page.externalWithoutSri?.length) continue;
      if (hasQueryString(page)) continue;
      const resources = page.externalWithoutSri;
      findings.push({
        type: "security_issue",
        key: `${page.url} missing_sri`,
        title: `${resources.length} external script/stylesheet${resources.length > 1 ? "s" : ""} without integrity on ${displayPath(page.url)}`,
        detail: {
          url: page.url,
          kind: "missing_sri",
          count: resources.length,
          resources: resources.slice(0, 10),
        },
      });
    }
    return findings;
  },
};

import { displayPath } from "../crawler/url";
import type { RawFinding } from "../findings";
import { isOwnedPage } from "./guards";
import type { Detector } from "./types";

/**
 * Template/encoding debris visible to readers: "[object Object]", unrendered
 * {{variables}}, mojibake, leaf elements containing only "undefined"/"null"/
 * "NaN". These are engineering bugs wearing content clothes.
 */
export const renderingArtifacts: Detector = {
  name: "rendering-artifacts",
  detect({ crawl }) {
    const findings: RawFinding[] = [];
    for (const page of crawl.pages.values()) {
      if (!isOwnedPage(page) || !page.textArtifacts?.length) continue;
      for (const { artifact, sample } of page.textArtifacts) {
        findings.push({
          type: "rendering_artifact",
          key: `${page.url} ${artifact}`,
          title: `Rendering artifact on ${displayPath(page.url)}: ${artifact}`,
          detail: { url: page.url, artifact, sample },
        });
      }
    }
    return findings;
  },
};

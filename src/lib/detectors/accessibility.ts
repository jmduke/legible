import { displayPath } from "../crawler/url";
import type { RawFinding } from "../findings";
import { hasQueryString, isOwnedPage } from "./guards";
import type { Detector } from "./types";

/**
 * WCAG-aligned checks verifiable from static HTML (specification.website
 * accessibility section): skip links, landmarks, link/button names, form
 * labels, duplicate ids, inline language, linked images with empty alt.
 */
export const accessibility: Detector = {
  name: "accessibility",
  detect({ crawl }) {
    const findings: RawFinding[] = [];

    for (const page of crawl.pages.values()) {
      if (!isOwnedPage(page) || !page.a11y) continue;
      if (hasQueryString(page)) continue;
      const path = displayPath(page.url);
      const { a11y } = page;
      const issues: Array<{
        kind: string;
        title: string;
        count?: number;
      }> = [];

      if (!a11y.hasSkipLink) {
        issues.push({
          kind: "missing_skip_link",
          title: `No skip-to-main link on ${path}`,
        });
      }
      if (!a11y.hasMainLandmark) {
        issues.push({
          kind: "missing_main_landmark",
          title: `No <main> landmark on ${path}`,
        });
      }
      if (a11y.emptyLinkCount > 0) {
        issues.push({
          kind: "empty_links",
          title: `${a11y.emptyLinkCount} link${a11y.emptyLinkCount > 1 ? "s" : ""} with no accessible name on ${path}`,
          count: a11y.emptyLinkCount,
        });
      }
      if (a11y.genericLinkCount > 0) {
        issues.push({
          kind: "generic_link_text",
          title: `${a11y.genericLinkCount} link${a11y.genericLinkCount > 1 ? "s" : ""} with generic text ("click here", "read more", …) on ${path}`,
          count: a11y.genericLinkCount,
        });
      }
      if (a11y.unlabeledInputCount > 0) {
        issues.push({
          kind: "unlabeled_inputs",
          title: `${a11y.unlabeledInputCount} form control${a11y.unlabeledInputCount > 1 ? "s" : ""} without a label on ${path}`,
          count: a11y.unlabeledInputCount,
        });
      }
      if (a11y.emptyButtonCount > 0) {
        issues.push({
          kind: "empty_buttons",
          title: `${a11y.emptyButtonCount} button${a11y.emptyButtonCount > 1 ? "s" : ""} with no accessible name on ${path}`,
          count: a11y.emptyButtonCount,
        });
      }
      if (a11y.duplicateIdCount > 0) {
        issues.push({
          kind: "duplicate_ids",
          title: `${a11y.duplicateIdCount} duplicate id attribute${a11y.duplicateIdCount > 1 ? "s" : ""} on ${path}`,
          count: a11y.duplicateIdCount,
        });
      }
      if (a11y.inlineLangMissingCount > 0) {
        issues.push({
          kind: "inline_lang_missing",
          title: `${a11y.inlineLangMissingCount} foreign-language passage${a11y.inlineLangMissingCount > 1 ? "s" : ""} without lang on ${path}`,
          count: a11y.inlineLangMissingCount,
        });
      }
      if (a11y.linkImageEmptyAltCount > 0) {
        issues.push({
          kind: "link_image_empty_alt",
          title: `${a11y.linkImageEmptyAltCount} linked image${a11y.linkImageEmptyAltCount > 1 ? "s" : ""} with empty alt on ${path}`,
          count: a11y.linkImageEmptyAltCount,
        });
      }

      for (const issue of issues) {
        findings.push({
          type: "accessibility_issue",
          key: `${page.url} ${issue.kind}`,
          title: issue.title,
          detail: {
            url: page.url,
            kind: issue.kind,
            count: issue.count,
          },
        });
      }
    }
    return findings;
  },
};

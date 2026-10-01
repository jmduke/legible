import { displayPath } from "../crawler/url";
import type { RawFinding } from "../findings";
import { hasQueryString, isOwnedIndexablePage } from "./guards";
import type { Detector } from "./types";

const TITLE_MAX = 60;
const DESCRIPTION_MAX = 160;

/**
 * Per-page head-tag hygiene, limited to objective defects: a tag that is
 * missing, empty, duplicated within the page, or unparseable. One finding
 * per (page, defect) so each has its own lifecycle.
 */
export const metaTags: Detector = {
  name: "meta-tags",
  detect({ crawl }) {
    const findings: RawFinding[] = [];

    for (const page of crawl.pages.values()) {
      if (!isOwnedIndexablePage(page) || !page.meta) continue;
      if (hasQueryString(page)) continue;
      const path = displayPath(page.url);
      const issues: Array<{
        kind: string;
        title: string;
        extra?: Record<string, unknown>;
      }> = [];

      if (page.meta.title === "") {
        issues.push({
          kind: "missing_title",
          title: `Missing <title> on ${path}`,
        });
      }
      if (page.meta.titleCount > 1) {
        issues.push({
          kind: "multiple_titles",
          title: `${page.meta.titleCount} <title> tags on ${path}`,
          extra: { count: page.meta.titleCount },
        });
      }
      if (page.meta.description === "") {
        issues.push({
          kind: "missing_description",
          title: `Missing meta description on ${path}`,
        });
      }
      if (page.meta.descriptionCount > 1) {
        issues.push({
          kind: "multiple_descriptions",
          title: `${page.meta.descriptionCount} meta descriptions on ${path}`,
          extra: { count: page.meta.descriptionCount },
        });
      }
      if (page.meta.canonicalCount === 0) {
        issues.push({
          kind: "missing_canonical",
          title: `No rel=canonical on ${path}`,
        });
      }
      if (page.meta.title.length > TITLE_MAX) {
        issues.push({
          kind: "title_too_long",
          title: `<title> is ${page.meta.title.length} chars on ${path} (>${TITLE_MAX})`,
          extra: { count: page.meta.title.length },
        });
      }
      if (page.meta.description.length > DESCRIPTION_MAX) {
        issues.push({
          kind: "description_too_long",
          title: `Meta description is ${page.meta.description.length} chars on ${path} (>${DESCRIPTION_MAX})`,
          extra: { count: page.meta.description.length },
        });
      }
      if (page.meta.relativeOgUrl) {
        issues.push({
          kind: "relative_og_url",
          title: `og:url is not an absolute URL on ${path}`,
        });
      }
      if (page.meta.relativeOgImage) {
        issues.push({
          kind: "relative_og_image",
          title: `og:image is not an absolute URL on ${path}`,
        });
      }
      if (page.meta.missingTwitterCard) {
        issues.push({
          kind: "missing_twitter_card",
          title: `Open Graph tags present but no twitter:card on ${path}`,
        });
      }
      if (page.meta.canonicalMalformed) {
        issues.push({
          kind: "malformed_canonical",
          title: `Malformed canonical URL on ${path}`,
        });
      }
      if (page.meta.canonicalCount > 1) {
        issues.push({
          kind: "multiple_canonicals",
          title: `${page.meta.canonicalCount} canonical tags on ${path}`,
          extra: { count: page.meta.canonicalCount },
        });
      }
      if (page.meta.h1Count === 0) {
        issues.push({ kind: "missing_h1", title: `No <h1> on ${path}` });
      }
      if (page.meta.h1Count > 1) {
        issues.push({
          kind: "multiple_h1s",
          title: `${page.meta.h1Count} <h1> tags on ${path}`,
          extra: { count: page.meta.h1Count },
        });
      }
      if (page.meta.langMissing) {
        issues.push({
          kind: "missing_lang",
          title: `<html> missing lang attribute on ${path}`,
        });
      }
      if (!page.meta.hasDoctype) {
        issues.push({
          kind: "missing_doctype",
          title: `No <!doctype html> on ${path} (quirks mode)`,
        });
      }
      if (!page.meta.hasCharset) {
        issues.push({
          kind: "missing_charset",
          title: `No charset declaration on ${path}`,
        });
      }
      if (!page.meta.hasViewport) {
        issues.push({
          kind: "missing_viewport",
          title: `No meta viewport on ${path} (broken mobile rendering)`,
        });
      }
      if (page.meta.headingSkip) {
        issues.push({
          kind: "heading_skip",
          title: `Heading hierarchy skips a level on ${path} (${page.meta.headingSkip})`,
          extra: { skip: page.meta.headingSkip },
        });
      }
      if (page.meta.viewportBlocksZoom) {
        issues.push({
          kind: "viewport_blocks_zoom",
          title: `Viewport disables pinch-zoom on ${path}`,
        });
      }
      if (!page.meta.hasThemeColor) {
        issues.push({
          kind: "missing_theme_color",
          title: `No meta theme-color on ${path}`,
        });
      }
      if (!page.meta.hasColorScheme) {
        issues.push({
          kind: "missing_color_scheme",
          title: `No meta color-scheme on ${path}`,
        });
      }
      if (!page.meta.hasOgTitle) {
        issues.push({
          kind: "missing_og_title",
          title: `Missing og:title on ${path}`,
        });
      }
      if (!page.meta.hasOgDescription) {
        issues.push({
          kind: "missing_og_description",
          title: `Missing og:description on ${path}`,
        });
      }
      if (!page.meta.hasOgUrl) {
        issues.push({
          kind: "missing_og_url",
          title: `Missing og:url on ${path}`,
        });
      }
      if (!page.meta.hasOgType) {
        issues.push({
          kind: "missing_og_type",
          title: `Missing og:type on ${path}`,
        });
      }
      if (!page.meta.hasOgImage) {
        issues.push({
          kind: "missing_og_image",
          title: `Missing og:image on ${path}`,
        });
      }

      for (const issue of issues) {
        findings.push({
          type: "meta_tag_issue",
          key: `${page.url} ${issue.kind}`,
          title: issue.title,
          detail: { url: page.url, kind: issue.kind, ...issue.extra },
        });
      }
    }
    return findings;
  },
};

import type { RawFinding } from "../findings";
import { accessibility } from "./accessibility";
import { breadcrumbs } from "./breadcrumbs";
import { brokenAnchors } from "./broken-anchors";
import { brokenLinks } from "./broken-links";
import { canonicalIssues } from "./canonical-issues";
import { deepPages } from "./deep-pages";
import { duplicateMeta } from "./duplicate-meta";
import { externalLinks } from "./external-links";
import { hreflang } from "./hreflang";
import { imageIssues } from "./image-issues";
import { metaTags } from "./meta-tags";
import { missingFromSitemap } from "./missing-from-sitemap";
import { mixedContent } from "./mixed-content";
import { notIndexed } from "./not-indexed";
import { orphanPages } from "./orphan-pages";
import { performanceHints } from "./performance-hints";
import { redirectChains } from "./redirect-chains";
import { renderingArtifacts } from "./rendering-artifacts";
import { sitemapMismatch } from "./sitemap-mismatch";
import { slowPages } from "./slow-pages";
import { socialCards } from "./social-cards";
import { soft404s } from "./soft-404";
import { stagingLeaks } from "./staging-leaks";
import { structuredData } from "./structured-data";
import { subresourceIntegrity } from "./subresource-integrity";
import type { DetectionContext, Detector } from "./types";
import { webVitals } from "./web-vitals";

export const detectors: Detector[] = [
  brokenLinks,
  brokenAnchors,
  redirectChains,
  orphanPages,
  sitemapMismatch,
  missingFromSitemap,
  metaTags,
  duplicateMeta,
  canonicalIssues,
  imageIssues,
  performanceHints,
  socialCards,
  structuredData,
  breadcrumbs,
  mixedContent,
  stagingLeaks,
  renderingArtifacts,
  soft404s,
  deepPages,
  hreflang,
  slowPages,
  webVitals,
  externalLinks,
  notIndexed,
  accessibility,
  subresourceIntegrity,
];

export function runDetectors(ctx: DetectionContext): RawFinding[] {
  return detectors.flatMap((d) => d.detect(ctx));
}

export type { DetectionContext, Detector };

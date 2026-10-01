import { displayPath } from "../crawler/url";
import type { FindingType, RawFinding } from "../findings";
import { truncate } from "../text";

export const TYPE_LABELS: Record<FindingType, string> = {
  broken_internal_link: "Broken links",
  redirect_chain: "Redirect chains",
  orphan_page: "Orphan pages",
  sitemap_broken_url: "Sitemap problems",
  missing_from_sitemap: "Missing from sitemap",
  meta_tag_issue: "Meta tag issues",
  duplicate_meta: "Duplicate titles/descriptions",
  image_issue: "Image issues",
  mixed_content: "Mixed content",
  hreflang_issue: "hreflang problems",
  slow_page: "Slow pages",
  canonical_issue: "Canonical problems",
  social_card_issue: "Broken social cards",
  structured_data_issue: "Malformed structured data",
  deep_page: "Deep pages",
  feed_issue: "Feed problems",
  broken_anchor: "Broken anchors",
  rendering_artifact: "Rendering artifacts",
  staging_leak: "Staging/localhost leaks",
  soft_404: "Soft 404s",
  broken_external_link: "Dead outbound links",
  site_issue: "Site configuration",
  core_web_vitals: "Poor Core Web Vitals",
  not_indexed: "Not indexed by Google",
  accessibility_issue: "Accessibility issues",
  security_issue: "Security issues",
};

/**
 * Relative urgency per finding type — the single source of truth for color
 * coding everywhere: bad = red (fix now), warn = yellow (should fix),
 * neutral = green (informational).
 */
export const TYPE_SEVERITY: Record<FindingType, "bad" | "warn" | "neutral"> = {
  broken_internal_link: "bad",
  mixed_content: "bad",
  redirect_chain: "warn",
  sitemap_broken_url: "warn",
  meta_tag_issue: "warn",
  duplicate_meta: "warn",
  image_issue: "warn",
  hreflang_issue: "warn",
  slow_page: "warn",
  missing_from_sitemap: "neutral",
  orphan_page: "neutral",
  not_indexed: "neutral",
  canonical_issue: "warn",
  social_card_issue: "warn",
  structured_data_issue: "warn",
  deep_page: "neutral",
  feed_issue: "warn",
  broken_anchor: "warn",
  rendering_artifact: "bad",
  staging_leak: "bad",
  soft_404: "warn",
  broken_external_link: "warn",
  site_issue: "warn",
  core_web_vitals: "warn",
  accessibility_issue: "warn",
  security_issue: "warn",
};

/** Display order for grouped output (most urgent classes first). */
export const TYPE_ORDER: FindingType[] = [
  "broken_internal_link",
  "broken_anchor",
  "rendering_artifact",
  "staging_leak",
  "mixed_content",
  "redirect_chain",
  "sitemap_broken_url",
  "missing_from_sitemap",
  "orphan_page",
  "meta_tag_issue",
  "accessibility_issue",
  "security_issue",
  "duplicate_meta",
  "canonical_issue",
  "image_issue",
  "social_card_issue",
  "structured_data_issue",
  "soft_404",
  "deep_page",
  "feed_issue",
  "broken_external_link",
  "hreflang_issue",
  "slow_page",
  "core_web_vitals",
  "site_issue",
  "not_indexed",
];

export function groupByType(
  findings: RawFinding[],
): Map<FindingType, RawFinding[]> {
  const byType = new Map<FindingType, RawFinding[]>();
  for (const type of TYPE_ORDER) {
    const group = findings.filter((f) => f.type === type);
    if (group.length > 0) byType.set(type, group);
  }
  return byType;
}

/** Pages that link to / reference the finding's subject, when known. */
export function findingReferrers(f: RawFinding): string[] {
  return "linkedFrom" in f.detail ? (f.detail.linkedFrom ?? []) : [];
}

/**
 * Compact, section-local row label. Rows live under a typed section header,
 * so repeating the type ("Broken link to …") is noise — show only what
 * distinguishes this finding: the subject, plus a muted qualifier.
 */
export function rowLabel(f: RawFinding): { main: string; qualifier: string } {
  switch (f.type) {
    case "broken_internal_link":
      return {
        main: displayPath(f.detail.url),
        qualifier: String(f.detail.status || "unreachable"),
      };
    case "redirect_chain": {
      const hops = f.detail.chain.length - 1;
      return {
        main: displayPath(f.detail.url),
        qualifier: f.detail.loop
          ? "redirect loop"
          : `${hops} hops → ${displayPath(f.detail.finalUrl)}`,
      };
    }
    case "orphan_page":
      return { main: displayPath(f.detail.url), qualifier: "no inbound links" };
    case "sitemap_broken_url":
      return {
        main: displayPath(f.detail.url),
        qualifier:
          f.detail.problem === "redirect"
            ? `redirects → ${displayPath(f.detail.finalUrl ?? "")}`
            : f.detail.problem === "noindex"
              ? "noindexed"
              : `dead (${f.detail.status || "unreachable"})`,
      };
    case "missing_from_sitemap": {
      const n = f.detail.linkedFrom.length;
      return {
        main: displayPath(f.detail.url),
        qualifier: `linked from ${n} page${n === 1 ? "" : "s"}`,
      };
    }
    case "meta_tag_issue":
      return {
        main: displayPath(f.detail.url),
        qualifier: f.detail.kind.replaceAll("_", " "),
      };
    case "duplicate_meta":
      return {
        main: `“${truncate(f.detail.value, 60)}”`,
        qualifier: `${f.detail.field} on ${f.detail.pageCount} pages`,
      };
    case "image_issue": {
      if (f.detail.kind === "oversized_image")
        return {
          main: displayPath(f.detail.url),
          qualifier: `${Math.round((f.detail.bytes ?? 0) / 1024)} KB`,
        };
      if (f.detail.kind === "broken_image")
        return {
          main: displayPath(f.detail.url),
          qualifier: `broken (${f.detail.status || "unreachable"})`,
        };
      if (f.detail.kind === "lazy_lcp_candidate")
        return {
          main: displayPath(f.detail.url),
          qualifier: "first image lazy-loaded",
        };
      if (f.detail.kind === "poor_cache_policy")
        return {
          main: displayPath(f.detail.url),
          qualifier: f.detail.cacheControl ?? "no Cache-Control",
        };
      return {
        main: displayPath(f.detail.url),
        qualifier: `${f.detail.count} missing alt`,
      };
    }
    case "mixed_content": {
      const n = f.detail.linkedFrom.length;
      return {
        main: f.detail.resource,
        qualifier: `on ${n} page${n === 1 ? "" : "s"}`,
      };
    }
    case "hreflang_issue":
      return {
        main: displayPath(f.detail.page),
        qualifier: `→ ${displayPath(f.detail.declares)} not reciprocated`,
      };
    case "slow_page":
      return {
        main: displayPath(f.detail.url),
        qualifier: `${(f.detail.ttfbMs / 1000).toFixed(1)}s TTFB`,
      };
    case "canonical_issue":
      return {
        main: displayPath(f.detail.url),
        qualifier: f.detail.kind.replace("canonical_", "").replaceAll("_", " "),
      };
    case "social_card_issue": {
      const n = f.detail.pageCount;
      return {
        main: displayPath(f.detail.image),
        qualifier: `og:image ${f.detail.status || "unreachable"} on ${n} page${n === 1 ? "" : "s"}`,
      };
    }
    case "structured_data_issue":
      return {
        main: displayPath(f.detail.url),
        qualifier: f.detail.kind
          ? f.detail.kind.replaceAll("_", " ")
          : `${f.detail.count} invalid JSON-LD`,
      };
    case "deep_page":
      return {
        main: displayPath(f.detail.url),
        qualifier: `${f.detail.depth} clicks deep`,
      };
    case "feed_issue":
      return { main: f.detail.url, qualifier: f.detail.problem };
    case "broken_anchor":
      return {
        main: `${displayPath(f.detail.url)}#${f.detail.fragment}`,
        qualifier: "no such id",
      };
    case "rendering_artifact":
      return { main: displayPath(f.detail.url), qualifier: f.detail.artifact };
    case "staging_leak": {
      const n = f.detail.linkedFrom.length;
      return {
        main: f.detail.resource,
        qualifier: `on ${n} page${n === 1 ? "" : "s"}`,
      };
    }
    case "soft_404":
      return {
        main: displayPath(f.detail.url),
        qualifier: `titled "${truncate(f.detail.pageTitle ?? "", 40)}"`,
      };
    case "broken_external_link":
      return f.detail.kind === "youtube_embed"
        ? {
            main: `youtube:${f.detail.videoId}`,
            qualifier: "video unavailable",
          }
        : {
            main: f.detail.url,
            qualifier: String(f.detail.status || "no DNS"),
          };
    case "site_issue":
      return {
        main: f.detail.kind.replaceAll("_", " "),
        qualifier: f.detail.url ? displayPath(f.detail.url) : "",
      };
    case "core_web_vitals": {
      const value =
        f.detail.metric === "lcp"
          ? `${(f.detail.p75 / 1000).toFixed(1)}s`
          : f.detail.metric === "inp"
            ? `${f.detail.p75}ms`
            : f.detail.p75.toFixed(2);
      return {
        main: f.detail.url ? displayPath(f.detail.url) : "site-wide",
        qualifier: `${f.detail.metric.toUpperCase()} ${value} p75`,
      };
    }
    case "not_indexed":
      return {
        main: displayPath(f.detail.url),
        qualifier: f.detail.coverageState ?? f.detail.verdict,
      };
    case "accessibility_issue":
      return {
        main: displayPath(f.detail.url),
        qualifier: f.detail.kind.replaceAll("_", " "),
      };
    case "security_issue":
      return {
        main: displayPath(f.detail.url),
        qualifier: f.detail.kind.replaceAll("_", " "),
      };
  }
}

/** One-paragraph, self-contained repair instruction per finding. */
export function fixInstruction(f: RawFinding): string {
  switch (f.type) {
    case "broken_internal_link": {
      const referrers = f.detail.linkedFrom;
      return (
        `The URL ${f.detail.url} returns ${f.detail.status || "a network error"}. ` +
        `Either restore that page or update the link on ${referrers.length} referring page(s) ` +
        `(${referrers.join(", ")}) to point somewhere valid. If the content moved, add a redirect.`
      );
    }
    case "redirect_chain":
      return (
        `Links to ${f.detail.url} bounce through ${f.detail.chain.length - 1} redirects ` +
        `before landing on ${f.detail.finalUrl}. Update the referring pages to link directly to the ` +
        `final URL, and collapse the intermediate redirects into a single hop.`
      );
    case "orphan_page":
      return (
        `${f.detail.url} is live and in the sitemap but nothing links to it. ` +
        `Either add internal links from relevant pages (index/category pages are good candidates) ` +
        `or, if the page is obsolete, remove it from the sitemap and retire it.`
      );
    case "sitemap_broken_url":
      if (f.detail.problem === "redirect")
        return `The sitemap lists ${f.detail.url}, which redirects. ${f.detail.suggestion ?? ""}`;
      if (f.detail.problem === "noindex")
        return `The sitemap lists ${f.detail.url}, which is noindexed. ${f.detail.suggestion ?? ""}`;
      return (
        `The sitemap lists ${f.detail.url}, which is dead (${f.detail.status || "unreachable"}). ` +
        `Remove it from the sitemap or restore the page.`
      );
    case "missing_from_sitemap":
      return (
        `${f.detail.url} is live, indexable, and linked internally, but the sitemap doesn't list it. ` +
        `Add it to the sitemap — or, if it shouldn't be indexed, mark it noindex (and consider whether it should be linked at all).`
      );
    case "meta_tag_issue":
      return (
        `${f.detail.url} has a head-tag defect: ${f.detail.kind.replaceAll("_", " ")}. ` +
        `Fix the template or page frontmatter so the page has a doctype, charset, viewport, exactly one ` +
        `non-empty title, one meta description, one valid canonical, one h1 (with no skipped heading ` +
        `levels), and a lang attribute on <html>.`
      );
    case "duplicate_meta":
      return (
        `${f.detail.pageCount} pages share the identical ${f.detail.field} ("${f.detail.value}"): ` +
        `${f.detail.pages.join(", ")}${f.detail.pagesTruncated ? ", …" : ""}. ` +
        `Give each page a distinct, descriptive ${f.detail.field} (usually via the page template's data rather than page-by-page edits).`
      );
    case "image_issue": {
      if (f.detail.kind === "broken_image") {
        return (
          `The image ${f.detail.url} returns ${f.detail.status || "a network error"} but is referenced by ` +
          `${(f.detail.linkedFrom ?? []).join(", ")}. Restore the file or update those pages to a valid image.`
        );
      }
      if (f.detail.kind === "oversized_image") {
        return (
          `${f.detail.url} weighs ${Math.round((f.detail.bytes ?? 0) / 1024)} KB. ` +
          `Recompress it (or serve a resized/webp variant) — referenced by ${(f.detail.linkedFrom ?? []).join(", ")}.`
        );
      }
      if (f.detail.kind === "lazy_lcp_candidate") {
        return (
          `The first content image on ${f.detail.url} uses loading="lazy", which often delays LCP. ` +
          `Remove lazy-loading from above-the-fold hero images (${(f.detail.images ?? []).join(", ")}).`
        );
      }
      if (f.detail.kind === "poor_cache_policy") {
        return (
          `Fingerprinted asset ${f.detail.url} has weak caching (${f.detail.cacheControl ?? "none"}). ` +
          `Send Cache-Control: public, max-age=31536000, immutable for hashed static files.`
        );
      }
      return (
        `${f.detail.count} <img> tags on ${f.detail.url} have no alt attribute (first few: ` +
        `${(f.detail.images ?? []).join(", ")}). Add descriptive alt text, or alt="" if purely decorative.`
      );
    }
    case "mixed_content":
      return (
        `The insecure resource ${f.detail.resource} is loaded over http on the https page(s) ` +
        `${f.detail.linkedFrom.join(", ")}. Browsers block or downgrade this — change the ` +
        `reference to https (or a protocol-relative/relative URL).`
      );
    case "hreflang_issue":
      return (
        `${f.detail.page} declares ${f.detail.declares} as its ${f.detail.declaredLang} alternate, but that page ` +
        `doesn't declare a reciprocal hreflang back. Add the return annotation or remove the one-way pair — ` +
        `search engines ignore non-reciprocal hreflang.`
      );
    case "slow_page":
      return (
        `${f.detail.url} took ${(f.detail.ttfbMs / 1000).toFixed(1)}s to return response headers during the ` +
        `crawl. Investigate server-side latency for this route (caching, queries, cold starts); re-scan to confirm ` +
        `it wasn't a one-off.`
      );
    case "canonical_issue":
      return (
        `${f.detail.url} has a canonical problem (${f.detail.kind.replaceAll("_", " ")}): it points at ` +
        `${f.detail.canonical}. ${f.detail.suggestion ?? f.detail.note ?? "Point the canonical at the page's own live, indexable URL."}`
      );
    case "social_card_issue":
      return (
        `The og:image/twitter:image ${f.detail.image} returns ${f.detail.status || "a network error"} and is used by ` +
        `${f.detail.pageCount} page(s) (${f.detail.linkedFrom.join(", ")}) — shares of those pages render ` +
        `a blank card. Fix the image URL or restore the file.`
      );
    case "structured_data_issue":
      return (
        `${f.detail.count} JSON-LD issue(s) on ${f.detail.url} (${f.detail.kind ?? "parse error"}): ` +
        `${f.detail.note}. Fix the template or CMS field that emits structured data.`
      );
    case "deep_page":
      return (
        `${f.detail.url} is ${f.detail.depth} clicks from the homepage. Add links from shallower, related pages ` +
        `(category/index pages are good candidates) so crawlers and users can reach it.`
      );
    case "feed_issue":
      return (
        `The feed ${f.detail.url} is advertised in page <link> tags but is ${f.detail.problem} ` +
        `${f.detail.status ? `(${f.detail.status})` : ""}. Fix the feed endpoint or remove the advertisement.`
      );
    case "broken_anchor":
      return (
        `Links to ${f.detail.url}#${f.detail.fragment} (from ${f.detail.linkedFrom.join(", ")}) point at ` +
        `an id that doesn't exist on the target page. Fix the fragment, or add id="${f.detail.fragment}" to the intended heading.`
      );
    case "rendering_artifact":
      return (
        `${f.detail.url} shows "${f.detail.artifact}" in rendered text (sample: "${f.detail.sample}"). ` +
        `This is template or encoding debris — find the interpolation that produced it and fix the underlying value.`
      );
    case "staging_leak":
      return (
        `${f.detail.resource} — a localhost/staging/preview URL — is referenced from ${f.detail.linkedFrom.join(", ")}. ` +
        `Replace it with the production URL.`
      );
    case "soft_404":
      return (
        `${f.detail.url} returns HTTP 200 but titles itself "${f.detail.pageTitle}". Either make it return a real 404/410 ` +
        `status, or fix whatever is rendering an error page at a live URL.`
      );
    case "broken_external_link":
      return f.detail.kind === "youtube_embed"
        ? `The YouTube video ${f.detail.videoId} embedded on ${f.detail.linkedFrom.join(", ")} is deleted or private. Replace or remove the embed.`
        : `The outbound link ${f.detail.url} (on ${f.detail.linkedFrom.join(", ")}) is dead (${f.detail.status || "domain doesn't resolve"}). Link to an archived copy or remove it.`;
    case "site_issue":
      return (
        f.detail.suggestion ??
        f.detail.note ??
        `Fix the site-level configuration issue: ${f.detail.kind.replaceAll("_", " ")}.`
      );
    case "core_web_vitals": {
      const advice =
        f.detail.metric === "lcp"
          ? "Optimize the largest above-the-fold element: compress/preload the hero image, cut render-blocking resources, improve TTFB."
          : f.detail.metric === "inp"
            ? "Break up long main-thread tasks and heavy event handlers; defer non-critical JavaScript."
            : "Reserve space for images/embeds/ads (explicit dimensions) and avoid injecting content above existing content.";
      return (
        `Real Chrome users experience poor ${f.detail.metric.toUpperCase()} ` +
        `(p75 ${f.detail.p75}${f.detail.metric === "cls" ? "" : "ms"}, poor threshold ${f.detail.poorThreshold}) ` +
        `${f.detail.url ? `on ${f.detail.url}` : "across the site"}. ${advice}`
      );
    }
    case "not_indexed":
      return (
        `Google reports ${f.detail.url} as not indexed (${f.detail.coverageState ?? f.detail.verdict}). ` +
        `Check for noindex directives, canonical tags pointing elsewhere, or thin content; ` +
        `then request re-indexing in Search Console.`
      );
    case "accessibility_issue":
      return (
        `${f.detail.url} has an accessibility defect: ${f.detail.kind.replaceAll("_", " ")}` +
        `${f.detail.count ? ` (${f.detail.count} instance${f.detail.count === 1 ? "" : "s"})` : ""}. ` +
        `Fix the page template so keyboard and screen-reader users can navigate and understand controls.`
      );
    case "security_issue":
      if (f.detail.kind === "missing_sri") {
        return (
          `${f.detail.url} loads ${f.detail.count} external script/stylesheet(s) without Subresource Integrity: ` +
          `${(f.detail.resources ?? []).join(", ")}. Add integrity hashes so tampered CDN files are rejected.`
        );
      }
      return `Fix the security issue on ${f.detail.url}: ${f.detail.kind.replaceAll("_", " ")}.`;
  }
}

import { createHash } from "node:crypto";

/** Single source of truth — the DB enum and TS union both derive from this. */
export const FINDING_TYPES = [
  "broken_internal_link",
  "redirect_chain",
  "orphan_page",
  "sitemap_broken_url",
  "missing_from_sitemap",
  "meta_tag_issue",
  "duplicate_meta",
  "image_issue",
  "mixed_content",
  "hreflang_issue",
  "slow_page",
  "canonical_issue",
  "social_card_issue",
  "structured_data_issue",
  "deep_page",
  "feed_issue",
  "broken_anchor",
  "rendering_artifact",
  "staging_leak",
  "soft_404",
  "broken_external_link",
  "site_issue",
  "core_web_vitals",
  "not_indexed",
  "accessibility_issue",
  "security_issue",
] as const;

export type FindingType = (typeof FINDING_TYPES)[number];

/**
 * Per-type evidence shapes. Renderers and destinations narrow on
 * `finding.type` and get the matching detail for free — no casts.
 */
export interface FindingDetailMap {
  broken_internal_link: {
    url: string;
    status: number;
    error?: string;
    linkedFrom: string[];
  };
  redirect_chain: {
    url: string;
    chain: string[];
    finalUrl: string;
    finalStatus: number;
    loop: boolean;
    linkedFrom: string[];
  };
  orphan_page: { url: string; inSitemap: boolean; note: string };
  sitemap_broken_url: {
    url: string;
    problem: "dead" | "redirect" | "noindex";
    status?: number;
    error?: string;
    finalUrl?: string;
    suggestion?: string;
  };
  missing_from_sitemap: { url: string; linkedFrom: string[]; note: string };
  meta_tag_issue: { url: string; kind: string; count?: number; skip?: string };
  duplicate_meta: {
    field: "title" | "description";
    value: string;
    pageCount: number;
    pages: string[];
    pagesTruncated: boolean;
  };
  image_issue: {
    url: string;
    kind:
      | "missing_alt"
      | "broken_image"
      | "oversized_image"
      | "lazy_lcp_candidate"
      | "poor_cache_policy";
    count?: number;
    images?: string[];
    status?: number;
    bytes?: number;
    linkedFrom?: string[];
    cacheControl?: string | null;
  };
  mixed_content: { resource: string; linkedFrom: string[] };
  hreflang_issue: {
    page: string;
    declares: string;
    declaredLang: string;
    note: string;
  };
  slow_page: { url: string; ttfbMs: number; note: string };
  canonical_issue: {
    url: string;
    canonical: string;
    kind:
      | "canonical_offsite"
      | "canonical_to_dead"
      | "canonical_to_redirect"
      | "canonical_to_noindex";
    canonicalStatus?: number;
    resolvesTo?: string;
    note?: string;
    suggestion?: string;
  };
  social_card_issue: {
    image: string;
    url: string;
    status: number;
    pageCount: number;
    linkedFrom: string[];
  };
  structured_data_issue: {
    url: string;
    kind?: string;
    count: number;
    note: string;
    issues?: string[];
  };
  deep_page: { url: string; depth: number; note: string };
  feed_issue: {
    url: string;
    problem: "dead" | "invalid" | "unreachable";
    status?: number;
    error?: string;
    linkedFrom: string[];
  };
  broken_anchor: { url: string; fragment: string; linkedFrom: string[] };
  rendering_artifact: { url: string; artifact: string; sample: string };
  staging_leak: { resource: string; linkedFrom: string[] };
  soft_404: { url: string; pageTitle?: string; linkedFrom: string[] };
  broken_external_link:
    | {
        kind: "link";
        url: string;
        status: number;
        error?: string;
        linkedFrom: string[];
      }
    | {
        kind: "youtube_embed";
        videoId: string;
        oembedStatus: number;
        linkedFrom: string[];
      };
  site_issue: {
    kind: string;
    url?: string;
    note?: string;
    suggestion?: string;
    count?: number;
    examples?: string[];
    expiresAt?: string;
    daysLeft?: number;
  };
  core_web_vitals: {
    url?: string;
    scope: "url" | "origin";
    metric: "lcp" | "inp" | "cls";
    p75: number;
    poorThreshold: number;
    note: string;
  };
  not_indexed: { url: string; verdict: string; coverageState: string | null };
  accessibility_issue: {
    url: string;
    kind: string;
    count?: number;
  };
  security_issue: {
    url: string;
    kind: string;
    resources?: string[];
    count?: number;
  };
}

/** Any finding's detail, for storage layers that hold all types (jsonb). */
export type FindingDetail = FindingDetailMap[FindingType];

/**
 * A normalized, destination-agnostic work item — a discriminated union over
 * `type`. Everything an engineer (or an LLM) needs to fix the problem lives
 * in `detail`; `fingerprint` is stable across scans so downstream systems can
 * dedupe and track lifecycle.
 */
export type RawFinding = {
  [K in FindingType]: {
    type: K;
    /** One-line summary, e.g. "Broken link to /pricing-old (404)" */
    title: string;
    /** The canonical identity of the problem — used for fingerprinting. */
    key: string;
    detail: FindingDetailMap[K];
  };
}[FindingType];

export function fingerprint(finding: {
  type: FindingType;
  key: string;
}): string {
  return createHash("sha256")
    .update(`${finding.type}\0${finding.key}`)
    .digest("hex")
    .slice(0, 16);
}

/** The kind/problem/field sub-discriminator a finding carries, if any. */
export function findingKind(f: RawFinding): string | undefined {
  if ("kind" in f.detail) return f.detail.kind;
  if ("problem" in f.detail) return f.detail.problem;
  if ("field" in f.detail) return f.detail.field;
  return undefined;
}

/** Type-narrowing filter: findings of one type with their detail narrowed. */
export function findingsOfType<K extends FindingType>(
  findings: RawFinding[],
  type: K,
): Extract<RawFinding, { type: K }>[] {
  return findings.filter(
    (f): f is Extract<RawFinding, { type: K }> => f.type === type,
  );
}

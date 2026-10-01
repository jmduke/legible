/**
 * Chrome UX Report (CrUX): Google's field data from real Chrome users — the
 * same Core Web Vitals that feed search ranking. No OAuth; just a free API
 * key (Google Cloud Console -> enable "Chrome UX Report API").
 *
 * Coverage is popularity-gated: most URLs on most sites have no per-URL
 * record (the API answers 404), so we sample the most-linked pages and fall
 * back to the origin-level record for a site-wide verdict.
 */
import type { CrawlResult } from "../crawler";

const CRUX_ENDPOINT =
  "https://chromeuxreport.googleapis.com/v1/records:queryRecord";
const MAX_URLS_SAMPLED = 25;
const CONCURRENCY = 5;

export interface CruxRecord {
  /** "url" for a per-page record, "origin" for the site-wide fallback. */
  scope: "url" | "origin";
  /** p75 Largest Contentful Paint, ms. */
  lcpMs?: number;
  /** p75 Interaction to Next Paint, ms. */
  inpMs?: number;
  /** p75 Cumulative Layout Shift (unitless). */
  cls?: number;
}

export type CruxData = Map<string, CruxRecord>;

/** Sentinel key for the origin-level record in a CruxData map. */
export const CRUX_ORIGIN_KEY = "__origin__";

interface CruxApiMetrics {
  largest_contentful_paint?: { percentiles?: { p75?: number | string } };
  interaction_to_next_paint?: { percentiles?: { p75?: number | string } };
  cumulative_layout_shift?: { percentiles?: { p75?: number | string } };
}

function parseMetrics(
  metrics: CruxApiMetrics | undefined,
  scope: "url" | "origin",
): CruxRecord | null {
  if (!metrics) return null;
  const p75 = (m?: { percentiles?: { p75?: number | string } }) => {
    const raw = m?.percentiles?.p75;
    if (raw === undefined) return undefined;
    const n = Number(raw); // CLS arrives as a string
    return Number.isNaN(n) ? undefined : n;
  };
  const record: CruxRecord = {
    scope,
    lcpMs: p75(metrics.largest_contentful_paint),
    inpMs: p75(metrics.interaction_to_next_paint),
    cls: p75(metrics.cumulative_layout_shift),
  };
  if (
    record.lcpMs === undefined &&
    record.inpMs === undefined &&
    record.cls === undefined
  ) {
    return null;
  }
  return record;
}

async function queryRecord(
  apiKey: string,
  body: { url: string } | { origin: string },
  fetchImpl: typeof fetch,
): Promise<CruxApiMetrics | undefined> {
  try {
    const res = await fetchImpl(`${CRUX_ENDPOINT}?key=${apiKey}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      // 404 = CrUX has no data for this URL/origin; anything else we also
      // treat as "no data" rather than failing the scan.
      await res.body?.cancel();
      return undefined;
    }
    const json = (await res.json()) as {
      record?: { metrics?: CruxApiMetrics };
    };
    return json.record?.metrics;
  } catch {
    return undefined;
  }
}

/** The most-linked crawled pages: likeliest to have per-URL CrUX records. */
export function sampleUrls(
  crawl: CrawlResult,
  limit = MAX_URLS_SAMPLED,
): string[] {
  return [...crawl.pages.values()]
    .filter(
      (p) =>
        p.status === 200 &&
        !p.noFollow &&
        p.redirectHops.length === 0 &&
        p.contentType?.includes("text/html") &&
        new URL(p.url).search === "",
    )
    .sort((a, b) => b.referrers.length - a.referrers.length)
    .slice(0, limit)
    .map((p) => p.url);
}

export async function fetchCruxData(
  origin: string,
  crawl: CrawlResult,
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<CruxData> {
  const data: CruxData = new Map();

  const urls = sampleUrls(crawl);
  let index = 0;
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (index < urls.length) {
        const url = urls[index++];
        const metrics = await queryRecord(apiKey, { url }, fetchImpl);
        const record = parseMetrics(metrics, "url");
        if (record) data.set(url, record);
      }
    }),
  );

  const originMetrics = await queryRecord(apiKey, { origin }, fetchImpl);
  const originRecord = parseMetrics(originMetrics, "origin");
  if (originRecord) data.set(CRUX_ORIGIN_KEY, originRecord);

  return data;
}

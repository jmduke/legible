import { type CrawlResult, checkAssets, crawlSite } from "../crawler";
import { checkExternal } from "../crawler/external";
import { runDetectors } from "../detectors";
import type { DetectionContext } from "../detectors/types";
import type { RawFinding } from "../findings";
import { runSiteChecks } from "../sitechecks";
import { fetchSitemapEntries, type SitemapEntry } from "../sitemap";
import { fetchCruxData } from "../sources/crux";

export interface FullScanOptions {
  origin: string;
  maxPages?: number;
  noFollowPatterns?: RegExp[];
  /** Pre-fetched sitemap entries (e.g. via GSC); /sitemap.xml when omitted. */
  sitemapEntries?: SitemapEntry[];
  /** GSC URL-inspection results, when the caller has them. */
  inspections?: DetectionContext["inspections"];
  fetchImpl?: typeof fetch;
  /** Injectable TLS expiry check (tests); real TLS peek when omitted. */
  certExpiry?: (host: string) => Promise<Date | null>;
  /** CrUX API key; field-data vitals checks are skipped without one. */
  cruxApiKey?: string;
  /** Progress messages for interactive callers (CLI). */
  onProgress?: (message: string) => void;
}

export interface FullScanStats {
  pagesCrawled: number;
  sitemapUrls: number;
  assetsChecked: number;
  externalChecked: number;
  durationMs: number;
}

export interface FullScanResult {
  findings: RawFinding[];
  crawl: CrawlResult;
  stats: FullScanStats;
}

/**
 * The one canonical scan recipe: sitemap -> crawl -> asset/external checks ->
 * site checks -> detectors. Both the CLI and the worker pipeline call this;
 * anything scan-shaped that only one of them does is a bug waiting to drift.
 */
export async function runFullScan(
  options: FullScanOptions,
): Promise<FullScanResult> {
  const {
    origin,
    maxPages,
    noFollowPatterns,
    inspections,
    fetchImpl = fetch,
    onProgress = () => {},
  } = options;
  const started = Date.now();

  const sitemapEntries =
    options.sitemapEntries ??
    (await fetchSitemapEntries(
      new URL("/sitemap.xml", origin).toString(),
      fetchImpl,
    ));
  const sitemapUrls = sitemapEntries.map((e) => e.url);
  onProgress(`sitemap ${sitemapUrls.length} URLs`);

  const crawlStarted = Date.now();
  const crawl = await crawlSite({
    origin,
    seeds: sitemapUrls,
    maxPages,
    noFollowPatterns,
    fetchImpl,
  });
  onProgress(
    `crawled ${crawl.pagesCrawled} pages in ${((Date.now() - crawlStarted) / 1000).toFixed(1)}s`,
  );
  if (crawl.budgetExhausted) {
    onProgress(
      `⚠ page budget exhausted — orphan detection skipped; raise the page budget for full coverage`,
    );
  }

  const assets = await checkAssets(crawl, fetchImpl);
  onProgress(`checked ${assets.size} image assets`);
  const external = await checkExternal(crawl, fetchImpl);
  onProgress(
    `checked ${external.links.size} external links, ${external.youtube.size} embeds`,
  );
  const siteFindings = await runSiteChecks({
    origin,
    crawl,
    sitemapEntries,
    fetchImpl,
    certExpiry: options.certExpiry,
  });

  let crux: Awaited<ReturnType<typeof fetchCruxData>> | undefined;
  if (options.cruxApiKey) {
    crux = await fetchCruxData(origin, crawl, options.cruxApiKey, fetchImpl);
    onProgress(`fetched CrUX field data for ${crux.size} record(s)`);
  }

  const findings = [
    ...runDetectors({
      crawl,
      sitemapUrls,
      assets,
      external,
      inspections,
      crux,
    }),
    ...siteFindings,
  ];

  return {
    findings,
    crawl,
    stats: {
      pagesCrawled: crawl.pagesCrawled,
      sitemapUrls: sitemapUrls.length,
      assetsChecked: assets.size,
      externalChecked: external.links.size,
      durationMs: Date.now() - started,
    },
  };
}

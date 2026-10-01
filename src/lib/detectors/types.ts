import type { AssetRecord, CrawlResult } from "../crawler";
import type { ExternalChecks } from "../crawler/external";
import type { RawFinding } from "../findings";
import type { CruxData } from "../sources/crux";

/** Everything a detector may draw on. Sources add fields here over time. */
export interface DetectionContext {
  crawl: CrawlResult;
  /** URLs the site claims exist, from its sitemap(s) via GSC. */
  sitemapUrls: string[];
  /** Post-crawl subresource checks (images), when the runner performed them. */
  assets?: Map<string, AssetRecord>;
  /** External link / embed checks, when the runner performed them. */
  external?: ExternalChecks;
  /** CrUX field data, when the caller has an API key. */
  crux?: CruxData;
  /** GSC URL-inspection verdicts, when the quota allowed sampling. */
  inspections?: Array<{
    url: string;
    verdict: string;
    coverageState: string | null;
  }>;
}

export interface Detector {
  name: string;
  detect(ctx: DetectionContext): RawFinding[];
}

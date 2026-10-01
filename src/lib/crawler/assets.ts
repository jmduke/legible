import { DEFAULT_CONCURRENCY, FETCH_TIMEOUT_MS, USER_AGENT } from "./constants";
import type { AssetRecord, CrawlResult } from "./index";
import { isInternal } from "./url";

const MAX_ASSETS_CHECKED = 2000;

/** Paths with content hashes should ship immutable long-term caching. */
const FINGERPRINTED =
  /[.\-/][a-f0-9]{8,}[.\-/]|\.[a-f0-9]{8,}\.(?:js|css|mjs|woff2?|png|jpe?g|webp|avif|svg|gif)/i;

export function looksFingerprinted(url: string): boolean {
  return FINGERPRINTED.test(new URL(url).pathname);
}

export function hasStrongCachePolicy(cacheControl: string | null): boolean {
  if (!cacheControl) return false;
  const lower = cacheControl.toLowerCase();
  if (lower.includes("immutable")) return true;
  const match = lower.match(/max-age=(\d+)/);
  if (!match) return false;
  return Number(match[1]) >= 86_400;
}

/**
 * Status/size/cache-check every internal subresource referenced by crawled
 * pages (images, scripts, stylesheets). Runs after the page crawl.
 */
export async function checkAssets(
  crawl: CrawlResult,
  fetchImpl: typeof fetch = fetch,
  concurrency = DEFAULT_CONCURRENCY,
): Promise<Map<string, AssetRecord>> {
  const referrersByAsset = new Map<string, Set<string>>();
  const add = (src: string, pageUrl: string) => {
    if (!isInternal(src, crawl.origin)) return;
    const referrers = referrersByAsset.get(src) ?? new Set();
    referrers.add(pageUrl);
    referrersByAsset.set(src, referrers);
  };
  for (const page of crawl.pages.values()) {
    for (const image of page.images ?? []) add(image.src, page.url);
    for (const src of page.socialImages ?? []) add(src, page.url);
    for (const src of page.scriptHrefs ?? []) add(src, page.url);
    for (const href of page.stylesheetHrefs ?? []) add(href, page.url);
  }

  const targets = [...referrersByAsset.keys()].slice(0, MAX_ASSETS_CHECKED);
  const results = new Map<string, AssetRecord>();

  let index = 0;
  const workers = Array.from({ length: concurrency }, async () => {
    while (index < targets.length) {
      const url = targets[index++];
      let status = 0;
      let contentLength: number | null = null;
      let cacheControl: string | null = null;
      try {
        const res = await fetchImpl(url, {
          headers: { "user-agent": USER_AGENT },
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        });
        status = res.status;
        const len = res.headers.get("content-length");
        contentLength = len ? Number(len) : null;
        cacheControl = res.headers.get("cache-control");
        await res.body?.cancel();
      } catch {
        status = 0;
      }
      results.set(url, {
        url,
        status,
        contentLength,
        cacheControl,
        referrers: [...(referrersByAsset.get(url) ?? [])],
      });
    }
  });
  await Promise.all(workers);

  return results;
}

import * as cheerio from "cheerio";
import { USER_AGENT } from "./crawler/constants";
import { normalizeUrl } from "./crawler/url";

const MAX_SITEMAP_DEPTH = 3;
const MAX_URLS = 50_000;

export interface SitemapEntry {
  url: string;
  /** Raw <lastmod> value when present. */
  lastmod?: string;
}

/**
 * Fetch a sitemap (or sitemap index) and return every entry it lists.
 * Sitemap indexes are followed recursively up to a small depth.
 */
export async function fetchSitemapEntries(
  sitemapUrl: string,
  fetchImpl: typeof fetch = fetch,
  depth = 0,
): Promise<SitemapEntry[]> {
  if (depth > MAX_SITEMAP_DEPTH) return [];
  let xml: string;
  try {
    const res = await fetchImpl(sitemapUrl, {
      headers: { "user-agent": USER_AGENT },
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) return [];
    xml = await res.text();
  } catch {
    return [];
  }
  return parseSitemap(xml, fetchImpl, depth);
}

async function parseSitemap(
  xml: string,
  fetchImpl: typeof fetch,
  depth: number,
): Promise<SitemapEntry[]> {
  const $ = cheerio.load(xml, { xml: true });
  const entries: SitemapEntry[] = [];

  const childSitemaps = $("sitemapindex > sitemap > loc")
    .map((_, el) => $(el).text().trim())
    .get();
  for (const child of childSitemaps) {
    if (entries.length >= MAX_URLS) break;
    entries.push(...(await fetchSitemapEntries(child, fetchImpl, depth + 1)));
  }

  $("urlset > url").each((_, el) => {
    if (entries.length >= MAX_URLS) return;
    const normalized = normalizeUrl($(el).children("loc").text().trim());
    if (!normalized) return;
    const lastmod = $(el).children("lastmod").text().trim();
    entries.push({ url: normalized, lastmod: lastmod || undefined });
  });

  return entries;
}

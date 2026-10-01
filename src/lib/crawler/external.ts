import { FETCH_TIMEOUT_MS, USER_AGENT } from "./constants";
import type { CrawlResult } from "./index";

const MAX_EXTERNAL_CHECKED = 500;
const MAX_EMBEDS_CHECKED = 50;
const EXTERNAL_CONCURRENCY = 5;

export interface ExternalLinkRecord {
  url: string;
  status: number;
  error?: string;
  referrers: string[];
}

export interface EmbedRecord {
  videoId: string;
  /** oEmbed status: 404/401 mean the video is gone or private. */
  status: number;
  referrers: string[];
}

export interface ExternalChecks {
  links: Map<string, ExternalLinkRecord>;
  youtube: Map<string, EmbedRecord>;
}

/**
 * Status-check external links and YouTube embeds found during the crawl.
 * Conservative by design: one GET per unique URL, capped totals, and the
 * detector layer only trusts unambiguous outcomes (404/410/DNS failure) —
 * bot walls that answer 403/429 must not become findings.
 */
export async function checkExternal(
  crawl: CrawlResult,
  fetchImpl: typeof fetch = fetch,
): Promise<ExternalChecks> {
  const linkReferrers = new Map<string, Set<string>>();
  const embedReferrers = new Map<string, Set<string>>();
  for (const page of crawl.pages.values()) {
    for (const link of page.externalLinks ?? []) {
      const refs = linkReferrers.get(link) ?? new Set();
      refs.add(page.url);
      linkReferrers.set(link, refs);
    }
    for (const videoId of page.youtubeEmbeds ?? []) {
      const refs = embedReferrers.get(videoId) ?? new Set();
      refs.add(page.url);
      embedReferrers.set(videoId, refs);
    }
  }

  const links = new Map<string, ExternalLinkRecord>();
  const linkTargets = [...linkReferrers.keys()].slice(0, MAX_EXTERNAL_CHECKED);
  let linkIndex = 0;
  await Promise.all(
    Array.from({ length: EXTERNAL_CONCURRENCY }, async () => {
      while (linkIndex < linkTargets.length) {
        const url = linkTargets[linkIndex++];
        let status = 0;
        let error: string | undefined;
        try {
          const res = await fetchImpl(url, {
            headers: {
              "user-agent": USER_AGENT,
              accept: "text/html,*/*;q=0.8",
            },
            signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
          });
          status = res.status;
          await res.body?.cancel();
        } catch (err) {
          error = err instanceof Error ? err.message : String(err);
        }
        links.set(url, {
          url,
          status,
          error,
          referrers: [...(linkReferrers.get(url) ?? [])],
        });
      }
    }),
  );

  const youtube = new Map<string, EmbedRecord>();
  const embedTargets = [...embedReferrers.keys()].slice(0, MAX_EMBEDS_CHECKED);
  let embedIndex = 0;
  await Promise.all(
    Array.from({ length: EXTERNAL_CONCURRENCY }, async () => {
      while (embedIndex < embedTargets.length) {
        const videoId = embedTargets[embedIndex++];
        let status = 0;
        try {
          const res = await fetchImpl(
            `https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}&format=json`,
            {
              headers: { "user-agent": USER_AGENT },
              signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
            },
          );
          status = res.status;
          await res.body?.cancel();
        } catch {
          status = 0;
        }
        youtube.set(videoId, {
          videoId,
          status,
          referrers: [...(embedReferrers.get(videoId) ?? [])],
        });
      }
    }),
  );

  return { links, youtube };
}

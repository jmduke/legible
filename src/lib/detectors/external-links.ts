import type { RawFinding } from "../findings";
import type { Detector } from "./types";

/**
 * Dead outbound links and dead YouTube embeds. Deliberately conservative:
 * only 404/410 and DNS resolution failures count as broken — 403/429/5xx are
 * routinely bot walls or transient, and flagging them would poison trust.
 */
export const externalLinks: Detector = {
  name: "external-links",
  detect({ external }) {
    if (!external) return [];
    const findings: RawFinding[] = [];

    for (const record of external.links.values()) {
      const dnsFailure =
        record.status === 0 &&
        (record.error?.includes("ENOTFOUND") ||
          record.error?.includes("EAI_AGAIN") ||
          record.error?.includes("getaddrinfo"));
      const dead = record.status === 404 || record.status === 410;
      if (!dead && !dnsFailure) continue;
      findings.push({
        type: "broken_external_link",
        key: record.url,
        title: `Dead outbound link: ${record.url} (${dead ? record.status : "domain doesn't resolve"})`,
        detail: {
          url: record.url,
          kind: "link",
          status: record.status,
          error: record.error,
          linkedFrom: record.referrers,
        },
      });
    }

    for (const embed of external.youtube.values()) {
      // oEmbed: 404 = deleted, 401/403 = private/embedding disabled.
      if (![401, 403, 404].includes(embed.status)) continue;
      findings.push({
        type: "broken_external_link",
        key: `youtube:${embed.videoId}`,
        title: `YouTube embed ${embed.videoId} is ${embed.status === 404 ? "deleted" : "private or unembeddable"}`,
        detail: {
          videoId: embed.videoId,
          kind: "youtube_embed",
          oembedStatus: embed.status,
          linkedFrom: embed.referrers,
        },
      });
    }
    return findings;
  },
};

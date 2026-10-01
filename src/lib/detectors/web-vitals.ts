import { displayPath } from "../crawler/url";
import type { RawFinding } from "../findings";
import { CRUX_ORIGIN_KEY } from "../sources/crux";
import type { Detector } from "./types";

/**
 * Google's official "poor" thresholds. We deliberately ignore the middle
 * "needs improvement" band: field data only becomes a work item when real
 * Chrome users are measurably suffering.
 */
export const POOR_LCP_MS = 4_000;
export const POOR_INP_MS = 500;
export const POOR_CLS = 0.25;

/**
 * Core Web Vitals from CrUX field data (real Chrome users, p75). Per-URL
 * records where CrUX has them; the origin-level record as a site-wide
 * fallback verdict. Runs only when the caller supplied CrUX data (needs a
 * free API key).
 */
export const webVitals: Detector = {
  name: "web-vitals",
  detect({ crux }) {
    if (!crux) return [];
    const findings: RawFinding[] = [];

    for (const [key, record] of crux) {
      const isOrigin = key === CRUX_ORIGIN_KEY;
      // The origin verdict only matters when no per-URL record already
      // covers the site's pages — don't double-report.
      if (isOrigin && crux.size > 1) continue;
      const subject = isOrigin ? "site-wide" : displayPath(key);

      const checks = [
        {
          metric: "lcp" as const,
          p75: record.lcpMs,
          threshold: POOR_LCP_MS,
          display: (v: number) => `${(v / 1000).toFixed(1)}s`,
          name: "Largest Contentful Paint",
        },
        {
          metric: "inp" as const,
          p75: record.inpMs,
          threshold: POOR_INP_MS,
          display: (v: number) => `${v}ms`,
          name: "Interaction to Next Paint",
        },
        {
          metric: "cls" as const,
          p75: record.cls,
          threshold: POOR_CLS,
          display: (v: number) => v.toFixed(2),
          name: "Cumulative Layout Shift",
        },
      ];

      for (const check of checks) {
        if (check.p75 === undefined || check.p75 <= check.threshold) continue;
        findings.push({
          type: "core_web_vitals",
          key: `${key} ${check.metric}`,
          title: `Poor ${check.name}: ${check.display(check.p75)} at p75 (${subject})`,
          detail: {
            url: isOrigin ? undefined : key,
            scope: record.scope,
            metric: check.metric,
            p75: check.p75,
            poorThreshold: check.threshold,
            note: "CrUX field data — the 75th percentile of real Chrome users over the trailing 28 days.",
          },
        });
      }
    }
    return findings;
  },
};

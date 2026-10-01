import { describe, expect, it } from "vitest";
import { crawlSite } from "../crawler";
import { findingsOfType } from "../findings";
import {
  CRUX_ORIGIN_KEY,
  type CruxData,
  fetchCruxData,
  sampleUrls,
} from "../sources/crux";
import { routeFetch } from "../testing";
import { runDetectors } from "./index";
import { webVitals } from "./web-vitals";

const ORIGIN = "https://example.com";

const html = (links: string[]) =>
  `<html><body>${links.map((l) => `<a href="${l}">x</a>`).join("")}</body></html>`;

const siteFetch = routeFetch(async (url) => {
  const routes: Record<string, string> = {
    "/": html(["/popular", "/other"]),
    "/popular": html(["/"]),
    "/other": html(["/popular"]),
  };
  const body = routes[url.pathname];
  if (!body) return new Response("not found", { status: 404 });
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/html" },
  });
});

/** CrUX API fake serving canned per-URL/origin records; site routes pass through. */
function cruxApiWith(records: Record<string, object>): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.hostname !== "chromeuxreport.googleapis.com") {
      return siteFetch(String(input));
    }
    const body = JSON.parse(String(init?.body)) as {
      url?: string;
      origin?: string;
    };
    const key = body.url ?? `origin:${body.origin}`;
    const metrics = records[key];
    if (!metrics) return new Response('{"error":{}}', { status: 404 });
    return new Response(JSON.stringify({ record: { metrics } }), {
      status: 200,
    });
  }) as typeof fetch;
}

describe("CrUX source", () => {
  it("samples the most-linked clean pages", async () => {
    const crawl = await crawlSite({ origin: ORIGIN, fetchImpl: siteFetch });
    const sample = sampleUrls(crawl);
    // /popular has 2 referrers, / has 1, /other has 1.
    expect(sample[0]).toBe(`${ORIGIN}/popular`);
    expect(sample).toHaveLength(3);
  });

  it("parses p75 values (including string CLS) and origin fallback", async () => {
    const crawl = await crawlSite({ origin: ORIGIN, fetchImpl: siteFetch });
    const fetchImpl = cruxApiWith({
      [`${ORIGIN}/popular`]: {
        largest_contentful_paint: { percentiles: { p75: 5200 } },
        cumulative_layout_shift: { percentiles: { p75: "0.31" } },
      },
      [`origin:${ORIGIN}`]: {
        interaction_to_next_paint: { percentiles: { p75: 150 } },
      },
    });
    const data = await fetchCruxData(ORIGIN, crawl, "test-key", fetchImpl);
    expect(data.get(`${ORIGIN}/popular`)).toEqual({
      scope: "url",
      lcpMs: 5200,
      inpMs: undefined,
      cls: 0.31,
    });
    expect(data.get(CRUX_ORIGIN_KEY)?.inpMs).toBe(150);
  });
});

describe("web-vitals detector", () => {
  const detect = (crux: CruxData) =>
    webVitals.detect({
      crawl: {
        origin: ORIGIN,
        pages: new Map(),
        pagesCrawled: 0,
        budgetExhausted: false,
      },
      sitemapUrls: [],
      crux,
    });

  it("flags only metrics past the poor threshold", () => {
    const findings = detect(
      new Map([
        [
          `${ORIGIN}/popular`,
          { scope: "url" as const, lcpMs: 5200, inpMs: 180, cls: 0.31 },
        ],
      ]),
    );
    const metrics = findingsOfType(findings, "core_web_vitals").map(
      (f) => f.detail.metric,
    );
    expect(metrics.sort()).toEqual(["cls", "lcp"]); // INP 180 is fine
  });

  it("ignores good/needs-improvement values entirely", () => {
    const findings = detect(
      new Map([
        [
          `${ORIGIN}/ok`,
          { scope: "url" as const, lcpMs: 3200, inpMs: 400, cls: 0.2 },
        ],
      ]),
    );
    expect(findings).toEqual([]);
  });

  it("uses the origin record only when no per-URL records exist", () => {
    const originOnly = detect(
      new Map([[CRUX_ORIGIN_KEY, { scope: "origin" as const, lcpMs: 6000 }]]),
    );
    expect(findingsOfType(originOnly, "core_web_vitals")).toHaveLength(1);
    expect(originOnly[0].title).toContain("site-wide");

    const both = detect(
      new Map([
        [`${ORIGIN}/a`, { scope: "url" as const, lcpMs: 6000 }],
        [CRUX_ORIGIN_KEY, { scope: "origin" as const, lcpMs: 6000 }],
      ]),
    );
    // The per-URL finding is emitted; the origin one is suppressed.
    const vitals = findingsOfType(both, "core_web_vitals");
    expect(vitals).toHaveLength(1);
    expect(vitals[0].detail.url).toBe(`${ORIGIN}/a`);
  });

  it("does nothing without CrUX data", async () => {
    const crawl = await crawlSite({ origin: ORIGIN, fetchImpl: siteFetch });
    const findings = runDetectors({ crawl, sitemapUrls: [] });
    expect(findingsOfType(findings, "core_web_vitals")).toEqual([]);
  });
});

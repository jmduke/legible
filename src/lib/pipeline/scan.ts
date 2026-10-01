import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { artifactsConfigured, uploadHtmlArtifact } from "../artifacts";
import { destinationFor } from "../destinations/sentry";
import type { RawFinding } from "../findings";
import { renderHtmlReport } from "../report";
import { fetchSitemapEntries, type SitemapEntry } from "../sitemap";
import { inspectUrls, listSitemaps } from "../sources/gsc";
import { diffFindings } from "./diff";
import { runFullScan } from "./run";

/**
 * Run one full scan: gather sitemap URLs (GSC first, /sitemap.xml fallback),
 * crawl, detect, diff against known findings, and dispatch new/regressed
 * work items to every enabled destination.
 */
export async function runScan(scanId: string): Promise<void> {
  const [scan] = await db
    .select()
    .from(schema.scans)
    .where(eq(schema.scans.id, scanId))
    .limit(1);
  if (!scan) throw new Error(`Scan ${scanId} not found`);

  const [site] = await db
    .select()
    .from(schema.sites)
    .where(eq(schema.sites.id, scan.siteId))
    .limit(1);
  if (!site) throw new Error(`Site ${scan.siteId} not found`);

  await db
    .update(schema.scans)
    .set({ status: "running", startedAt: new Date() })
    .where(eq(schema.scans.id, scanId));

  try {
    const sitemapEntries = await gatherSitemapEntries(site);
    const sitemapUrls = sitemapEntries.map((e) => e.url);

    // Best-effort GSC index sampling; a scan never fails because of it.
    let inspections: Awaited<ReturnType<typeof inspectUrls>> | undefined;
    try {
      inspections = await inspectUrls(
        site.userId,
        site.gscProperty,
        sitemapUrls,
      );
    } catch {
      inspections = undefined;
    }

    const { findings: detected, stats } = await runFullScan({
      origin: site.origin,
      maxPages: site.maxPagesPerScan,
      noFollowPatterns: (site.noFollowPatterns ?? []).map((p) => new RegExp(p)),
      sitemapEntries,
      inspections,
      cruxApiKey: process.env.CRUX_API_KEY,
    });

    const existing = await db
      .select({
        fingerprint: schema.findings.fingerprint,
        status: schema.findings.status,
      })
      .from(schema.findings)
      .where(eq(schema.findings.siteId, site.id));

    const diff = diffFindings(detected, existing);
    const now = new Date();

    for (const { fingerprint: fp, finding } of diff.created) {
      await db.insert(schema.findings).values({
        id: randomUUID(),
        siteId: site.id,
        fingerprint: fp,
        type: finding.type,
        title: finding.title,
        detail: finding.detail,
        status: "open",
        firstSeenScanId: scanId,
        lastSeenScanId: scanId,
        firstSeenAt: now,
        lastSeenAt: now,
      });
    }

    for (const { fingerprint: fp, finding } of diff.regressed) {
      const [row] = await db
        .select({ timesRegressed: schema.findings.timesRegressed })
        .from(schema.findings)
        .where(
          and(
            eq(schema.findings.siteId, site.id),
            eq(schema.findings.fingerprint, fp),
          ),
        )
        .limit(1);
      await db
        .update(schema.findings)
        .set({
          status: "open",
          title: finding.title,
          detail: finding.detail,
          lastSeenScanId: scanId,
          lastSeenAt: now,
          resolvedAt: null,
          timesRegressed: (row?.timesRegressed ?? 0) + 1,
        })
        .where(
          and(
            eq(schema.findings.siteId, site.id),
            eq(schema.findings.fingerprint, fp),
          ),
        );
    }

    for (const { fingerprint: fp, finding } of diff.persisted) {
      await db
        .update(schema.findings)
        .set({
          title: finding.title,
          detail: finding.detail,
          lastSeenScanId: scanId,
          lastSeenAt: now,
        })
        .where(
          and(
            eq(schema.findings.siteId, site.id),
            eq(schema.findings.fingerprint, fp),
          ),
        );
    }

    if (diff.resolved.length > 0) {
      await db
        .update(schema.findings)
        .set({ status: "resolved", resolvedAt: now })
        .where(
          and(
            eq(schema.findings.siteId, site.id),
            inArray(schema.findings.fingerprint, diff.resolved),
          ),
        );
    }

    const dispatched = await dispatchNewFindings(site.id, scanId, [
      ...diff.created.map((c) => ({ ...c, regressed: false })),
      ...diff.regressed.map((r) => ({ ...r, regressed: true })),
    ]);

    let reportUrl: string | undefined;
    if (artifactsConfigured()) {
      try {
        reportUrl = await uploadHtmlArtifact({
          origin: site.origin,
          id: scanId,
          html: renderHtmlReport(site.origin, detected, stats),
        });
      } catch (err) {
        console.warn(
          `[scan] HTML artifact upload failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    await db
      .update(schema.scans)
      .set({
        status: "completed",
        finishedAt: new Date(),
        stats: {
          pagesCrawled: stats.pagesCrawled,
          sitemapUrls: stats.sitemapUrls,
          findingsTotal: detected.length,
          findingsNew: diff.created.length + diff.regressed.length,
          findingsResolved: diff.resolved.length,
          dispatched,
          reportUrl,
        },
      })
      .where(eq(schema.scans.id, scanId));
  } catch (err) {
    await db
      .update(schema.scans)
      .set({
        status: "failed",
        finishedAt: new Date(),
        error: err instanceof Error ? err.message : String(err),
      })
      .where(eq(schema.scans.id, scanId));
    throw err;
  }
}

async function gatherSitemapEntries(
  site: typeof schema.sites.$inferSelect,
): Promise<SitemapEntry[]> {
  let sitemapLocations: string[] = [];
  try {
    sitemapLocations = await listSitemaps(site.userId, site.gscProperty);
  } catch {
    // GSC unavailable (revoked token, quota); fall back to convention.
  }
  if (sitemapLocations.length === 0) {
    sitemapLocations = [new URL("/sitemap.xml", site.origin).toString()];
  }
  const byUrl = new Map<string, SitemapEntry>();
  for (const location of sitemapLocations) {
    for (const entry of await fetchSitemapEntries(location)) {
      byUrl.set(entry.url, entry);
    }
  }
  return [...byUrl.values()];
}

async function dispatchNewFindings(
  siteId: string,
  scanId: string,
  items: Array<{
    fingerprint: string;
    finding: RawFinding;
    regressed: boolean;
  }>,
): Promise<number> {
  if (items.length === 0) return 0;

  const [site] = await db
    .select()
    .from(schema.sites)
    .where(eq(schema.sites.id, siteId))
    .limit(1);
  const dests = await db
    .select()
    .from(schema.destinations)
    .where(
      and(
        eq(schema.destinations.siteId, siteId),
        eq(schema.destinations.enabled, true),
      ),
    );

  let sent = 0;
  for (const dest of dests) {
    const adapter = destinationFor(dest.kind, dest.config);
    for (const item of items) {
      const result = await adapter.dispatch(item.finding, {
        siteOrigin: site?.origin ?? "",
        fingerprint: item.fingerprint,
        regressed: item.regressed,
      });
      const [findingRow] = await db
        .select({ id: schema.findings.id })
        .from(schema.findings)
        .where(
          and(
            eq(schema.findings.siteId, siteId),
            eq(schema.findings.fingerprint, item.fingerprint),
          ),
        )
        .limit(1);
      if (findingRow) {
        await db.insert(schema.deliveries).values({
          id: randomUUID(),
          findingId: findingRow.id,
          destinationId: dest.id,
          scanId,
          status: result.ok ? "sent" : "failed",
          response: result.detail,
        });
      }
      if (result.ok) sent++;
    }
  }
  return sent;
}

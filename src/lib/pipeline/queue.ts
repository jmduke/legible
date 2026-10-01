import { randomUUID } from "node:crypto";
import { PgBoss } from "pg-boss";
import { db, schema } from "@/db";

export const SCAN_QUEUE = "scan.run";
/** Fed by per-site cron schedules; each job enqueues one scan for its site. */
export const SCHEDULED_SCAN_QUEUE = "scan.scheduled";

let bossPromise: Promise<PgBoss> | null = null;

export function getBoss(): Promise<PgBoss> {
  if (!bossPromise) {
    bossPromise = (async () => {
      // biome-ignore lint/style/noNonNullAssertion: fail fast if unset
      const boss = new PgBoss(process.env.DATABASE_URL!);
      await boss.start();
      await boss.createQueue(SCAN_QUEUE);
      await boss.createQueue(SCHEDULED_SCAN_QUEUE);
      return boss;
    })();
  }
  return bossPromise;
}

/** Create a scan row and enqueue the job that will execute it. */
export async function enqueueScan(siteId: string): Promise<string> {
  const scanId = randomUUID();
  await db.insert(schema.scans).values({ id: scanId, siteId });
  const boss = await getBoss();
  await boss.send(SCAN_QUEUE, { scanId });
  return scanId;
}

/**
 * Register (or remove) the pg-boss schedule for one site, keyed by site id so
 * every site gets its own cron. A null `scanCron` means manual scans only.
 */
export async function syncSiteSchedule(site: {
  id: string;
  scanCron: string | null;
}): Promise<void> {
  const boss = await getBoss();
  if (site.scanCron) {
    await boss.schedule(
      SCHEDULED_SCAN_QUEUE,
      site.scanCron,
      { siteId: site.id },
      { tz: "UTC", key: site.id },
    );
  } else {
    await boss.unschedule(SCHEDULED_SCAN_QUEUE, site.id);
  }
}

/** Reconcile pg-boss schedules with the sites table (worker startup). */
export async function syncAllSiteSchedules(): Promise<number> {
  const boss = await getBoss();
  const sites = await db
    .select({ id: schema.sites.id, scanCron: schema.sites.scanCron })
    .from(schema.sites);
  const wanted = new Set(sites.filter((s) => s.scanCron).map((s) => s.id));
  for (const existing of await boss.getSchedules(SCHEDULED_SCAN_QUEUE)) {
    if (!wanted.has(existing.key)) {
      await boss.unschedule(SCHEDULED_SCAN_QUEUE, existing.key);
    }
  }
  for (const site of sites) await syncSiteSchedule(site);
  return wanted.size;
}

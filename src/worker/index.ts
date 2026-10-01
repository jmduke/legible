import "dotenv/config";
import type { Job } from "pg-boss";
import {
  enqueueScan,
  getBoss,
  SCAN_QUEUE,
  SCHEDULED_SCAN_QUEUE,
  syncAllSiteSchedules,
} from "@/lib/pipeline/queue";
import { runScan } from "@/lib/pipeline/scan";

/**
 * Long-running worker process: executes scans and enqueues one whenever a
 * site's cron schedule fires. Run with `pnpm worker`.
 */
async function main() {
  const boss = await getBoss();

  await boss.work<{ scanId: string }>(
    SCAN_QUEUE,
    async (jobs: Job<{ scanId: string }>[]) => {
      for (const job of jobs) {
        console.log(`[worker] running scan ${job.data.scanId}`);
        await runScan(job.data.scanId);
        console.log(`[worker] finished scan ${job.data.scanId}`);
      }
    },
  );

  await boss.work<{ siteId: string }>(
    SCHEDULED_SCAN_QUEUE,
    async (jobs: Job<{ siteId: string }>[]) => {
      for (const job of jobs) {
        console.log(`[worker] scheduled scan for site ${job.data.siteId}`);
        await enqueueScan(job.data.siteId);
      }
    },
  );

  const scheduled = await syncAllSiteSchedules();
  console.log(`[worker] ${scheduled} site schedule(s) registered`);

  console.log("[worker] listening for jobs");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

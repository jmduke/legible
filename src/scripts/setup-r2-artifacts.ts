#!/usr/bin/env tsx
/**
 * One-time setup: enable the bucket's r2.dev public URL and print the base URL.
 *
 * Requires CLOUDFLARE_API_TOKEN (account token with R2 admin) plus the bucket
 * vars synced by `stripe projects env --pull`.
 *
 *   pnpm artifacts:setup
 */
import "dotenv/config";
import { ensurePublicDevUrl, r2BucketFromEnv } from "../lib/artifacts";

async function main() {
  const config = r2BucketFromEnv();
  if (!config) {
    console.error(
      "Missing R2 bucket env vars. Run `stripe projects env --pull` first.",
    );
    process.exit(1);
  }
  if (!config.apiToken && !config.publicBaseUrl) {
    console.error(
      "Set CLOUDFLARE_API_TOKEN (to enable r2.dev) or CLOUDFLARE_PUBLIC_URL (if already enabled).",
    );
    process.exit(1);
  }

  const baseUrl = await ensurePublicDevUrl(config);
  console.log(`Public artifact base URL: ${baseUrl}`);
  console.log(
    "\nAdd to your environment (or stripe projects variables) if not already set:",
  );
  console.log(`CLOUDFLARE_PUBLIC_URL=${baseUrl}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

import { and, eq } from "drizzle-orm";
import { google, type searchconsole_v1 } from "googleapis";
import { db, schema } from "@/db";

/** Per-scan cap on URL-inspection calls; the API allows 2,000/day/property. */
const INSPECTION_SAMPLE_SIZE = 50;

/**
 * Build an authenticated Search Console client from the Google OAuth tokens
 * better-auth stored for this user. Refreshing is delegated to googleapis.
 */
export async function gscClientForUser(
  userId: string,
): Promise<searchconsole_v1.Searchconsole> {
  const [googleAccount] = await db
    .select()
    .from(schema.account)
    .where(
      and(
        eq(schema.account.userId, userId),
        eq(schema.account.providerId, "google"),
      ),
    )
    .limit(1);

  if (!googleAccount?.refreshToken) {
    throw new Error(
      `User ${userId} has no Google refresh token; re-connect Google with Search Console access.`,
    );
  }

  const oauth2 = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
  );
  oauth2.setCredentials({
    access_token: googleAccount.accessToken ?? undefined,
    refresh_token: googleAccount.refreshToken,
  });

  return google.searchconsole({ version: "v1", auth: oauth2 });
}

/** Properties this user can see — used to gate site creation to owned domains. */
export async function listProperties(userId: string): Promise<string[]> {
  const client = await gscClientForUser(userId);
  const res = await client.sites.list();
  return (res.data.siteEntry ?? [])
    .filter((s) => s.permissionLevel !== "siteUnverifiedUser")
    .map((s) => s.siteUrl ?? "")
    .filter(Boolean);
}

/** Sitemap URLs GSC knows about for a property. */
export async function listSitemaps(
  userId: string,
  property: string,
): Promise<string[]> {
  const client = await gscClientForUser(userId);
  const res = await client.sitemaps.list({ siteUrl: property });
  return (res.data.sitemap ?? []).map((s) => s.path ?? "").filter(Boolean);
}

export interface InspectionResult {
  url: string;
  verdict: string;
  coverageState: string | null;
}

/**
 * Inspect a sample of URLs against the Google index. Failures on individual
 * URLs are skipped rather than failing the scan — this signal is best-effort
 * by nature.
 */
export async function inspectUrls(
  userId: string,
  property: string,
  urls: string[],
): Promise<InspectionResult[]> {
  const client = await gscClientForUser(userId);
  const sample = urls.slice(0, INSPECTION_SAMPLE_SIZE);
  const results: InspectionResult[] = [];
  for (const url of sample) {
    try {
      const res = await client.urlInspection.index.inspect({
        requestBody: { inspectionUrl: url, siteUrl: property },
      });
      const indexResult = res.data.inspectionResult?.indexStatusResult;
      results.push({
        url,
        verdict: indexResult?.verdict ?? "VERDICT_UNSPECIFIED",
        coverageState: indexResult?.coverageState ?? null,
      });
    } catch {
      // Quota exhaustion or transient errors: keep what we have.
      break;
    }
  }
  return results;
}

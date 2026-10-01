"use server";

import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db, schema } from "@/db";
import { sentryConfigSchema } from "@/lib/destinations/sentry";
import { enqueueScan, syncSiteSchedule } from "@/lib/pipeline/queue";
import { requireSession } from "@/lib/session";

/** "sc-domain:example.com" -> "https://example.com"; URL prefixes pass through. */
async function originFromProperty(property: string): Promise<string> {
  if (property.startsWith("sc-domain:")) {
    return `https://${property.slice("sc-domain:".length)}`;
  }
  return new URL(property).origin;
}

const createSiteSchema = z.object({
  gscProperty: z.string().min(1),
  sentryDsn: z.string().url(),
});

export async function createSite(formData: FormData) {
  const session = await requireSession();
  const parsed = createSiteSchema.parse({
    gscProperty: formData.get("gscProperty"),
    sentryDsn: formData.get("sentryDsn"),
  });

  const origin = await originFromProperty(parsed.gscProperty);
  const siteId = randomUUID();
  const [site] = await db
    .insert(schema.sites)
    .values({
      id: siteId,
      userId: session.user.id,
      origin,
      gscProperty: parsed.gscProperty,
    })
    .returning({ id: schema.sites.id, scanCron: schema.sites.scanCron });
  await db.insert(schema.destinations).values({
    id: randomUUID(),
    siteId,
    kind: "sentry",
    config: sentryConfigSchema.parse({ dsn: parsed.sentryDsn }),
  });
  await syncSiteSchedule(site);

  redirect(`/dashboard/sites/${siteId}`);
}

export async function triggerScan(siteId: string) {
  const session = await requireSession();
  const [site] = await db
    .select({ id: schema.sites.id })
    .from(schema.sites)
    .where(
      and(
        eq(schema.sites.id, siteId),
        eq(schema.sites.userId, session.user.id),
      ),
    )
    .limit(1);
  if (!site) throw new Error("Site not found");

  await enqueueScan(siteId);
  revalidatePath(`/dashboard/sites/${siteId}`);
}

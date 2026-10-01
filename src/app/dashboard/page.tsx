import { desc, eq } from "drizzle-orm";
import Link from "next/link";
import { db, schema } from "@/db";
import { requireSession } from "@/lib/session";
import { listProperties } from "@/lib/sources/gsc";
import { createSite } from "../actions";

export default async function DashboardPage() {
  const session = await requireSession();

  const sites = await db
    .select()
    .from(schema.sites)
    .where(eq(schema.sites.userId, session.user.id))
    .orderBy(desc(schema.sites.createdAt));

  let properties: string[] = [];
  let gscError: string | null = null;
  try {
    properties = await listProperties(session.user.id);
  } catch {
    gscError =
      "Couldn't reach Google Search Console. Sign out and back in to re-grant access.";
  }

  return (
    <main className="mx-auto max-w-3xl p-8">
      <header className="mb-8 flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Legible</h1>
        <span className="text-sm text-neutral-500">{session.user.email}</span>
      </header>

      <section className="mb-10">
        <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-neutral-500">
          Your sites
        </h2>
        {sites.length === 0 ? (
          <p className="text-sm text-neutral-500">
            No sites yet — add one below.
          </p>
        ) : (
          <ul className="divide-y divide-neutral-200 rounded-md border border-neutral-200 dark:divide-neutral-800 dark:border-neutral-800">
            {sites.map((site) => (
              <li key={site.id}>
                <Link
                  href={`/dashboard/sites/${site.id}`}
                  className="block px-4 py-3 hover:bg-neutral-50 dark:hover:bg-neutral-900"
                >
                  <span className="font-medium">{site.origin}</span>
                  <span className="ml-2 text-xs text-neutral-500">
                    {site.gscProperty}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-neutral-500">
          Add a site
        </h2>
        {gscError ? (
          <p className="text-sm text-red-600">{gscError}</p>
        ) : (
          <form action={createSite} className="flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-sm">
              Search Console property
              <select
                name="gscProperty"
                required
                className="rounded-md border border-neutral-300 bg-transparent px-3 py-2 dark:border-neutral-700"
              >
                {properties.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Sentry DSN
              <input
                name="sentryDsn"
                type="url"
                required
                placeholder="https://public@o0.ingest.sentry.io/0"
                className="rounded-md border border-neutral-300 bg-transparent px-3 py-2 font-mono text-xs dark:border-neutral-700"
              />
            </label>
            <button
              type="submit"
              className="self-start rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700 dark:bg-white dark:text-neutral-900"
            >
              Add site
            </button>
          </form>
        )}
      </section>
    </main>
  );
}

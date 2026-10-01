import { and, desc, eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { db, schema } from "@/db";
import { requireSession } from "@/lib/session";
import { triggerScan } from "../../../actions";

export default async function SitePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireSession();
  const { id } = await params;

  const [site] = await db
    .select()
    .from(schema.sites)
    .where(
      and(eq(schema.sites.id, id), eq(schema.sites.userId, session.user.id)),
    )
    .limit(1);
  if (!site) notFound();

  const [findings, scans] = await Promise.all([
    db
      .select()
      .from(schema.findings)
      .where(eq(schema.findings.siteId, site.id))
      .orderBy(desc(schema.findings.lastSeenAt))
      .limit(200),
    db
      .select()
      .from(schema.scans)
      .where(eq(schema.scans.siteId, site.id))
      .orderBy(desc(schema.scans.createdAt))
      .limit(10),
  ]);

  const open = findings.filter((f) => f.status === "open");
  const resolved = findings.filter((f) => f.status === "resolved");

  return (
    <main className="mx-auto max-w-3xl p-8">
      <header className="mb-8">
        <Link href="/dashboard" className="text-sm text-neutral-500">
          &larr; All sites
        </Link>
        <div className="mt-2 flex items-center justify-between">
          <h1 className="text-2xl font-semibold tracking-tight">
            {site.origin}
          </h1>
          <form action={triggerScan.bind(null, site.id)}>
            <button
              type="submit"
              className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700 dark:bg-white dark:text-neutral-900"
            >
              Run scan now
            </button>
          </form>
        </div>
        <p className="mt-1 text-sm text-neutral-500">{site.gscProperty}</p>
      </header>

      <section className="mb-10">
        <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-neutral-500">
          Open findings ({open.length})
        </h2>
        {open.length === 0 ? (
          <p className="text-sm text-neutral-500">
            Nothing open. Either the site is clean or no scan has run yet.
          </p>
        ) : (
          <ul className="divide-y divide-neutral-200 rounded-md border border-neutral-200 dark:divide-neutral-800 dark:border-neutral-800">
            {open.map((f) => (
              <li key={f.id} className="px-4 py-3">
                <div className="flex items-baseline justify-between gap-4">
                  <span className="text-sm font-medium">{f.title}</span>
                  <span className="shrink-0 rounded bg-neutral-100 px-2 py-0.5 text-xs text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
                    {f.type}
                  </span>
                </div>
                <div className="mt-1 text-xs text-neutral-500">
                  first seen {f.firstSeenAt.toISOString().slice(0, 10)}
                  {f.timesRegressed > 0 && ` · regressed ${f.timesRegressed}x`}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mb-10">
        <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-neutral-500">
          Recent scans
        </h2>
        {scans.length === 0 ? (
          <p className="text-sm text-neutral-500">No scans yet.</p>
        ) : (
          <ul className="divide-y divide-neutral-200 rounded-md border border-neutral-200 text-sm dark:divide-neutral-800 dark:border-neutral-800">
            {scans.map((scan) => (
              <li
                key={scan.id}
                className="flex items-baseline justify-between px-4 py-3"
              >
                <span>
                  {scan.createdAt.toISOString().replace("T", " ").slice(0, 16)}
                  <span className="ml-2 text-xs text-neutral-500">
                    {scan.status}
                    {scan.error ? ` — ${scan.error}` : ""}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-3 text-xs text-neutral-500">
                  {scan.stats && (
                    <>
                      {scan.stats.pagesCrawled ?? 0} pages ·{" "}
                      {scan.stats.findingsNew ?? 0} new ·{" "}
                      {scan.stats.findingsResolved ?? 0} resolved
                    </>
                  )}
                  {scan.stats?.reportUrl && (
                    <a
                      href={scan.stats.reportUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-medium text-neutral-700 underline underline-offset-2 hover:text-neutral-900 dark:text-neutral-300 dark:hover:text-white"
                    >
                      Report
                    </a>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {resolved.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-neutral-500">
            Resolved ({resolved.length})
          </h2>
          <ul className="divide-y divide-neutral-200 rounded-md border border-neutral-200 opacity-60 dark:divide-neutral-800 dark:border-neutral-800">
            {resolved.map((f) => (
              <li key={f.id} className="px-4 py-3 text-sm">
                {f.title}
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}

"use client";

import { authClient } from "@/lib/auth-client";

export default function LoginPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-8">
      <div className="text-center">
        <h1 className="text-3xl font-semibold tracking-tight">Legible</h1>
        <p className="mt-2 max-w-md text-sm text-neutral-500">
          Turns Google Search Console noise — broken links, orphaned pages, dead
          sitemap entries — into discrete, fixable work items in Sentry.
        </p>
      </div>
      <button
        type="button"
        onClick={() =>
          authClient.signIn.social({
            provider: "google",
            callbackURL: "/dashboard",
          })
        }
        className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
      >
        Sign in with Google
      </button>
      <p className="max-w-md text-center text-xs text-neutral-400">
        We request read-only Search Console access so we can verify you own the
        sites you monitor and read their sitemaps and index status.
      </p>
    </main>
  );
}

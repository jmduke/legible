# Legible

Legible turns site-health signals — starting with Google Search Console — into
discrete, fixable work items and delivers them wherever a team actually works.
The first (and currently only) destination is **Sentry**: every finding becomes
a fingerprinted Sentry event, so Sentry's grouping, assignment,
resolve/regression lifecycle, and Seer autofix all apply to SEO problems the
same way they apply to exceptions.

North star: emit as many *safely, easily fixable* work items as possible, in a
shape both engineers and LLM agents can act on without further investigation.

## How it works

```
GSC property ──> sitemaps ──┐
                            ├──> crawler ──> detectors ──> findings (fingerprinted)
homepage ───────────────────┘                                  │
                                                     diff vs. last scan
                                                               │
                                              new / regressed findings only
                                                               │
                                                    destination adapters
                                                        (Sentry today)
```

- **Scan** (per site, daily via cron or on demand): pull sitemap URLs from the
  customer's GSC property (falling back to `/sitemap.xml`), crawl the site
  politely (robots.txt, redirect-aware, host-locked), sample GSC URL
  inspections, and run detectors.
- **Detectors** each emit normalized findings with a stable fingerprint
  (`sha256(type + canonical key)`):
  - `broken_internal_link` — a linked URL returns 4xx/5xx, with every referring page as evidence
  - `redirect_chain` — 2+ hops or a loop between a link and its destination
  - `orphan_page` — in the sitemap, returns 200, linked from nowhere
  - `sitemap_broken_url` — sitemap entries that are dead, redirect, or noindexed
  - `missing_from_sitemap` — live, linked, indexable pages the sitemap omits
  - `meta_tag_issue` — missing/empty/duplicated/malformed title, description, canonical, h1, or html lang
  - `duplicate_meta` — identical titles or descriptions shared across indexable pages
  - `image_issue` — missing alt attributes, broken images, oversized images (>500 KB)
  - `mixed_content` — http:// subresources on https pages
  - `hreflang_issue` — hreflang pairs that aren't reciprocated
  - `slow_page` — pages taking >3s to return headers (single-sample smoke signal)
  - `broken_anchor` — #fragment links to ids that don't exist on the target page
  - `rendering_artifact` — visible `[object Object]`, unrendered `{{templates}}`, mojibake, bare `undefined`
  - `staging_leak` — references to localhost/staging/preview-deploy hosts
  - `soft_404` — 200 pages whose title says "not found"
  - `canonical_issue` — canonicals pointing at dead/redirecting/noindexed/off-site URLs
  - `social_card_issue` — og:image / twitter:image URLs that 404 (grouped per image)
  - `structured_data_issue` — JSON-LD blocks that fail to parse
  - `deep_page` — sitemap-listed pages ≥5 clicks from the homepage
  - `broken_external_link` — outbound 404/410/no-DNS links and dead YouTube embeds (conservative: bot-wall 403/429s ignored)
  - `feed_issue` — advertised RSS/Atom feeds that are dead or invalid
  - `site_issue` — site-level checks: robots.txt blocking all, sitemap absent from robots.txt, future lastmod dates, missing favicon, www/bare both serving 200, TLS expiring, missing security headers (HSTS/nosniff/CSP/frame/referrer), missing security.txt, nonexistent URLs returning 200
  - `core_web_vitals` — real-user p75 LCP/INP/CLS from CrUX field data past Google's "poor" thresholds; per-URL where CrUX has records, origin-wide otherwise (requires a free `CRUX_API_KEY`)
  - `not_indexed` — live pages Google reports as not indexed (URL-inspection sampling)

Colors everywhere (CLI + HTML) encode urgency: red = fix now, yellow =
should fix, green = informational.
- **Lifecycle**: findings are diffed against the previous state. Only *new* and
  *regressed* findings are dispatched; persisting ones just bump `last_seen`,
  and findings that stop appearing auto-resolve. Because the Sentry event
  fingerprint is the finding fingerprint, a regression reopens the original
  Sentry issue instead of creating a duplicate.
- **Authorization to crawl** is inherited from GSC: a site can only be created
  against a property the signed-in Google account can access.

## Stack

Next.js (App Router) + better-auth (Google OAuth, including the
`webmasters.readonly` scope) + Postgres via Drizzle + pg-boss for jobs. Two
processes, one codebase: the web app and `src/worker`.

## Try it in 10 seconds (no setup)

The full crawl+detect pipeline runs standalone against any public site — no
database, no Google account:

```sh
npx legible-cli https://example.com
```

From a clone, `pnpm scan` runs the same CLI from source:

```sh
pnpm scan https://example.com
pnpm scan https://example.com --summary                          # rollup + most-implicated pages
pnpm scan https://example.com --max-pages 1000 --format agent    # LLM-ready work items
pnpm scan https://example.com --format html                      # publish; prints the public URL
pnpm scan https://example.com --format html --no-upload > report.html
pnpm scan https://example.com --format json > findings.json
```

### Publishing HTML reports

`--format html` uploads a self-contained report to Cloudflare R2 and prints its
public URL on stdout (so it pipes), with a progress line on stderr. Pass
`--no-upload` to get the HTML itself on stdout instead. Without credentials the
CLI falls back to `--no-upload` behaviour and warns.

Setup, once: create an R2 bucket, then an R2 API token under **R2 → API →
Manage API tokens** with **Object Read & Write** on that bucket. Enable the
bucket's public `r2.dev` URL (or attach a custom domain) and set:

```sh
CLOUDFLARE_ACCOUNT_ID=...
CLOUDFLARE_BUCKET_NAME=...
CLOUDFLARE_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
CLOUDFLARE_ACCESS_KEY_ID=...
CLOUDFLARE_SECRET_ACCESS_KEY=...
CLOUDFLARE_PUBLIC_URL=https://pub-<hash>.r2.dev
```

Alternatively, with a single `CLOUDFLARE_API_TOKEN` (**Admin Read & Write**)
the S3 credentials are derived — access key ID is the token's ID, secret is the
SHA-256 of its value — and `pnpm artifacts:setup` enables the bucket's `r2.dev`
domain for you.

The maintainer's deployment pulls bucket metadata from
[Stripe Projects](https://docs.stripe.com/stripe-cli) instead, as
resource-prefixed vars (`LEGIBLE_ASSETS_*`):

```sh
stripe projects env --pull
stripe projects variables set cloudflare-api-token --env-key CLOUDFLARE_API_TOKEN
pnpm artifacts:setup
```

Explicit keys always win over derivation. Set `ARTIFACTS_R2_RESOURCE` to read
a different resource prefix.

Reports land at `reports/<host>/<uuid>.html`. Worker scans store the URL on each completed scan
(`stats.reportUrl`) and link to it from the dashboard.

`--no-follow <path-regex>` (repeatable) marks sections to status-check but not
recurse into — e.g. `--no-follow '^/[^/]+/(archive|subscribers)(/|$)'` keeps a
scan of a newsletter platform on its marketing site instead of wandering into
user newsletter archives. Orphan detection automatically disables itself when
the crawl budget is exhausted, since an incomplete link graph can't prove a
page is unlinked.

## Local development

```sh
cp .env.example .env       # fill in Google OAuth credentials
docker compose up -d       # Postgres on :5433
pnpm db:migrate            # apply drizzle/ migrations
pnpm dev                   # web app on :3000
pnpm worker                # job runner (separate terminal)
```

Google setup: create an OAuth client in a GCP project with the **Search
Console API** enabled; authorized redirect URI is
`http://localhost:3000/api/auth/callback/google`.

Tests and checks:

```sh
pnpm test        # vitest — detectors run against an in-memory fake site
pnpm typecheck
pnpm lint        # biome
```

## Deploying

Legible is two long-running processes from one build, plus Postgres:

| Process | Command | Notes |
| --- | --- | --- |
| Web | `pnpm build && pnpm start` | Next.js app; any Node 22 host |
| Worker | `pnpm worker` | pg-boss job runner and per-site cron scheduler; keep exactly one running |

Steps:

1. Provision Postgres and set `DATABASE_URL`. Run `pnpm db:migrate` on each
   deploy, before the new web and worker processes start.
2. Set `BETTER_AUTH_SECRET` to a random value (`openssl rand -base64 32`) and
   `BETTER_AUTH_URL` to the public origin of the web process.
3. Add `{BETTER_AUTH_URL}/api/auth/callback/google` as a redirect URI on the
   Google OAuth client and set `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`.
   The `webmasters.readonly` scope is sensitive: until the OAuth app passes
   Google verification, only test users you add to the consent screen can sign
   in.
4. Optionally set `CRUX_API_KEY` and the R2 variables above. Give the worker
   the same environment as the web process.

The Sentry DSN is per site, entered in the dashboard; there is no global
Sentry configuration.

## Layout

```
src/db/            schema + client (auth tables, sites, scans, findings, deliveries)
src/lib/findings.ts    FINDING_TYPES + typed detail union (FindingDetailMap) + fingerprinting
src/lib/crawler/   polite BFS crawler (index), page parsing (parse), asset checks (assets),
                   external-link/embed checks (external), robots, URL utils
src/lib/detectors/ one file per finding type; pure functions over the crawl,
                   sharing eligibility predicates from guards.ts
src/lib/sitechecks.ts  site-level checks (security headers, TLS, robots, feeds, 404 probe)
src/lib/report/    labels/severity/row labels/fix instructions, agent markdown, HTML report
src/lib/artifacts/ Cloudflare R2 upload for public HTML scan reports
src/lib/sources/   GSC client (properties, sitemaps, URL inspection)
src/lib/destinations/  Destination interface + Sentry envelope adapter
src/lib/pipeline/  runFullScan (the one scan recipe), lifecycle diff, DB scan runner, job queue
src/cli.ts + src/cli/  scan CLI entry + terminal renderers
src/worker/        pg-boss worker + per-site cron scheduler
src/app/           login, dashboard, site detail, server actions
```

## Releasing the CLI

`cli/` is the `legible-cli` npm package: `src/cli.ts` bundled by esbuild into
`cli/dist/cli.mjs`, with only the crawler's runtime dependencies. To release,
bump `version` in both `package.json` and `cli/package.json`, keep
`cli/package.json` dependencies in step with the root, then:

```sh
cd cli && npm publish     # prepublishOnly runs pnpm cli:build
```

## Extending

- **New detector**: implement `Detector` in `src/lib/detectors/`, register it
  in `index.ts`. Keep detectors pure — they take a `DetectionContext`, return
  `RawFinding[]`, and get tested against fake crawls.
- **New destination**: implement `Destination` in `src/lib/destinations/`,
  register it in `destinationFor()`. Dispatch must be idempotent per
  fingerprint.
- **New source** (beyond GSC): add to `src/lib/sources/` and extend
  `DetectionContext` with whatever signal it contributes.

## Roadmap

Checks from [specification.website](https://specification.website) that
Legible does not cover yet: color contrast, keyboard navigation, focus
indicators, reduced motion, server-side rendering, hreflang in sitemaps,
TDMRep, PWA manifests, cookie consent, cross-origin isolation, and DNSSEC.

## Security

See [SECURITY.md](SECURITY.md) to report a vulnerability.

## License

[MIT](LICENSE)

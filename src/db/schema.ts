import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { FINDING_TYPES, type FindingDetail } from "@/lib/findings";

// ---------------------------------------------------------------------------
// better-auth tables
// ---------------------------------------------------------------------------

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const session = pgTable("session", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expires_at").notNull(),
  token: text("token").notNull().unique(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const account = pgTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at"),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Legible domain
// ---------------------------------------------------------------------------

/**
 * A site is one property a customer monitors: a domain plus the GSC property
 * that proves they own it. Crawling is only ever permitted against domains
 * backed by a verified GSC property.
 */
export const sites = pgTable(
  "sites",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** Origin we crawl, e.g. "https://example.com" */
    origin: text("origin").notNull(),
    /** GSC property identifier, e.g. "sc-domain:example.com" or a URL prefix */
    gscProperty: text("gsc_property").notNull(),
    maxPagesPerScan: integer("max_pages_per_scan").notNull().default(2000),
    /**
     * Regex sources for crawl scoping (fetch-but-don't-recurse), e.g.
     * ["^/[^/]+/archive/"] to keep a scan off user-generated sections.
     */
    noFollowPatterns: jsonb("no_follow_patterns")
      .$type<string[]>()
      .notNull()
      .default([]),
    /** Cron-style schedule handled by the worker; null = manual scans only */
    scanCron: text("scan_cron").default("0 6 * * *"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("sites_user_origin_idx").on(t.userId, t.origin)],
);

/**
 * Where findings get dispatched. `kind` selects the adapter; `config` is
 * adapter-specific (for Sentry: { dsn, environment? }).
 */
export const destinations = pgTable("destinations", {
  id: text("id").primaryKey(),
  siteId: text("site_id")
    .notNull()
    .references(() => sites.id, { onDelete: "cascade" }),
  kind: text("kind", { enum: ["sentry"] }).notNull(),
  config: jsonb("config").notNull().$type<Record<string, unknown>>(),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const scans = pgTable(
  "scans",
  {
    id: text("id").primaryKey(),
    siteId: text("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    status: text("status", {
      enum: ["queued", "running", "completed", "failed"],
    })
      .notNull()
      .default("queued"),
    stats: jsonb("stats").$type<{
      pagesCrawled?: number;
      sitemapUrls?: number;
      findingsTotal?: number;
      findingsNew?: number;
      findingsResolved?: number;
      dispatched?: number;
      /** Public R2 URL for the scan's HTML report, when artifact upload is configured. */
      reportUrl?: string;
    }>(),
    error: text("error"),
    startedAt: timestamp("started_at"),
    finishedAt: timestamp("finished_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("scans_site_idx").on(t.siteId, t.createdAt)],
);

/**
 * A finding is one discrete, actionable work item ("/pricing links to a 404",
 * "/blog/foo is orphaned"). The fingerprint is stable across scans so a
 * finding has a lifecycle: open -> resolved (stopped being detected) ->
 * reopened (detected again).
 */
export const findings = pgTable(
  "findings",
  {
    id: text("id").primaryKey(),
    siteId: text("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    fingerprint: text("fingerprint").notNull(),
    type: text("type", { enum: FINDING_TYPES }).notNull(),
    title: text("title").notNull(),
    /** Evidence needed to fix it: URL, referrers, status codes, chain hops… */
    detail: jsonb("detail").notNull().$type<FindingDetail>(),
    status: text("status", { enum: ["open", "resolved"] })
      .notNull()
      .default("open"),
    firstSeenScanId: text("first_seen_scan_id")
      .notNull()
      .references(() => scans.id),
    lastSeenScanId: text("last_seen_scan_id")
      .notNull()
      .references(() => scans.id),
    firstSeenAt: timestamp("first_seen_at").notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at").notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at"),
    /** How many times this finding went open -> resolved -> open again */
    timesRegressed: integer("times_regressed").notNull().default(0),
  },
  (t) => [
    uniqueIndex("findings_site_fingerprint_idx").on(t.siteId, t.fingerprint),
    index("findings_site_status_idx").on(t.siteId, t.status),
  ],
);

/** Audit trail of every dispatch to a destination. */
export const deliveries = pgTable(
  "deliveries",
  {
    id: text("id").primaryKey(),
    findingId: text("finding_id")
      .notNull()
      .references(() => findings.id, { onDelete: "cascade" }),
    destinationId: text("destination_id")
      .notNull()
      .references(() => destinations.id, { onDelete: "cascade" }),
    scanId: text("scan_id")
      .notNull()
      .references(() => scans.id, { onDelete: "cascade" }),
    status: text("status", { enum: ["sent", "failed"] }).notNull(),
    /** e.g. Sentry event_id, or the error message on failure */
    response: text("response"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("deliveries_finding_idx").on(t.findingId)],
);

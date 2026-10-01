import type { FindingType, RawFinding } from "../findings";
import { fingerprint } from "../findings";
import {
  fixInstruction,
  groupByType,
  rowLabel,
  TYPE_LABELS,
  TYPE_SEVERITY,
} from "./labels";

function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

const HTML_STYLES = `
/* Inlined from internal-tools/artifact-kit/kit.css (house style for standalone artifacts). */
:root {
  --bg: #0f1115; --panel: #181b22; --panel2: #1f232c; --panel3: #20242e;
  --border: #2a2f3a; --chip: #262b35;
  --fg: #e7eaf0; --muted: #9aa3b2; --faint: #6b7280;
  --accent: #6ea8fe; --warn: #f0a35e; --good: #5fd08a; --bad: #f06e6e;
}
* { box-sizing: border-box; }
body { margin: 0 auto; max-width: 1080px; padding: 32px; background: var(--bg); color: var(--fg); font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
h1 { font-size: 24px; margin: 0 0 4px; font-weight: 650; }
h2 { font-size: 16px; margin: 36px 0 12px; padding-bottom: 6px; border-bottom: 1px solid var(--border); }
h2 .pill { vertical-align: 1px; margin-left: 6px; }
code { background: var(--chip); padding: 1.5px 6px; border-radius: 5px; font-size: 12.5px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.sub, .footer { color: var(--muted); font-size: 12.5px; }
.cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 12px; margin: 20px 0; }
.card { background: var(--panel); border: 1px solid var(--border); border-radius: 10px; padding: 14px 16px; }
.card .n { font-size: 26px; font-weight: 650; font-variant-numeric: tabular-nums; }
.card .l { color: var(--muted); font-size: 12px; margin-top: 2px; }
.proportion { display: flex; width: 100%; height: 18px; border: 1px solid var(--border); border-radius: 999px; overflow: hidden; background: var(--panel2); }
.proportion > span { height: 100%; }
.proportion > span + span { border-left: 1px solid var(--bg); }
.legend { display: flex; flex-wrap: wrap; gap: 6px 24px; margin: 12px 0 0; }
.legend-item { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--muted); white-space: nowrap; }
.legend-item .swatch { width: 10px; height: 10px; border-radius: 2px; flex: none; }
.pill { display: inline-block; padding: 1px 8px; border-radius: 999px; font-size: 11.5px; font-weight: 600; background: var(--chip); color: var(--fg); }
.pill.warn { background: color-mix(in srgb, var(--warn) 18%, transparent); color: var(--warn); }
.pill.bad { background: color-mix(in srgb, var(--bad) 18%, transparent); color: var(--bad); }
.pill.neutral { background: var(--chip); color: var(--muted); }
.keyvalue { display: grid; grid-template-columns: max-content 1fr; gap: 8px 24px; margin: 0; }
.keyvalue dt { color: var(--muted); font-size: 13px; margin: 0; }
.keyvalue dd { color: var(--fg); font-size: 13px; margin: 0; overflow-wrap: anywhere; }
/* Collapsible finding rows — the kit's .diff-file chrome, generalized. */
.finding { background: var(--panel); border: 1px solid var(--border); border-radius: 8px; margin: 8px 0; overflow: hidden; }
.finding > summary { cursor: pointer; padding: 9px 14px; display: flex; align-items: center; gap: 10px; user-select: none; list-style: none; }
.finding > summary::-webkit-details-marker { display: none; }
.finding > summary::before { content: "▸"; color: var(--faint); font-size: 11px; }
.finding[open] > summary::before { content: "▾"; }
.finding > summary:hover { background: var(--panel3); }
.finding .ft { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.finding .fq { color: var(--muted); font-size: 12.5px; white-space: nowrap; flex: none; }
.finding .fp { margin-left: auto; color: var(--faint); background: none; flex: none; }
.finding-body { padding: 12px 14px; background: var(--panel2); border-top: 1px solid var(--border); }
.footer { margin-top: 40px; padding-top: 16px; border-top: 1px solid var(--border); }
.pending { display: flex; align-items: center; gap: 16px; margin: 28px 0; padding: 20px 22px; background: var(--panel); border: 1px solid var(--border); border-radius: 10px; }
.spinner { width: 22px; height: 22px; border: 2px solid var(--border); border-top-color: var(--accent); border-radius: 50%; animation: spin 0.8s linear infinite; flex: none; }
.pending-status { margin: 0; color: var(--muted); font-size: 13.5px; }
@keyframes spin { to { transform: rotate(360deg); } }
`;

function htmlDocument(title: string, body: string, extraStyles = ""): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${HTML_STYLES}${extraStyles}</style>
</head>
<body>
${body}
</body>
</html>`;
}

/**
 * Placeholder report shown while a scan is in progress. The CLI rewrites the
 * output file on each progress tick, then replaces it with the full report.
 */
export function renderHtmlPendingReport(
  origin: string,
  status = "Starting scan…",
): string {
  return htmlDocument(
    `Legible report — ${origin} (scanning)`,
    `<h1>Legible · ${escapeHtml(origin)}</h1>
<div class="sub">Scanning…</div>
<div class="pending" role="status" aria-live="polite">
  <div class="spinner" aria-hidden="true"></div>
  <p class="pending-status">${escapeHtml(status)}</p>
</div>
<div class="footer">Report will appear here when the scan finishes. Refresh if it looks stuck.</div>`,
  );
}

export interface ReportStats {
  pagesCrawled: number;
  sitemapUrls: number;
  assetsChecked: number;
  durationMs: number;
}

/** Severity → the dot/accent color used everywhere in the report. */
const SEVERITY_COLOR = {
  bad: "var(--error)",
  warn: "var(--warn)",
  neutral: "var(--note)",
} as const;

/** Severity → the filter tab it belongs to. */
const SEVERITY_TAB = {
  bad: "errors",
  warn: "warnings",
  neutral: "notes",
} as const;

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

function host(origin: string): string {
  return origin.replace(/^https?:\/\//, "").replace(/\/$/, "");
}

/** Detail entries, minus the empties — the key/value grid of an expanded row. */
function detailEntries(f: RawFinding): [string, string][] {
  return Object.entries(f.detail)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]): [string, string] => [
      k,
      Array.isArray(v) ? v.join(", ") : String(v),
    ]);
}

/** The page this finding is about, when there's a fetchable URL to link to. */
function findingLink(f: RawFinding): string | null {
  const d = f.detail as unknown as Record<string, unknown>;
  const candidates = [
    d.url,
    d.resource,
    d.page,
    d.image,
    Array.isArray(d.linkedFrom) ? d.linkedFrom[0] : undefined,
  ];
  for (const c of candidates) {
    if (typeof c === "string" && /^https?:\/\//.test(c)) return c;
  }
  return null;
}

function renderRow(f: RawFinding): string {
  const label = rowLabel(f);
  const fp = fingerprint(f);
  const entries = detailEntries(f);
  const link = findingLink(f);
  // Everything the filter box searches within this row.
  const haystack = [
    label.main,
    label.qualifier,
    fp,
    ...entries.map((e) => e[1]),
  ]
    .join(" ")
    .toLowerCase();

  const kv = entries
    .map(
      ([k, v]) =>
        `<div class="k">${escapeHtml(k)}</div><div class="v">${escapeHtml(v)}</div>`,
    )
    .join("");

  return `<details class="row" data-search="${escapeHtml(haystack)}">
<summary><span class="t">${escapeHtml(label.main)}</span><span class="q">${escapeHtml(label.qualifier)}</span><span class="fp" data-fp="${fp}" role="button" tabindex="0" title="copy fingerprint">${fp}</span></summary>
<div class="detail">
<div class="kv">${kv}</div>
<p class="fix">${escapeHtml(fixInstruction(f))}</p>${
    link
      ? `\n<p class="open"><a href="${escapeHtml(link)}" target="_blank" rel="noreferrer">open page ↗</a></p>`
      : ""
  }
</div>
</details>`;
}

function renderSection(type: FindingType, group: RawFinding[]): string {
  const severity = TYPE_SEVERITY[type];
  const name = TYPE_LABELS[type];
  return `<section class="cat" data-cat="${slug(name)}" data-sev="${SEVERITY_TAB[severity]}">
<div class="cat-head"><h2>${escapeHtml(name)}</h2><span class="cat-count">${group.length}</span></div>
<div class="cat-body">
${group.map(renderRow).join("\n")}
<button class="more" type="button" hidden></button>
</div>
</section>`;
}

/**
 * Self-contained HTML report: a filterable, category-navigated finding list.
 * Everything is pre-rendered and escaped, so the report is fully readable with
 * scripting off; the inline script only adds filtering, paging and copy.
 */
export function renderHtmlReport(
  origin: string,
  findings: RawFinding[],
  stats?: ReportStats,
): string {
  const types = [...groupByType(findings).entries()];
  const generated = new Date().toISOString().slice(0, 16).replace("T", " ");

  const counts = { errors: 0, warnings: 0, notes: 0 };
  for (const [type, group] of types) {
    counts[SEVERITY_TAB[TYPE_SEVERITY[type]]] += group.length;
  }
  const tabs = [
    ["all", `all ${findings.length}`],
    ...(["errors", "warnings", "notes"] as const)
      .filter((tab) => counts[tab] > 0)
      .map((tab) => [tab, `${tab} ${counts[tab]}`]),
  ]
    .map(
      ([id, label], i) =>
        `<button class="tab${i === 0 ? " on" : ""}" type="button" data-sev="${id}">${label}</button>`,
    )
    .join("");

  const navItem = (
    id: string,
    name: string,
    color: string,
    count: number,
    on: boolean,
  ) =>
    `<button class="nav-item${on ? " on" : ""}" type="button" data-cat="${id}"><span class="dot" style="background:${color}"></span><span class="nav-name">${escapeHtml(name)}</span><span class="nav-count">${count}</span></button>`;

  const nav = [
    navItem("all", "All categories", "var(--faint3)", findings.length, true),
    ...types.map(([type, group]) =>
      navItem(
        slug(TYPE_LABELS[type]),
        TYPE_LABELS[type],
        SEVERITY_COLOR[TYPE_SEVERITY[type]],
        group.length,
        false,
      ),
    ),
  ].join("\n");

  const sections = types
    .map(([type, group]) => renderSection(type, group))
    .join("\n");

  const footer = `Legible · crawl of ${origin}${
    stats
      ? ` · ${stats.pagesCrawled} pages · ${stats.sitemapUrls} sitemap URLs · ${stats.assetsChecked} assets · ${(stats.durationMs / 1000).toFixed(1)}s`
      : ""
  } · fingerprints are stable across scans`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Legible — ${escapeHtml(host(origin))} site audit</title>
<style>
:root {
  --bg: #0c0e11; --panel: #101317; --hover: #14181d; --detail: #0c0f13;
  --nav-on: #181c22; --nav-hover: #14171c; --more: #131720; --more-hover: #171c26;
  --line: #1a1e24; --line2: #1c2027; --line3: #262b33; --line4: #1e222a;
  --fg: #e9eaee; --fg2: #dfe2e8; --fg3: #cfd4dc;
  --muted: #9aa1ac; --muted2: #8b929e;
  --faint: #7d848f; --faint2: #6d7480; --faint3: #5f6672; --dim: #575e69;
  --link: #85b4f5; --link-hover: #a9cbfa;
  --error: #f0796d; --warn: #e2a659; --note: #6d7480;
  --mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
}
* { box-sizing: border-box; }
[hidden] { display: none !important; }
html { background: var(--bg); }
body {
  margin: 0; background: var(--bg); color: var(--fg);
  font: 14px/1.5 -apple-system, system-ui, "Segoe UI", Roboto, sans-serif;
  -webkit-font-smoothing: antialiased;
}
a { color: var(--link); text-decoration: none; }
a:hover { color: var(--link-hover); text-decoration: underline; }
::selection { background: rgba(133, 180, 245, 0.28); }
button { font-family: inherit; }
.wrap { max-width: 1240px; margin: 0 auto; padding: 56px 40px 96px; }

h1 { margin: 0; font-size: 42px; line-height: 1.05; font-weight: 600; letter-spacing: -0.02em; }
.scanline { margin-top: 12px; font-family: var(--mono); font-size: 12.5px; color: var(--faint2); }

/* Toolbar: filter box + severity tabs, right-aligned above the list. */
.toolbar {
  margin-top: 52px; display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
  padding-bottom: 14px; border-bottom: 1px solid var(--line4);
}
.toolbar > * { margin-left: auto; }
.toolbar > * ~ * { margin-left: 0; }
#q {
  width: 280px; padding: 8px 12px; border: 1px solid var(--line3); border-radius: 8px;
  background: var(--panel); color: var(--fg); font-family: var(--mono); font-size: 12.5px; outline: none;
}
#q::placeholder { color: var(--faint3); }
#q:focus { border-color: #3d5a80; background: #12161b; }
.tabs { display: flex; flex-wrap: wrap; gap: 1px; padding: 2px; border: 1px solid var(--line3); border-radius: 8px; background: var(--panel); max-width: 100%; }
.tab {
  border: 0; cursor: pointer; padding: 6px 12px; border-radius: 6px;
  font-family: var(--mono); font-size: 12px; background: transparent; color: var(--faint);
}
.tab.on { background: #242a33; color: var(--fg); }

.layout { display: flex; align-items: flex-start; gap: 40px; margin-top: 24px; }
/* The category list can run to two dozen entries — keep it inside the viewport. */
.sidebar { width: 212px; flex: none; position: sticky; top: 24px; max-height: calc(100vh - 48px); overflow-y: auto; }
.eyebrow {
  font-family: var(--mono); font-size: 11px; letter-spacing: 0.14em; text-transform: uppercase;
  color: var(--faint3); margin-bottom: 10px;
}
.nav-item {
  display: flex; align-items: center; gap: 8px; width: 100%; text-align: left;
  border: 0; cursor: pointer; padding: 8px 10px; border-radius: 7px; margin-bottom: 2px;
  background: transparent; color: #a3aab4; font-size: 13px;
}
.nav-item:hover { background: var(--nav-hover); }
.nav-item.on { background: var(--nav-on); color: var(--fg); }
.nav-item .dot { width: 6px; height: 6px; border-radius: 99px; flex: none; }
.nav-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.nav-count { font-family: var(--mono); font-size: 11.5px; color: var(--faint); font-variant-numeric: tabular-nums; }

.list { flex: 1; min-width: 0; }
.cat { margin-bottom: 38px; }
.cat-head { display: flex; align-items: baseline; gap: 10px; margin-bottom: 8px; }
.cat-head h2 { margin: 0; font-size: 14px; font-weight: 500; letter-spacing: -0.005em; }
.cat-count { font-family: var(--mono); font-size: 11.5px; color: var(--faint2); font-variant-numeric: tabular-nums; }
.cat-body { border: 1px solid var(--line2); border-radius: 10px; overflow: hidden; background: var(--panel); }

.row { border-top: 1px solid var(--line); }
.row:first-child { border-top: 0; }
.row > summary {
  display: flex; align-items: center; gap: 16px;
  padding: 10px 14px; cursor: pointer; list-style: none;
}
.row > summary::-webkit-details-marker { display: none; }
.row > summary::before {
  content: "▸"; font-family: var(--mono); font-size: 10px; color: var(--dim);
  width: 8px; flex: none; margin-right: -6px;
}
.row[open] > summary::before { content: "▾"; }
.row > summary:hover, .row[open] > summary { background: var(--hover); }
.row .t {
  flex: 1; min-width: 0;
  font-family: var(--mono); font-size: 12.5px; color: var(--fg2);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.row .q { flex: none; font-size: 12.5px; color: var(--muted2); white-space: nowrap; }
.row .fp { flex: none; font-family: var(--mono); font-size: 11px; color: var(--dim); white-space: nowrap; cursor: pointer; }
.row .fp:hover { color: var(--link); }
.detail { padding: 16px 18px 18px 32px; background: var(--detail); border-top: 1px solid var(--line); }
.kv { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 7px 22px; }
.kv .k { font-family: var(--mono); font-size: 11.5px; color: var(--faint2); letter-spacing: 0.02em; padding-top: 1px; }
.kv .v { font-family: var(--mono); font-size: 12px; color: var(--fg3); overflow-wrap: anywhere; }
.fix { margin: 12px 0 0; font-size: 13.5px; line-height: 1.6; color: var(--muted); max-width: 80ch; text-wrap: pretty; }
.open { margin: 10px 0 0; font-family: var(--mono); font-size: 12px; }
.more {
  display: block; width: 100%; border: 0; border-top: 1px solid var(--line);
  background: var(--more); color: var(--muted2); cursor: pointer; padding: 9px 14px;
  font-family: var(--mono); font-size: 12px; text-align: center;
}
.more:hover { color: var(--fg); background: var(--more-hover); }
.empty {
  padding: 48px 20px; text-align: center; border: 1px dashed #22262e; border-radius: 10px;
  color: var(--faint); font-family: var(--mono); font-size: 12.5px;
}
.footer {
  margin-top: 64px; padding-top: 18px; border-top: 1px solid var(--line);
  font-family: var(--mono); font-size: 11.5px; color: var(--faint2);
}
@media (max-width: 860px) {
  .wrap { padding: 32px 20px 64px; }
  h1 { font-size: 32px; }
  .toolbar > * { margin-left: 0; }
  #q { width: 100%; }
  .layout { flex-direction: column; align-items: stretch; gap: 24px; }
  .sidebar { position: static; width: auto; max-height: none; }
  .list { width: 100%; }
  .row .fp { display: none; }
}
</style>
</head>
<body>
<div class="wrap">
<h1>${escapeHtml(host(origin))}</h1>
<div class="scanline">${findings.length} findings${stats ? ` · ${stats.pagesCrawled} pages crawled` : ""} · scanned ${generated} UTC</div>

<div class="toolbar">
<input id="q" type="text" placeholder="filter by url, kind, or fingerprint…" autocomplete="off">
<div class="tabs">${tabs}</div>
</div>

<div class="layout">
<nav class="sidebar">
<div class="eyebrow">categories</div>
${nav}
</nav>
<div class="list">
${sections}
<div class="empty" hidden></div>
</div>
</div>

<div class="footer">${escapeHtml(footer)}</div>
</div>
<script>
(function () {
  var ROW_LIMIT = 8;
  var state = { q: "", sev: "all", cat: "all", more: {} };
  var cats = [].map.call(document.querySelectorAll(".cat"), function (el) {
    return {
      el: el,
      id: el.dataset.cat,
      sev: el.dataset.sev,
      rows: [].slice.call(el.querySelectorAll(".row")),
      count: el.querySelector(".cat-count"),
      more: el.querySelector(".more"),
    };
  });
  var navItems = [].slice.call(document.querySelectorAll(".nav-item"));
  var tabs = [].slice.call(document.querySelectorAll(".tab"));
  var empty = document.querySelector(".empty");

  function apply() {
    var q = state.q.trim().toLowerCase();
    var visible = 0;
    var navCounts = { all: 0 };
    cats.forEach(function (c) {
      var matches = c.rows.filter(function (r) {
        return !q || r.dataset.search.indexOf(q) !== -1;
      });
      navCounts[c.id] = matches.length;
      navCounts.all += matches.length;

      var limit = state.more[c.id] || ROW_LIMIT;
      c.rows.forEach(function (r) { r.hidden = true; });
      matches.slice(0, limit).forEach(function (r) { r.hidden = false; });

      var hiddenByLimit = matches.length - Math.min(matches.length, limit);
      c.more.hidden = hiddenByLimit === 0;
      c.more.textContent = "show " + hiddenByLimit + " more";
      c.count.textContent = String(matches.length);

      var show = matches.length > 0 &&
        (state.sev === "all" || state.sev === c.sev) &&
        (state.cat === "all" || state.cat === c.id);
      c.el.hidden = !show;
      if (show) visible += matches.length;
    });

    navItems.forEach(function (n) {
      n.classList.toggle("on", n.dataset.cat === state.cat);
      n.querySelector(".nav-count").textContent = String(navCounts[n.dataset.cat] || 0);
    });
    tabs.forEach(function (t) { t.classList.toggle("on", t.dataset.sev === state.sev); });

    empty.hidden = visible > 0;
    if (!visible) {
      empty.textContent = q ? "no findings match \\u201c" + q + "\\u201d" : "no findings in this view";
    }
  }

  document.getElementById("q").addEventListener("input", function (e) {
    state.q = e.target.value;
    state.more = {};
    apply();
  });
  tabs.forEach(function (t) {
    t.addEventListener("click", function () { state.sev = t.dataset.sev; apply(); });
  });
  navItems.forEach(function (n) {
    n.addEventListener("click", function () { state.cat = n.dataset.cat; apply(); });
  });
  cats.forEach(function (c) {
    c.more.addEventListener("click", function () {
      state.more[c.id] = c.rows.length;
      apply();
    });
  });

  // Fingerprints are the stable cross-scan handle, so make them one click to grab.
  document.addEventListener("click", function (e) {
    var fp = e.target.closest && e.target.closest(".fp");
    if (!fp) return;
    e.preventDefault();
    if (navigator.clipboard) navigator.clipboard.writeText(fp.dataset.fp);
    fp.textContent = "copied \\u2713";
    clearTimeout(fp._t);
    fp._t = setTimeout(function () { fp.textContent = fp.dataset.fp; }, 1400);
  });

  apply();
})();
</script>
</body>
</html>`;
}

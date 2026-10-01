import { styleText } from "node:util";
import { displayPath } from "../lib/crawler/url";
import type { FindingType, RawFinding } from "../lib/findings";
import { findingKind } from "../lib/findings";
import {
  findingReferrers,
  groupByType,
  rowLabel,
  TYPE_LABELS,
  TYPE_SEVERITY,
} from "../lib/report";
import { truncate } from "../lib/text";

// styleText no-ops when the stream doesn't support color (pipes, NO_COLOR).
export type Style = Parameters<typeof styleText>[0];
export const paint = (style: Style, text: string) =>
  styleText(style, text, { validateStream: true });
export const dim = (t: string) => paint("dim", t);
export const bold = (t: string) => paint("bold", t);

/** Urgency → terminal color: red = fix now, yellow = should fix, green = FYI. */
const SEVERITY_COLOR: Record<"bad" | "warn" | "neutral", Style> = {
  bad: "red",
  warn: "yellow",
  neutral: "green",
};

export const sectionColor = (type: FindingType): Style =>
  SEVERITY_COLOR[TYPE_SEVERITY[type]];

const GLYPHS: Record<FindingType, string> = {
  broken_internal_link: "✗",
  redirect_chain: "⇄",
  orphan_page: "◌",
  sitemap_broken_url: "▤",
  missing_from_sitemap: "±",
  meta_tag_issue: "◇",
  duplicate_meta: "≡",
  image_issue: "▣",
  mixed_content: "⚠",
  hreflang_issue: "⇋",
  slow_page: "🐢",
  canonical_issue: "⧉",
  social_card_issue: "▢",
  structured_data_issue: "{}",
  deep_page: "≫",
  feed_issue: "𝘧",
  broken_anchor: "#",
  rendering_artifact: "�",
  staging_leak: "⚠",
  soft_404: "∅",
  broken_external_link: "↗",
  site_issue: "⚙",
  core_web_vitals: "◉",
  not_indexed: "⊘",
  accessibility_issue: "♿",
  security_issue: "🔒",
};

/** Referrer footnote shared by all row renderers. */
function referrerLine(f: RawFinding): string[] {
  const referrers = findingReferrers(f);
  if (referrers.length === 0) return [];
  const shown = referrers.slice(0, 3).map(displayPath).join(", ");
  const more = referrers.length > 3 ? ` +${referrers.length - 3} more` : "";
  return [`      ${dim(`↳ ${shown}${more}`)}`];
}

/**
 * Render a redirect chain keeping hosts visible whenever a hop crosses one —
 * "bare domain → www → app" is usually the entire story of the chain.
 */
function chainDisplay(chain: string[]): string {
  let prevHost: string | null = null;
  return chain
    .map((u) => {
      try {
        const url = new URL(u);
        const crossed = prevHost !== null && url.hostname !== prevHost;
        const first = prevHost === null;
        prevHost = url.hostname;
        return first || crossed
          ? `${url.hostname}${url.pathname}${url.search}`
          : url.pathname + url.search;
      } catch {
        return u;
      }
    })
    .join(" → ");
}

/**
 * One row (plus evidence footnotes) for a finding. Most types render via
 * their shared rowLabel; the few with richer inline evidence get custom rows.
 */
function renderRow(f: RawFinding): string[] {
  if (f.type === "broken_internal_link") {
    const badge = paint(
      "red",
      (f.detail.status || "ERR").toString().padStart(4),
    );
    return [
      `  ${badge}  ${bold(displayPath(f.detail.url))}`,
      ...referrerLine(f),
    ];
  }

  if (f.type === "redirect_chain") {
    const hops = f.detail.chain.length - 1;
    const badge = f.detail.loop
      ? paint("red", "LOOP".padStart(4))
      : paint("yellow", `${hops}↪`.padStart(4));
    const landing =
      f.detail.finalStatus >= 400
        ? ` ${paint("red", `(lands on ${f.detail.finalStatus})`)}`
        : "";
    return [
      `  ${badge}  ${bold(displayPath(f.detail.url))}${landing}`,
      `      ${dim(chainDisplay(f.detail.chain))}`,
      ...referrerLine(f),
    ];
  }

  if (f.type === "duplicate_meta") {
    const shown = f.detail.pages.slice(0, 3).join(", ");
    const more =
      f.detail.pageCount > 3 ? ` +${f.detail.pageCount - 3} more` : "";
    return [
      `   ${paint("yellow", "≡")}   ${bold(`${f.detail.pageCount} pages`)} ${dim(`share ${f.detail.field}`)} “${truncate(f.detail.value, 50)}”`,
      `       ${dim(shown + more)}`,
    ];
  }

  const color = sectionColor(f.type);
  const label = rowLabel(f);
  return [
    `   ${paint(color, GLYPHS[f.type])}   ${bold(truncate(label.main, 76))}  ${dim(label.qualifier)}`,
    ...referrerLine(f),
  ];
}

export function printPretty(findings: RawFinding[]) {
  if (findings.length === 0) {
    console.log(
      `\n${paint("green", "✓")} No findings. Clean site ${dim("(within the crawl budget)")}.`,
    );
    return;
  }

  const byType = groupByType(findings);
  const summary = [...byType.entries()]
    .map(([type, group]) =>
      paint(
        sectionColor(type),
        `${group.length} ${TYPE_LABELS[type].toLowerCase()}`,
      ),
    )
    .join(dim("  ·  "));
  console.log(`\n${bold(`${findings.length} findings`)}   ${summary}\n`);

  for (const [type, group] of byType) {
    const color = sectionColor(type);
    const label = TYPE_LABELS[type];
    console.log(
      `${paint(color, GLYPHS[type])} ${bold(label)} ${dim("─".repeat(Math.max(2, 44 - label.length)))} ${paint(color, String(group.length))}`,
    );
    for (const f of group) {
      for (const line of renderRow(f)) console.log(line);
    }
    console.log("");
  }
}

/** Compact rollup: counts per type, kind breakdowns, most-affected pages. */
export function printSummary(findings: RawFinding[]) {
  if (findings.length === 0) {
    console.log(`${paint("green", "✓")} No findings.`);
    return;
  }
  console.log(`\n${bold(`${findings.length} findings`)}\n`);

  const byType = groupByType(findings);
  for (const [type, group] of byType) {
    console.log(
      `  ${paint(sectionColor(type), String(group.length).padStart(4))}  ${TYPE_LABELS[type]}`,
    );
    const byKind = new Map<string, number>();
    for (const f of group) {
      const kind = findingKind(f);
      if (kind) byKind.set(kind, (byKind.get(kind) ?? 0) + 1);
    }
    for (const [kind, count] of [...byKind.entries()].sort(
      (a, b) => b[1] - a[1],
    )) {
      console.log(dim(`        ${count} ${kind.replaceAll("_", " ")}`));
    }
  }

  // Pages implicated most often, either as the defect or as a referrer.
  const pageCounts = new Map<string, number>();
  for (const f of findings) {
    const pages = new Set<string>(findingReferrers(f));
    if ("url" in f.detail && typeof f.detail.url === "string") {
      pages.add(f.detail.url);
    }
    for (const p of pages) pageCounts.set(p, (pageCounts.get(p) ?? 0) + 1);
  }
  const top = [...pageCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  if (top.length > 0) {
    console.log(`\n  ${bold("Most implicated pages")}`);
    for (const [page, count] of top) {
      console.log(
        `  ${paint("cyan", String(count).padStart(4))}  ${displayPath(page)}`,
      );
    }
  }
  console.log("");
}

import { displayPath } from "../crawler/url";
import type { RawFinding } from "../findings";
import { isOwnedIndexablePage } from "./guards";
import type { Detector } from "./types";

/** application/ld+json blocks that fail to parse or lack required schema fields. */
export const structuredData: Detector = {
  name: "structured-data",
  detect({ crawl }) {
    const findings: RawFinding[] = [];
    for (const page of crawl.pages.values()) {
      if (!isOwnedIndexablePage(page)) continue;

      if (page.jsonLdErrors) {
        findings.push({
          type: "structured_data_issue",
          key: `${page.url} parse_error`,
          title: `${page.jsonLdErrors} malformed JSON-LD block${page.jsonLdErrors > 1 ? "s" : ""} on ${displayPath(page.url)}`,
          detail: {
            url: page.url,
            kind: "parse_error",
            count: page.jsonLdErrors,
            note: "The block fails JSON.parse, so search engines ignore it entirely.",
          },
        });
      }

      const issues = page.jsonLdIssues ?? [];
      const grouped = new Map<string, number>();
      for (const issue of issues) {
        grouped.set(issue.kind, (grouped.get(issue.kind) ?? 0) + 1);
      }
      for (const [kind, count] of grouped) {
        const examples = issues
          .filter((i) => i.kind === kind)
          .slice(0, 3)
          .map((i) => i.message);
        findings.push({
          type: "structured_data_issue",
          key: `${page.url} ${kind}`,
          title: `${count} JSON-LD ${kind.replaceAll("_", " ")} issue${count > 1 ? "s" : ""} on ${displayPath(page.url)}`,
          detail: {
            url: page.url,
            kind,
            count,
            note: examples.join("; "),
            issues: examples,
          },
        });
      }
    }
    return findings;
  },
};

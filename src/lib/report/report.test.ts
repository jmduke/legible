import { describe, expect, it } from "vitest";
import type { RawFinding } from "../findings";
import { renderHtmlPendingReport, renderHtmlReport } from "./index";

describe("renderHtmlReport", () => {
  const findings: RawFinding[] = [
    {
      type: "broken_internal_link",
      key: "https://example.com/dead",
      title: "Broken link to /dead (404)",
      detail: {
        url: "https://example.com/dead",
        status: 404,
        linkedFrom: ["https://example.com/"],
      },
    },
    {
      type: "duplicate_meta",
      key: "title <script>alert(1)</script>",
      title: '2 pages share the same title: "<script>alert(1)</script>"',
      detail: {
        field: "title",
        value: "<script>alert(1)</script>",
        pageCount: 2,
        pages: ["/a", "/b"],
        pagesTruncated: false,
      },
    },
  ];

  it("renders counts and section labels", () => {
    const html = renderHtmlReport("https://example.com", findings);
    expect(html).toContain("<h1>example.com</h1>");
    expect(html).toContain("2 findings");
    expect(html).toContain("Duplicate titles/descriptions");
    // Severity tabs are derived from the finding mix.
    expect(html).toContain("errors 1");
    expect(html).toContain("warnings 1");
    expect(html).not.toContain("notes ");
  });

  it("groups findings into navigable categories", () => {
    const html = renderHtmlReport("https://example.com", findings);
    expect(html).toContain('data-cat="broken-links" data-sev="errors"');
    expect(html).toContain(
      'data-cat="duplicate-titles-descriptions" data-sev="warnings"',
    );
    expect(html).toContain('<button class="nav-item on" type="button"');
  });

  it("links a row to the page it is about", () => {
    const html = renderHtmlReport("https://example.com", findings);
    expect(html).toContain('<a href="https://example.com/dead"');
  });

  it("escapes finding content", () => {
    const html = renderHtmlReport("https://example.com", findings);
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("escapes finding content in the filter index too", () => {
    const html = renderHtmlReport("https://example.com", findings);
    expect(html).not.toMatch(/data-search="[^"]*<script/);
  });
});

describe("renderHtmlPendingReport", () => {
  it("shows scanning state and latest progress", () => {
    const html = renderHtmlPendingReport(
      "https://example.com",
      "crawled 42 pages in 3.1s",
    );
    expect(html).toContain("Scanning");
    expect(html).toContain("crawled 42 pages in 3.1s");
    expect(html).toContain("https://example.com");
    expect(html).toContain('role="status"');
  });
});

import { describe, expect, it } from "vitest";
import { fingerprint, type RawFinding } from "../findings";
import { diffFindings } from "./diff";

const finding = (key: string): RawFinding => ({
  type: "broken_internal_link",
  key,
  title: `Broken link to ${key}`,
  detail: { url: key, status: 404, linkedFrom: [] },
});

describe("diffFindings", () => {
  it("classifies created, persisted, regressed, and resolved", () => {
    const stillBroken = finding("https://example.com/still-broken");
    const newlyBroken = finding("https://example.com/newly-broken");
    const cameBack = finding("https://example.com/came-back");

    const diff = diffFindings(
      [stillBroken, newlyBroken, cameBack],
      [
        { fingerprint: fingerprint(stillBroken), status: "open" },
        { fingerprint: fingerprint(cameBack), status: "resolved" },
        { fingerprint: "aaaaaaaaaaaaaaaa", status: "open" },
        { fingerprint: "bbbbbbbbbbbbbbbb", status: "resolved" },
      ],
    );

    expect(diff.created.map((c) => c.finding.key)).toEqual([
      "https://example.com/newly-broken",
    ]);
    expect(diff.persisted.map((c) => c.finding.key)).toEqual([
      "https://example.com/still-broken",
    ]);
    expect(diff.regressed.map((c) => c.finding.key)).toEqual([
      "https://example.com/came-back",
    ]);
    // Only *open* undetected findings resolve; already-resolved stay put.
    expect(diff.resolved).toEqual(["aaaaaaaaaaaaaaaa"]);
  });

  it("dedupes findings with identical fingerprints", () => {
    const diff = diffFindings(
      [finding("https://example.com/a"), finding("https://example.com/a")],
      [],
    );
    expect(diff.created).toHaveLength(1);
  });
});

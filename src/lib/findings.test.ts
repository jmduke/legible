import { describe, expect, it } from "vitest";
import { fingerprint } from "./findings";

describe("fingerprint", () => {
  it("is stable for the same type and key", () => {
    const a = fingerprint({
      type: "broken_internal_link",
      key: "https://x.com/a",
    });
    const b = fingerprint({
      type: "broken_internal_link",
      key: "https://x.com/a",
    });
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{16}$/);
  });

  it("differs across types for the same key", () => {
    const a = fingerprint({
      type: "broken_internal_link",
      key: "https://x.com/a",
    });
    const b = fingerprint({ type: "orphan_page", key: "https://x.com/a" });
    expect(a).not.toBe(b);
  });
});

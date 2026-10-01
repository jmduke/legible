import { describe, expect, it } from "vitest";
import {
  hasBreadcrumbList,
  parseJsonLdBlocks,
  validateJsonLdObjects,
} from "./json-ld";

describe("json-ld validation", () => {
  it("flags missing @context and @type", () => {
    const { objects } = parseJsonLdBlocks(['{"name":"Acme"}']);
    const issues = validateJsonLdObjects(objects);
    expect(issues.map((i) => i.kind).sort()).toEqual([
      "missing_context",
      "missing_type",
    ]);
  });

  it("flags incomplete Article", () => {
    const { objects } = parseJsonLdBlocks([
      '{"@context":"https://schema.org","@type":"Article"}',
    ]);
    const issues = validateJsonLdObjects(objects);
    expect(issues.some((i) => i.kind === "incomplete_type")).toBe(true);
  });

  it("detects BreadcrumbList", () => {
    const { objects } = parseJsonLdBlocks([
      '{"@context":"https://schema.org","@type":"BreadcrumbList","itemListElement":[]}',
    ]);
    expect(hasBreadcrumbList(objects)).toBe(true);
  });
});

/** Minimal schema.org JSON-LD validation for crawl-time checks. */

export interface JsonLdIssue {
  kind:
    | "missing_context"
    | "missing_type"
    | "incomplete_type"
    | "conflicting_types";
  message: string;
  type?: string;
}

const TYPE_REQUIRED: Record<string, string[]> = {
  WebSite: ["name"],
  Organization: ["name"],
  Article: ["headline"],
  BreadcrumbList: ["itemListElement"],
  Product: ["name"],
};

/** Non-Latin script runs that likely need an inline lang attribute on en pages. */
const FOREIGN_SCRIPT =
  /[\u0400-\u04FF\u4E00-\u9FFF\u3040-\u309F\u30A0-\u30FF\u0600-\u06FF\u0590-\u05FF]/;

export function isForeignScriptText(text: string): boolean {
  return FOREIGN_SCRIPT.test(text);
}

export function parseJsonLdBlocks(rawBlocks: string[]): {
  objects: unknown[];
  parseErrors: number;
} {
  const objects: unknown[] = [];
  let parseErrors = 0;
  for (const raw of rawBlocks) {
    try {
      const parsed = JSON.parse(raw);
      flattenJsonLd(parsed, objects);
    } catch {
      parseErrors++;
    }
  }
  return { objects, parseErrors };
}

function flattenJsonLd(node: unknown, out: unknown[]): void {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const item of node) flattenJsonLd(item, out);
    return;
  }
  out.push(node);
  const record = node as Record<string, unknown>;
  if (record["@graph"]) flattenJsonLd(record["@graph"], out);
}

export function validateJsonLdObjects(objects: unknown[]): JsonLdIssue[] {
  const issues: JsonLdIssue[] = [];
  const typesByName = new Map<string, Set<string>>();

  for (const obj of objects) {
    if (!obj || typeof obj !== "object") continue;
    const record = obj as Record<string, unknown>;
    if (!record["@context"]) {
      issues.push({
        kind: "missing_context",
        message: "JSON-LD block missing @context",
      });
    }
    const typeRaw = record["@type"];
    const types = Array.isArray(typeRaw)
      ? typeRaw.map(String)
      : typeRaw
        ? [String(typeRaw)]
        : [];
    if (types.length === 0) {
      issues.push({
        kind: "missing_type",
        message: "JSON-LD block missing @type",
      });
      continue;
    }
    for (const type of types) {
      const required = TYPE_REQUIRED[type];
      if (!required) continue;
      const missing = required.filter((field) => {
        const val = record[field];
        return val === undefined || val === null || val === "";
      });
      if (missing.length > 0) {
        issues.push({
          kind: "incomplete_type",
          type,
          message: `${type} missing required field(s): ${missing.join(", ")}`,
        });
      }
      if (type === "WebSite" || type === "Organization") {
        const name = String(record.name ?? "");
        if (name) {
          const seen = typesByName.get(type) ?? new Set();
          if (seen.has(name) === false && seen.size > 0) {
            issues.push({
              kind: "conflicting_types",
              type,
              message: `Multiple ${type} entities with different names on one page`,
            });
          }
          seen.add(name);
          typesByName.set(type, seen);
        }
      }
    }
  }
  return issues;
}

export function hasBreadcrumbList(objects: unknown[]): boolean {
  for (const obj of objects) {
    if (!obj || typeof obj !== "object") continue;
    const typeRaw = (obj as Record<string, unknown>)["@type"];
    const types = Array.isArray(typeRaw)
      ? typeRaw.map(String)
      : typeRaw
        ? [String(typeRaw)]
        : [];
    if (types.includes("BreadcrumbList")) return true;
  }
  return false;
}

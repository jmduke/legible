import { describe, expect, it, vi } from "vitest";
import type { RawFinding } from "../findings";
import {
  buildEnvelope,
  buildEvent,
  parseDsn,
  SentryDestination,
} from "./sentry";

const DSN = "https://publickey@o123.ingest.sentry.io/456";

const finding: RawFinding = {
  type: "broken_internal_link",
  key: "https://example.com/dead",
  title: "Broken link to /dead (404)",
  detail: {
    url: "https://example.com/dead",
    status: 404,
    linkedFrom: ["https://example.com/"],
  },
};

const ctx = {
  siteOrigin: "https://example.com",
  fingerprint: "deadbeefdeadbeef",
  regressed: false,
};

describe("parseDsn", () => {
  it("extracts the envelope endpoint and public key", () => {
    expect(parseDsn(DSN)).toEqual({
      envelopeUrl: "https://o123.ingest.sentry.io/api/456/envelope/",
      publicKey: "publickey",
    });
  });

  it("rejects DSNs without key or project", () => {
    expect(() => parseDsn("https://sentry.io/")).toThrow();
  });
});

describe("buildEvent", () => {
  it("uses the finding fingerprint so Sentry groups occurrences", () => {
    const event = buildEvent(finding, ctx);
    expect(event.fingerprint).toEqual(["deadbeefdeadbeef"]);
    expect(event.message).toEqual({ formatted: finding.title });
    expect(event.tags).toMatchObject({ finding_type: "broken_internal_link" });
  });
});

describe("buildEnvelope", () => {
  it("produces three newline-delimited JSON lines", () => {
    const event = buildEvent(finding, ctx);
    const lines = buildEnvelope(event, DSN).trimEnd().split("\n");
    expect(lines).toHaveLength(3);
    expect(JSON.parse(lines[1])).toEqual({ type: "event" });
    expect(JSON.parse(lines[2]).fingerprint).toEqual(["deadbeefdeadbeef"]);
  });
});

describe("SentryDestination", () => {
  it("POSTs the envelope with sentry auth headers", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    const dest = new SentryDestination(
      { dsn: DSN, environment: "production" },
      fetchMock as unknown as typeof fetch,
    );
    const result = await dest.dispatch(finding, ctx);
    expect(result.ok).toBe(true);

    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://o123.ingest.sentry.io/api/456/envelope/");
    const headers = init.headers as Record<string, string>;
    expect(headers["x-sentry-auth"]).toContain("sentry_key=publickey");
  });

  it("reports failure without throwing", async () => {
    const fetchMock = vi.fn(async () => new Response("nope", { status: 403 }));
    const dest = new SentryDestination(
      { dsn: DSN, environment: "production" },
      fetchMock as unknown as typeof fetch,
    );
    const result = await dest.dispatch(finding, ctx);
    expect(result).toEqual({ ok: false, detail: "Sentry responded 403" });
  });
});

import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { RawFinding } from "../findings";
import { VERSION } from "../version";
import type { Destination, DispatchContext, DispatchResult } from "./types";

export const sentryConfigSchema = z.object({
  dsn: z.string().url(),
  environment: z.string().default("production"),
});
export type SentryConfig = z.infer<typeof sentryConfigSchema>;

interface ParsedDsn {
  envelopeUrl: string;
  publicKey: string;
}

export function parseDsn(dsn: string): ParsedDsn {
  // DSN format: {protocol}://{publicKey}@{host}/{projectId}
  const url = new URL(dsn);
  const projectId = url.pathname.replace(/^\//, "");
  if (!url.username || !projectId) {
    throw new Error("Invalid Sentry DSN: missing public key or project id");
  }
  return {
    envelopeUrl: `${url.protocol}//${url.host}/api/${projectId}/envelope/`,
    publicKey: url.username,
  };
}

/**
 * Build the Sentry event for a finding. The event's fingerprint is our
 * finding fingerprint, so Sentry groups every occurrence of the same problem
 * into one issue and reopens it (as a regression) if we emit again after the
 * customer resolved it.
 */
export function buildEvent(
  finding: RawFinding,
  ctx: DispatchContext,
): { event_id: string } & Record<string, unknown> {
  return {
    event_id: randomUUID().replaceAll("-", ""),
    timestamp: new Date().toISOString(),
    platform: "other",
    level: "warning",
    logger: "legible",
    message: { formatted: finding.title },
    fingerprint: [ctx.fingerprint],
    culprit: finding.key,
    tags: {
      finding_type: finding.type,
      site: ctx.siteOrigin,
      regressed: String(ctx.regressed),
    },
    extra: finding.detail,
  };
}

export function buildEnvelope(
  event: Record<string, unknown>,
  dsn: string,
): string {
  const header = {
    event_id: event.event_id,
    sent_at: new Date().toISOString(),
    dsn,
  };
  const itemHeader = { type: "event" };
  return `${JSON.stringify(header)}\n${JSON.stringify(itemHeader)}\n${JSON.stringify(event)}\n`;
}

export class SentryDestination implements Destination {
  kind = "sentry";

  constructor(
    private config: SentryConfig,
    private fetchImpl: typeof fetch = fetch,
  ) {}

  async dispatch(
    finding: RawFinding,
    ctx: DispatchContext,
  ): Promise<DispatchResult> {
    const { envelopeUrl, publicKey } = parseDsn(this.config.dsn);
    const event = {
      ...buildEvent(finding, ctx),
      environment: this.config.environment,
    };
    const envelope = buildEnvelope(event, this.config.dsn);

    try {
      const res = await this.fetchImpl(envelopeUrl, {
        method: "POST",
        headers: {
          "content-type": "application/x-sentry-envelope",
          "x-sentry-auth": `Sentry sentry_version=7, sentry_client=legible/${VERSION}, sentry_key=${publicKey}`,
        },
        body: envelope,
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) {
        return { ok: false, detail: `Sentry responded ${res.status}` };
      }
      return { ok: true, detail: String(event.event_id) };
    } catch (err) {
      return {
        ok: false,
        detail: err instanceof Error ? err.message : String(err),
      };
    }
  }
}

export function destinationFor(
  kind: string,
  config: Record<string, unknown>,
): Destination {
  switch (kind) {
    case "sentry":
      return new SentryDestination(sentryConfigSchema.parse(config));
    default:
      throw new Error(`Unknown destination kind: ${kind}`);
  }
}

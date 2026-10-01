import type { RawFinding } from "../findings";

export interface DispatchContext {
  siteOrigin: string;
  fingerprint: string;
  /** True when this finding was previously resolved and has come back. */
  regressed: boolean;
}

export interface DispatchResult {
  ok: boolean;
  /** Destination-side identifier (e.g. Sentry event_id) or error message. */
  detail: string;
}

/**
 * A destination turns a finding into a work item somewhere a team actually
 * looks. Implementations must be idempotent with respect to `fingerprint`:
 * sending the same finding twice must not create two work items.
 */
export interface Destination {
  kind: string;
  dispatch(finding: RawFinding, ctx: DispatchContext): Promise<DispatchResult>;
}

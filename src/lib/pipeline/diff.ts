import { fingerprint, type RawFinding } from "../findings";

export interface ExistingFinding {
  fingerprint: string;
  status: "open" | "resolved";
}

export interface FindingDiff {
  /** Never seen before: insert + dispatch. */
  created: Array<{ fingerprint: string; finding: RawFinding }>;
  /** Was resolved, detected again: reopen + dispatch as regression. */
  regressed: Array<{ fingerprint: string; finding: RawFinding }>;
  /** Still present: bump lastSeen, no dispatch. */
  persisted: Array<{ fingerprint: string; finding: RawFinding }>;
  /** Open findings the scan no longer detects: mark resolved. */
  resolved: string[];
}

/**
 * Pure lifecycle diff between what a scan detected and what we knew before.
 * Keeping this pure (no DB, no IO) is what makes the pipeline testable.
 */
export function diffFindings(
  detected: RawFinding[],
  existing: ExistingFinding[],
): FindingDiff {
  const existingByFp = new Map(existing.map((e) => [e.fingerprint, e]));
  // Detectors can emit the same problem twice (e.g. a URL that is both in
  // the sitemap and linked); last write wins per fingerprint.
  const detectedByFp = new Map(
    detected.map((f) => [fingerprint(f), f] as const),
  );

  const diff: FindingDiff = {
    created: [],
    regressed: [],
    persisted: [],
    resolved: [],
  };

  for (const [fp, finding] of detectedByFp) {
    const prior = existingByFp.get(fp);
    if (!prior) diff.created.push({ fingerprint: fp, finding });
    else if (prior.status === "resolved")
      diff.regressed.push({ fingerprint: fp, finding });
    else diff.persisted.push({ fingerprint: fp, finding });
  }

  for (const prior of existing) {
    if (prior.status === "open" && !detectedByFp.has(prior.fingerprint)) {
      diff.resolved.push(prior.fingerprint);
    }
  }

  return diff;
}

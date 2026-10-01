/** Truncate with an ellipsis; the one copy of this everyone shares. */
export function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

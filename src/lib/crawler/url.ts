/**
 * URL handling for the crawler. We normalize aggressively enough that the
 * same document doesn't get crawled twice, but never so much that we'd mask a
 * real problem (query strings are preserved; only fragments are dropped).
 */

export function normalizeUrl(raw: string, base?: string): string | null {
  let url: URL;
  try {
    url = base ? new URL(raw, base) : new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  url.hash = "";
  // Collapse default ports and trailing-slash-only differences on the root.
  if (url.pathname === "") url.pathname = "/";
  return url.toString();
}

/** True if `url` belongs to the site rooted at `origin` (www variants included). */
export function isInternal(url: string, origin: string): boolean {
  try {
    const a = new URL(url);
    const b = new URL(origin);
    const strip = (h: string) => h.replace(/^www\./, "");
    return strip(a.hostname) === strip(b.hostname);
  } catch {
    return false;
  }
}

/** Path shown in finding titles: keeps them readable and site-relative. */
export function displayPath(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname + u.search;
  } catch {
    return url;
  }
}

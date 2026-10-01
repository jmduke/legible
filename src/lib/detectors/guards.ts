import type { PageRecord } from "../crawler";

/**
 * Shared eligibility predicates so every detector states its policy instead
 * of hand-copying guard clauses. The ladder:
 *
 *   isLivePage           — answered 200, not robots-blocked
 *   isOwnedPage          — live AND the site owner's own content (not a
 *                          noFollow section like user archives). The bar for
 *                          user-facing quality checks: rendering artifacts,
 *                          staging leaks, slowness, alt text, social cards.
 *   isOwnedIndexablePage — owned AND not noindexed. The bar for
 *                          indexing-related checks: meta tags, duplicates,
 *                          canonicals, sitemap membership, depth, hreflang,
 *                          structured data.
 *
 * Existence checks (broken links, redirect chains) intentionally use none of
 * these: a dead URL is a dead URL no matter whose content links to it.
 */
export function isLivePage(page: PageRecord): boolean {
  return page.status === 200 && !page.blockedByRobots;
}

export function isOwnedPage(page: PageRecord): boolean {
  return isLivePage(page) && !page.noFollow;
}

export function isOwnedIndexablePage(page: PageRecord): boolean {
  return isOwnedPage(page) && !page.noindex;
}

/** Query-string URLs (pagination/filter variants) aren't canonical content. */
export function hasQueryString(page: PageRecord): boolean {
  return new URL(page.url).search !== "";
}

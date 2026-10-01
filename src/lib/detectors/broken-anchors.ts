import { displayPath } from "../crawler/url";
import type { RawFinding } from "../findings";
import { isOwnedPage } from "./guards";
import type { Detector } from "./types";

/**
 * Links whose #fragment names an id that doesn't exist on the target page.
 * The link "works" (page loads) but drops the reader at the top instead of
 * the promised section — rampant in docs, and almost no tool checks it.
 */
export const brokenAnchors: Detector = {
  name: "broken-anchors",
  detect({ crawl }) {
    // Collect referrers per broken (target, fragment) pair, then emit once.
    const broken = new Map<
      string,
      { target: string; fragment: string; referrers: Set<string> }
    >();

    for (const page of crawl.pages.values()) {
      // Source must be owned content; targets may be anything crawled.
      if (!isOwnedPage(page) || !page.fragmentLinks?.length) continue;
      for (const { target, fragment } of page.fragmentLinks) {
        if (fragment === "top") continue; // browser built-in
        if (fragment.startsWith(":~:")) continue; // text fragment, not an id
        const targetPage = crawl.pages.get(target);
        // Only judge targets we parsed; a redirected or uncrawled target
        // proves nothing about its ids.
        if (
          targetPage?.status !== 200 ||
          targetPage.redirectHops.length > 0 ||
          !targetPage.ids
        )
          continue;
        if (targetPage.ids.includes(fragment)) continue;

        const key = `${target}#${fragment}`;
        const entry = broken.get(key) ?? {
          target,
          fragment,
          referrers: new Set<string>(),
        };
        entry.referrers.add(page.url);
        broken.set(key, entry);
      }
    }

    const findings: RawFinding[] = [];
    for (const [key, { target, fragment, referrers }] of broken) {
      findings.push({
        type: "broken_anchor",
        key,
        title: `Broken anchor: ${displayPath(target)}#${fragment} — no such id on the page`,
        detail: { url: target, fragment, linkedFrom: [...referrers] },
      });
    }
    return findings;
  },
};

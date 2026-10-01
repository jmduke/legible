import * as cheerio from "cheerio";
import {
  hasBreadcrumbList,
  isForeignScriptText,
  type JsonLdIssue,
  parseJsonLdBlocks,
  validateJsonLdObjects,
} from "../json-ld";
import { isInternal, normalizeUrl } from "./url";

export interface PageMeta {
  /** Trimmed <title> text; empty string when the tag is missing or blank. */
  title: string;
  titleCount: number;
  /** Trimmed meta description; empty string when missing or blank. */
  description: string;
  descriptionCount: number;
  canonicalCount: number;
  /** rel=canonical exists but its href doesn't parse as a URL. */
  canonicalMalformed: boolean;
  h1Count: number;
  /** True when <html> has no lang attribute. */
  langMissing: boolean;
  /** Document starts with <!doctype html> (standards mode). */
  hasDoctype: boolean;
  /** UTF-8 charset declared via meta charset or http-equiv. */
  hasCharset: boolean;
  /** meta viewport present (mobile rendering). */
  hasViewport: boolean;
  /** Viewport disables pinch-zoom (user-scalable=no or maximum-scale=1). */
  viewportBlocksZoom: boolean;
  /** meta theme-color present. */
  hasThemeColor: boolean;
  /** meta color-scheme present. */
  hasColorScheme: boolean;
  /** Core Open Graph tags (og:image checked separately via socialImages). */
  hasOgTitle: boolean;
  hasOgDescription: boolean;
  hasOgUrl: boolean;
  hasOgType: boolean;
  hasOgImage: boolean;
  /** og:url or og:image present but not an absolute URL. */
  relativeOgUrl: boolean;
  relativeOgImage: boolean;
  /** Has Open Graph tags but no twitter:card. */
  missingTwitterCard: boolean;
  /** First heading-level skip found (e.g. "h1 → h3"), if any. */
  headingSkip?: string;
}

export interface PageA11y {
  hasSkipLink: boolean;
  hasMainLandmark: boolean;
  emptyLinkCount: number;
  genericLinkCount: number;
  unlabeledInputCount: number;
  emptyButtonCount: number;
  duplicateIdCount: number;
  inlineLangMissingCount: number;
  linkImageEmptyAltCount: number;
}

export interface ParsedPage {
  internalLinks: string[];
  noindex: boolean;
  canonicalUrl?: string;
  meta: PageMeta;
  images: Array<{ src: string; hasAlt: boolean }>;
  mixedContent: string[];
  hreflangs: Array<{ lang: string; href: string }>;
  ids: string[];
  fragmentLinks: Array<{ target: string; fragment: string }>;
  socialImages: string[];
  jsonLdErrors: number;
  feedUrls: string[];
  externalLinks: string[];
  youtubeEmbeds: string[];
  textArtifacts: Array<{ artifact: string; sample: string }>;
  softNotFound: boolean;
  stagingRefs: string[];
  iconHrefs: string[];
  /** apple-touch-icon link href, when declared. */
  appleTouchIconHref?: string;
  a11y: PageA11y;
  /** External script/stylesheet URLs loaded without an integrity attribute. */
  externalWithoutSri: string[];
  jsonLdIssues: JsonLdIssue[];
  hasBreadcrumbList: boolean;
  lazyLcpImage?: string;
  scriptHrefs: string[];
  stylesheetHrefs: string[];
  /** First /privacy-like link found in the page. */
  privacyPolicyHref?: string;
}

/** Hosts that should never be referenced from a production page. */
const STAGING_HOST_PATTERN =
  /^(localhost|127\.0\.0\.1|0\.0\.0\.0|.+\.(?:local|test|internal)|[^.]*staging[^.]*\..+|.+\.vercel\.app|.+\.netlify\.app|.+\.ngrok(?:-free)?\.(?:app|io|dev))(?::\d+)?$/i;

/** Byte sequences that betray double-encoded UTF-8 or replacement chars. */
const MOJIBAKE_MARKERS = [
  "â€™",
  "â€œ",
  "â€",
  "â€“",
  "â€”",
  "Ã©",
  "Ã¨",
  "Ã¼",
  "Ã¶",
  "Ã±",
  "ï¿½",
  "�",
];

const UNRENDERED_TEMPLATE = /\{\{\s*[#/]?[\w.\- ]+\s*\}\}|<%=?[^%]{0,60}%>/;

const SOFT_404_TITLE = /(^|\W)(404|page not found|not found)(\W|$)/i;

const YOUTUBE_EMBED =
  /^https?:\/\/(?:www\.)?(?:youtube(?:-nocookie)?\.com)\/embed\/([\w-]{6,})/i;

const VIEWPORT_BLOCKS_ZOOM =
  /(?:user-scalable\s*=\s*no|maximum-scale\s*=\s*1(?:\.0)?(?:[^0-9]|$))/i;

/** Link text that doesn't describe the destination (spec: descriptive link text). */
const GENERIC_LINK_TEXT =
  /^(click here|here|read more|learn more|more|continue reading|this page|link)$/i;

const SKIP_INPUT_TYPES = new Set([
  "hidden",
  "submit",
  "button",
  "reset",
  "image",
]);

function isAbsoluteUrl(raw: string | undefined): boolean {
  if (!raw?.trim()) return false;
  return /^https?:\/\//i.test(raw.trim());
}

/** Element/attribute pairs that load subresources (for mixed-content checks). */
const SUBRESOURCE_SELECTORS: Array<[string, string]> = [
  ["img[src]", "src"],
  ["script[src]", "src"],
  ['link[rel="stylesheet"][href]', "href"],
  ["iframe[src]", "src"],
  ["source[src]", "src"],
  ["video[src]", "src"],
  ["video[poster]", "poster"],
  ["audio[src]", "src"],
  ["object[data]", "data"],
  ["embed[src]", "src"],
];

export function parsePage(
  html: string,
  pageUrl: string,
  origin: string,
): ParsedPage {
  const $ = cheerio.load(html);
  const links = new Set<string>();
  const externalLinks = new Set<string>();
  const fragmentLinks: ParsedPage["fragmentLinks"] = [];
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;
    const normalized = normalizeUrl(href, pageUrl);
    if (!normalized) return;
    if (isInternal(normalized, origin)) {
      if (normalized !== pageUrl) links.add(normalized);
      // normalizeUrl strips fragments; recover them from the raw href.
      const hashIndex = href.indexOf("#");
      if (hashIndex !== -1) {
        const fragment = decodeURIComponent(href.slice(hashIndex + 1)).trim();
        if (fragment !== "")
          fragmentLinks.push({ target: normalized, fragment });
      }
    } else {
      externalLinks.add(normalized);
    }
  });

  const robotsContent = $('meta[name="robots"]').attr("content") ?? "";
  const noindex = robotsContent.toLowerCase().includes("noindex");

  const canonicals = $('link[rel="canonical"]');
  const canonicalHref = canonicals.first().attr("href");
  const canonicalUrl = canonicalHref
    ? (normalizeUrl(canonicalHref, pageUrl) ?? undefined)
    : undefined;

  const titles = $("head > title");
  const descriptions = $('meta[name="description"]');
  const viewportContent = $('meta[name="viewport"]').attr("content") ?? "";
  const ogUrlRaw = $('meta[property="og:url"]').attr("content") ?? "";
  const ogImageRaw = $('meta[property="og:image"]').attr("content") ?? "";
  const hasAnyOg =
    metaOgPresent($) || ogUrlRaw.trim() !== "" || ogImageRaw.trim() !== "";
  const meta: PageMeta = {
    title: titles.first().text().trim(),
    titleCount: titles.length,
    description: (descriptions.first().attr("content") ?? "").trim(),
    descriptionCount: descriptions.length,
    canonicalCount: canonicals.length,
    canonicalMalformed: Boolean(canonicalHref) && canonicalUrl === undefined,
    h1Count: $("h1").length,
    langMissing: !$("html").attr("lang")?.trim(),
    hasDoctype: /^\s*<!doctype\s+html/i.test(html),
    hasCharset:
      $("meta[charset]").length > 0 ||
      /charset/i.test(
        $('meta[http-equiv="Content-Type"]').attr("content") ?? "",
      ),
    hasViewport: viewportContent.length > 0,
    viewportBlocksZoom: VIEWPORT_BLOCKS_ZOOM.test(viewportContent),
    hasThemeColor: $('meta[name="theme-color"]').length > 0,
    hasColorScheme: $('meta[name="color-scheme"]').length > 0,
    hasOgTitle: Boolean($('meta[property="og:title"]').attr("content")?.trim()),
    hasOgDescription: Boolean(
      $('meta[property="og:description"]').attr("content")?.trim(),
    ),
    hasOgUrl: Boolean(ogUrlRaw.trim()),
    hasOgType: Boolean($('meta[property="og:type"]').attr("content")?.trim()),
    hasOgImage: Boolean(ogImageRaw.trim()),
    relativeOgUrl: Boolean(ogUrlRaw.trim()) && !isAbsoluteUrl(ogUrlRaw),
    relativeOgImage: Boolean(ogImageRaw.trim()) && !isAbsoluteUrl(ogImageRaw),
    missingTwitterCard:
      hasAnyOg && !$('meta[name="twitter:card"]').attr("content")?.trim(),
    headingSkip: findHeadingSkip($),
  };

  const images: ParsedPage["images"] = [];
  $("img[src]").each((_, el) => {
    const src = normalizeUrl($(el).attr("src") ?? "", pageUrl);
    if (!src) return;
    images.push({ src, hasAlt: $(el).attr("alt") !== undefined });
  });

  const mixedContent = new Set<string>();
  if (new URL(pageUrl).protocol === "https:") {
    for (const [selector, attr] of SUBRESOURCE_SELECTORS) {
      $(selector).each((_, el) => {
        const raw = $(el).attr(attr) ?? "";
        // Only literal http:// references are mixed content; protocol-relative
        // (//host) and relative URLs inherit https.
        if (raw.startsWith("http://")) mixedContent.add(raw);
      });
    }
  }

  const hreflangs: ParsedPage["hreflangs"] = [];
  $('link[rel="alternate"][hreflang]').each((_, el) => {
    const lang = $(el).attr("hreflang")?.trim();
    const href = normalizeUrl($(el).attr("href") ?? "", pageUrl);
    if (lang && href) hreflangs.push({ lang, href });
  });

  const ids: string[] = [];
  $("[id]").each((_, el) => {
    const id = $(el).attr("id")?.trim();
    if (id) ids.push(id);
  });
  $("a[name]").each((_, el) => {
    const name = $(el).attr("name")?.trim();
    if (name) ids.push(name);
  });

  const socialImages = new Set<string>();
  $('meta[property="og:image"], meta[name="twitter:image"]').each((_, el) => {
    const src = normalizeUrl($(el).attr("content") ?? "", pageUrl);
    if (src) socialImages.add(src);
  });

  const jsonLdRaw: string[] = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    jsonLdRaw.push($(el).text());
  });
  const { objects: jsonLdObjects, parseErrors: jsonLdErrors } =
    parseJsonLdBlocks(jsonLdRaw);
  const jsonLdIssues = validateJsonLdObjects(jsonLdObjects);
  const breadcrumbPresent = hasBreadcrumbList(jsonLdObjects);

  const feedUrls = new Set<string>();
  $(
    'link[rel="alternate"][type*="rss"], link[rel="alternate"][type*="atom"]',
  ).each((_, el) => {
    const href = normalizeUrl($(el).attr("href") ?? "", pageUrl);
    if (href) feedUrls.add(href);
  });

  const youtubeEmbeds = new Set<string>();
  $("iframe[src]").each((_, el) => {
    const match = ($(el).attr("src") ?? "").match(YOUTUBE_EMBED);
    if (match) youtubeEmbeds.add(match[1]);
  });

  const stagingRefs = new Set<string>();
  const collectStaging = (raw: string | undefined) => {
    if (!raw) return;
    try {
      const url = new URL(raw, pageUrl);
      if (
        (url.protocol === "http:" || url.protocol === "https:") &&
        !isInternal(url.toString(), origin) &&
        STAGING_HOST_PATTERN.test(url.host)
      ) {
        stagingRefs.add(url.toString());
      }
    } catch {
      /* unparseable href — not our problem here */
    }
  };
  $("a[href]").each((_, el) => collectStaging($(el).attr("href")));
  for (const [selector, attr] of SUBRESOURCE_SELECTORS) {
    $(selector).each((_, el) => collectStaging($(el).attr(attr)));
  }

  const iconHrefs: string[] = [];
  let appleTouchIconHref: string | undefined;
  $('link[rel~="icon"], link[rel="apple-touch-icon"]').each((_, el) => {
    const href = normalizeUrl($(el).attr("href") ?? "", pageUrl);
    if (!href) return;
    iconHrefs.push(href);
    const rel = ($(el).attr("rel") ?? "").toLowerCase();
    if (rel.includes("apple-touch-icon")) appleTouchIconHref = href;
  });

  const textArtifacts = findTextArtifacts($);
  const softNotFound = SOFT_404_TITLE.test(meta.title);
  const a11y = scanA11y($, ids);
  const externalWithoutSri = findExternalWithoutSri($, pageUrl, origin);
  const lazyLcpImage = findLazyLcpImage($, pageUrl);
  const scriptHrefs: string[] = [];
  $("script[src]").each((_, el) => {
    const src = normalizeUrl($(el).attr("src") ?? "", pageUrl);
    if (src) scriptHrefs.push(src);
  });
  const stylesheetHrefs: string[] = [];
  $('link[rel="stylesheet"][href]').each((_, el) => {
    const href = normalizeUrl($(el).attr("href") ?? "", pageUrl);
    if (href) stylesheetHrefs.push(href);
  });
  let privacyPolicyHref: string | undefined;
  $("a[href]").each((_, el) => {
    if (privacyPolicyHref) return;
    const href = $(el).attr("href") ?? "";
    if (/\/privacy|privacy-policy|privacypolicy/i.test(href)) {
      privacyPolicyHref = normalizeUrl(href, pageUrl) ?? undefined;
    }
  });

  return {
    internalLinks: [...links],
    noindex,
    canonicalUrl,
    meta,
    images,
    mixedContent: [...mixedContent],
    hreflangs,
    ids: [...new Set(ids)],
    fragmentLinks,
    socialImages: [...socialImages],
    jsonLdErrors,
    jsonLdIssues,
    hasBreadcrumbList: breadcrumbPresent,
    feedUrls: [...feedUrls],
    externalLinks: [...externalLinks],
    youtubeEmbeds: [...youtubeEmbeds],
    textArtifacts,
    softNotFound,
    stagingRefs: [...stagingRefs],
    iconHrefs,
    appleTouchIconHref,
    a11y,
    externalWithoutSri,
    lazyLcpImage,
    scriptHrefs,
    stylesheetHrefs,
    privacyPolicyHref,
  };
}

function metaOgPresent($: cheerio.CheerioAPI): boolean {
  return (
    Boolean($('meta[property="og:title"]').attr("content")?.trim()) ||
    Boolean($('meta[property="og:description"]').attr("content")?.trim()) ||
    Boolean($('meta[property="og:type"]').attr("content")?.trim())
  );
}

function findLazyLcpImage(
  $: cheerio.CheerioAPI,
  pageUrl: string,
): string | undefined {
  const first = $("body img[src]").first();
  if (first.length === 0) return undefined;
  if (first.attr("loading")?.toLowerCase() !== "lazy") return undefined;
  return normalizeUrl(first.attr("src") ?? "", pageUrl) ?? undefined;
}

function scanA11y($: cheerio.CheerioAPI, ids: string[]): PageA11y {
  const linkAccessibleName = (el: ReturnType<typeof $>): string => {
    const aria = el.attr("aria-label")?.trim();
    if (aria) return aria;
    const labelledby = el.attr("aria-labelledby");
    if (labelledby) {
      const parts = labelledby
        .split(/\s+/)
        .map((id) => $(`#${id}`).text().replace(/\s+/g, " ").trim())
        .filter(Boolean);
      if (parts.length > 0) return parts.join(" ");
    }
    const title = el.attr("title")?.trim();
    if (title) return title;
    const imgAlt = el.find("img[alt]").first().attr("alt")?.trim();
    if (imgAlt) return imgAlt;
    return el.text().replace(/\s+/g, " ").trim();
  };

  const inputHasLabel = (el: ReturnType<typeof $>): boolean => {
    if (el.attr("aria-label")?.trim()) return true;
    const labelledby = el.attr("aria-labelledby");
    if (labelledby?.trim()) return true;
    if (el.attr("title")?.trim()) return true;
    const id = el.attr("id")?.trim();
    if (id && $(`label[for="${id}"]`).length > 0) return true;
    if (el.closest("label").length > 0) return true;
    return false;
  };

  let hasSkipLink = false;
  $("a[href]").each((_, el) => {
    if (hasSkipLink) return;
    const href = ($(el).attr("href") ?? "").trim();
    const text = $(el).text().replace(/\s+/g, " ").trim().toLowerCase();
    const target = href.replace(/^#/, "").toLowerCase();
    if (
      href.startsWith("#") &&
      (/skip/.test(text) ||
        /^(main|content|main-content|page-content)$/.test(target))
    ) {
      hasSkipLink = true;
    }
  });

  const hasMainLandmark = $("main").length > 0 || $('[role="main"]').length > 0;

  let emptyLinkCount = 0;
  let genericLinkCount = 0;
  $("a[href]").each((_, el) => {
    const name = linkAccessibleName($(el));
    if (!name) {
      emptyLinkCount++;
      return;
    }
    if (GENERIC_LINK_TEXT.test(name)) genericLinkCount++;
  });

  let unlabeledInputCount = 0;
  $("input, select, textarea").each((_, el) => {
    const $el = $(el);
    const type = ($el.attr("type") ?? "").toLowerCase();
    if (SKIP_INPUT_TYPES.has(type)) return;
    if (!inputHasLabel($el)) unlabeledInputCount++;
  });

  let emptyButtonCount = 0;
  $("button, [role='button']").each((_, el) => {
    const $el = $(el);
    const name =
      $el.attr("aria-label")?.trim() ||
      $el.text().replace(/\s+/g, " ").trim() ||
      $el.attr("title")?.trim();
    if (!name) emptyButtonCount++;
  });

  const idCounts = new Map<string, number>();
  for (const id of ids) idCounts.set(id, (idCounts.get(id) ?? 0) + 1);
  const duplicateIdCount = [...idCounts.values()].filter((n) => n > 1).length;

  const docLang = ($("html").attr("lang") ?? "").split("-")[0].toLowerCase();
  let inlineLangMissingCount = 0;
  if (docLang === "en") {
    $("p, span, li, td, th, div, a, h1, h2, h3, h4, h5, h6").each((_, el) => {
      const $el = $(el);
      if ($el.attr("lang") || $el.parents("[lang]").length > 0) return;
      const text = $el.clone().children().remove().end().text().trim();
      if (text.length >= 4 && isForeignScriptText(text))
        inlineLangMissingCount++;
    });
  }

  let linkImageEmptyAltCount = 0;
  $("a[href] img[alt='']").each(() => {
    linkImageEmptyAltCount++;
  });

  return {
    hasSkipLink,
    hasMainLandmark,
    emptyLinkCount,
    genericLinkCount,
    unlabeledInputCount,
    emptyButtonCount,
    duplicateIdCount,
    inlineLangMissingCount,
    linkImageEmptyAltCount,
  };
}

function findExternalWithoutSri(
  $: cheerio.CheerioAPI,
  pageUrl: string,
  origin: string,
): string[] {
  const missing = new Set<string>();
  const check = (raw: string | undefined, selector: string) => {
    const normalized = raw ? normalizeUrl(raw, pageUrl) : null;
    if (!normalized || isInternal(normalized, origin)) return;
    if (!normalized.startsWith("https://") && !normalized.startsWith("http://"))
      return;
    missing.add(`${selector} ${normalized}`);
  };
  $("script[src]").each((_, el) => {
    if ($(el).attr("integrity")?.trim()) return;
    check($(el).attr("src"), "script");
  });
  $('link[rel="stylesheet"][href]').each((_, el) => {
    if ($(el).attr("integrity")?.trim()) return;
    check($(el).attr("href"), "stylesheet");
  });
  return [...missing];
}

/** First heading-level skip in document order (e.g. h1 followed by h3). */
function findHeadingSkip($: cheerio.CheerioAPI): string | undefined {
  let previous = 0;
  let skip: string | undefined;
  $("h1, h2, h3, h4, h5, h6").each((_, el) => {
    if (skip) return;
    const level = Number(el.tagName[1]);
    if (previous > 0 && level > previous + 1) {
      skip = `h${previous} → h${level}`;
    }
    previous = level;
  });
  return skip;
}

/**
 * Template/encoding debris in *rendered* text. Deliberately conservative:
 * code/pre/script/style are excluded (docs legitimately print "undefined"),
 * and bare "undefined"/"null"/"NaN" only count when they are the entire text
 * of a leaf element — the signature of an interpolation bug, not prose.
 */
function findTextArtifacts(
  $: cheerio.CheerioAPI,
): Array<{ artifact: string; sample: string }> {
  const artifacts: Array<{ artifact: string; sample: string }> = [];
  const seen = new Set<string>();
  const push = (artifact: string, sample: string) => {
    if (seen.has(artifact) || artifacts.length >= 10) return;
    seen.add(artifact);
    artifacts.push({ artifact, sample: sample.slice(0, 80).trim() });
  };

  const $body = $("body").clone();
  $body.find("script, style, noscript, template, code, pre, textarea").remove();
  const text = $body.text();

  if (text.includes("[object Object]"))
    push("[object Object]", "[object Object]");
  const template = text.match(UNRENDERED_TEMPLATE);
  if (template) push("unrendered template", template[0]);
  for (const marker of MOJIBAKE_MARKERS) {
    const index = text.indexOf(marker);
    if (index !== -1) {
      push("mojibake", text.slice(Math.max(0, index - 30), index + 30));
      break;
    }
  }

  $body.find("*").each((_, el) => {
    const $el = $(el);
    if ($el.children().length > 0) return;
    const leaf = $el.text().trim();
    if (leaf === "undefined" || leaf === "null" || leaf === "NaN") {
      push(`bare "${leaf}"`, `<${el.tagName}> containing only "${leaf}"`);
    }
  });

  return artifacts;
}

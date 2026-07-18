import * as cheerio from "cheerio";
import type { DiscoveredListingDraft } from "../types";

// nitkati-group.com is a client-rendered SPA (Vite/React) -- fetching its raw
// HTML over plain HTTP returns an empty `<div id="root">` shell. These
// functions are pure and never fetch anything themselves: they only parse an
// HTML string that the Playwright adapter (index.ts) already retrieved via
// `page.content()` *after* the browser rendered the page, so the DOM here
// reflects what a real visitor sees.
//
// The selectors/regexes below were built from an AI-rendered inspection of
// the live site (not a verified static fixture of its real DOM), since the
// site requires JS execution to inspect directly. Treat them as a first pass
// -- verify against `page.content()` output from a real run and tighten the
// selectors if card/detail markup differs from what's assumed here.

export const NITKATI_CATEGORY_MAP: Record<string, string> = {
  flights: "flight",
  hotels: "hotel",
  cruises: "cruise",
  "hotel-flight": "vacation",
  shows: "event",
  vouchers: "voucher",
  other: "other",
};

export function nitkatiCategoryFromUrl(url: string): string | null {
  const match = url.match(/\/category\/([a-z-]+)/);
  if (!match) return null;
  return NITKATI_CATEGORY_MAP[match[1]] ?? null;
}

export function parseCategoryPageLinks(html: string, baseUrl: string): string[] {
  const $ = cheerio.load(html);
  const links = new Set<string>();
  $('a[href*="/listing/"]').each((_, element) => {
    const href = $(element).attr("href");
    if (!href) return;
    try {
      links.add(new URL(href, baseUrl).toString());
    } catch {
      // ignore malformed hrefs
    }
  });
  return Array.from(links);
}

const PRICE_PATTERN = /₪\s?([\d,]+)/g;
// Anchored to a whole (short) leaf element's text -- see findLocationLabel.
// Matching this against a large concatenated block of body text instead would
// let the greedy character classes backtrack across unrelated sentences.
const LOCATION_LEAF_PATTERN = /^([^·]{1,40})·\s*([^·]{1,40})$/;

function extractPrices(text: string): number[] {
  const prices: number[] = [];
  for (const match of text.matchAll(PRICE_PATTERN)) {
    const value = Number(match[1].replaceAll(",", ""));
    if (Number.isFinite(value)) prices.push(value);
  }
  return prices;
}

function firstNonEmptyText($: cheerio.CheerioAPI, selectors: string[]): string | null {
  for (const selector of selectors) {
    const text = $(selector).first().text().trim();
    if (text) return text;
  }
  return null;
}

// Looks for a single leaf element (no element children) whose own text is
// exactly "City · Country", rather than regex-matching the whole page's
// concatenated text -- the latter lets a generic character class backtrack
// across unrelated sentences and grab garbage.
function findLocationLabel($: cheerio.CheerioAPI): string | null {
  let found: string | null = null;
  $("body *").each((_, element) => {
    if (found) return;
    const node = $(element);
    if (node.children().length > 0) return;
    const text = node.text().trim();
    if (text.length === 0 || text.length > 60) return;
    const match = text.match(LOCATION_LEAF_PATTERN);
    if (match) found = `${match[1].trim()} · ${match[2].trim()}`;
  });
  return found;
}

export function parseListingDetail(html: string, context: { url: string; category: string }): DiscoveredListingDraft {
  const $ = cheerio.load(html);
  const bodyText = $("body").text().replace(/\s+/g, " ").trim();

  const titleFromTag = $("title").text().split(/[|–-]/)[0]?.trim() || null;
  const title = firstNonEmptyText($, ["h1", '[class*="title" i]']) ?? titleFromTag ?? context.url;

  const description = firstNonEmptyText($, ['[class*="descr" i]', "p"]);

  const prices = extractPrices(bodyText);
  const price = prices.length > 0 ? Math.min(...prices) : null;

  const locationLabel = findLocationLabel($);

  const sellerUsername = firstNonEmptyText($, ['[class*="seller" i]', '[class*="contact" i]', '[class*="poster" i]']);

  const coverImage = $('img[src]:not([src*="icon"]):not([src*="logo"])').first().attr("src") ?? null;
  const coverImageUrl = coverImage ? new URL(coverImage, context.url).toString() : null;

  return {
    external_url: context.url,
    title,
    description,
    price,
    currency: "ILS",
    location_label: locationLabel,
    seller_username: sellerUsername,
    published_at: null,
    category: context.category,
    coverImageUrl,
  };
}

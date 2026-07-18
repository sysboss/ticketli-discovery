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

export interface ListingDetailInput {
  html: string;
  url: string;
  category: string;
}

export interface ListingDetailModelOutput {
  title: string | null;
  description: string | null;
  price: number | null;
  original_price: number | null;
  currency: string | null;
  location_label: string | null;
  seller_username: string | null;
  seller_phone_e164: string | null;
  preferred_contact_channel: string | null;
  published_at: string | null;
  cover_image_url: string | null;
  category_details_summary: string | null;
  category_details: unknown;
}

export interface ListingDetailExtractor {
  extract(input: ListingDetailInput): Promise<ListingDetailModelOutput>;
}

type CheerioElementInput = Parameters<cheerio.CheerioAPI>[0];

const TOKEN_HEAVY_SELECTORS = "script, style, noscript, template, svg, header, footer, nav, aside";
const NITKATI_DETAIL_MAIN_SELECTOR = 'main[class~="container"][class~="py-6"][class~="flex-1"]';
const LISTING_CARD_SELECTORS = ["article", "main", '[class*="listing" i]', '[class*="detail" i]', '[class*="card" i]', "body"];
const PRICE_MARKER_PATTERN = /₪|\bILS\b|\bNIS\b|מחיר|price/i;

function compactHtml(html: string): string {
  const $ = cheerio.load(html);
  $(TOKEN_HEAVY_SELECTORS).remove();
  $("*")
    .contents()
    .each((_, node) => {
      if (node.type === "comment") $(node).remove();
    });
  $("*").each((_, element) => {
    const node = $(element);
    const attributes = node.attr() ?? {};
    for (const attribute of Object.keys(attributes)) {
      if (!["href", "src", "alt"].includes(attribute)) node.removeAttr(attribute);
    }
  });
  return $.root().html()?.replace(/\s+/g, " ").replace(/>\s+</g, "><").trim() ?? "";
}

function scoreListingCandidate($: cheerio.CheerioAPI, element: CheerioElementInput): number {
  const node = $(element);
  const text = node.text().replace(/\s+/g, " ").trim();
  if (text.length < 20) return 0;
  const htmlLength = node.html()?.length ?? 0;
  return text.length + (node.find("h1").length > 0 ? 500 : 0) + (PRICE_MARKER_PATTERN.test(text) ? 350 : 0) + (node.find("img[src]").length > 0 ? 100 : 0) - htmlLength / 100;
}

export function extractListingCardHtml(html: string): string {
  const $ = cheerio.load(html);
  $(TOKEN_HEAVY_SELECTORS).remove();

  const nitkatiDetailMain = $(NITKATI_DETAIL_MAIN_SELECTOR).first();
  if (nitkatiDetailMain.length > 0) return compactHtml($.html(nitkatiDetailMain));

  let bestHtml: string | null = null;
  let bestScore = 0;
  for (const selector of LISTING_CARD_SELECTORS) {
    $(selector).each((_, element) => {
      const score = scoreListingCandidate($, element);
      if (score <= bestScore) return;
      bestScore = score;
      bestHtml = $.html(element);
    });
  }

  return compactHtml(bestHtml ?? $("body").html() ?? html);
}

function normalizePrice(price: number | null): number | null {
  return typeof price === "number" && Number.isFinite(price) && price > 0 ? price : null;
}

function normalizeText(value: string | null): string | null {
  const trimmed = value?.replace(/\s+/g, " ").trim();
  return trimmed ? trimmed : null;
}

function absoluteUrl(value: string | null, baseUrl: string): string | null {
  const normalized = normalizeText(value);
  if (!normalized) return null;
  try {
    return new URL(normalized, baseUrl).toString();
  } catch {
    return null;
  }
}

function mergeDescription(description: string | null, categoryDetailsSummary: string | null): string | null {
  const normalizedDescription = normalizeText(description);
  const normalizedDetails = normalizeText(categoryDetailsSummary);
  if (!normalizedDetails) return normalizedDescription;
  if (!normalizedDescription) return normalizedDetails;
  if (normalizedDescription.includes(normalizedDetails)) return normalizedDescription;
  return `${normalizedDescription}\n\nפרטי קטגוריה: ${normalizedDetails}`;
}

function normalizePhone(value: string | null): string | null {
  const digits = value?.replace(/\D/g, "") ?? "";
  if (!digits) return null;
  if (digits.startsWith("972")) return `+${digits}`;
  if (digits.startsWith("0")) return `+972${digits.slice(1)}`;
  return value?.startsWith("+") ? `+${digits}` : null;
}

// `extracted.category_details` is an object keyed by every category (flight, event, ...),
// with only the requested category's entry populated and the rest null -- pull out just
// that one entry so we store/send only what's relevant to this listing's category.
function extractCategoryDetails(categoryDetails: unknown, category: string): Record<string, unknown> | null {
  if (typeof categoryDetails !== "object" || categoryDetails === null) return null;
  const details = (categoryDetails as Record<string, unknown>)[category];
  if (typeof details !== "object" || details === null) return null;
  return details as Record<string, unknown>;
}

export async function parseListingDetail(html: string, context: { url: string; category: string }, extractor: ListingDetailExtractor): Promise<DiscoveredListingDraft> {
  const listingCardHtml = extractListingCardHtml(html);
  const extracted = await extractor.extract({ html: listingCardHtml, url: context.url, category: context.category });

  return {
    external_url: context.url,
    title: normalizeText(extracted.title) ?? context.url,
    description: mergeDescription(extracted.description, extracted.category_details_summary),
    price: normalizePrice(extracted.price),
    original_price: normalizePrice(extracted.original_price),
    currency: normalizeText(extracted.currency) ?? "ILS",
    location_label: normalizeText(extracted.location_label),
    seller_username: normalizeText(extracted.seller_username),
    seller_phone_e164: normalizePhone(extracted.seller_phone_e164),
    preferred_contact_channel: normalizeText(extracted.preferred_contact_channel),
    published_at: normalizeText(extracted.published_at),
    category: context.category,
    category_details: extractCategoryDetails(extracted.category_details, context.category),
    coverImageUrl: absoluteUrl(extracted.cover_image_url, context.url),
  };
}

import type { Page } from "playwright";
import type { DiscoveryQuery } from "../../apiClient";
import type { DiscoveredListingDraft, DiscoveryAdapter, SourceLogin } from "../types";
import { createOpenAiListingDetailExtractor } from "./aiExtraction";
import { nitkatiCategoryFromUrl, parseCategoryPageLinks, parseListingDetail, type ListingDetailExtractor } from "./parse";

// Best-effort: reveals seller contact info if it's gated behind a button. Not
// every listing has this button, and revealing it may require an
// authenticated session (see login() below) -- failures here are non-fatal,
// the listing is still recorded without a seller_username.
async function clickShowContactInfo(page: Page): Promise<void> {
  const button = page.getByText("הצג פרטי קשר").first();
  const visible = await button.isVisible({ timeout: 2000 }).catch(() => false);
  if (!visible) return;
  await button.click().catch(() => {});
  const confirmationButton = page.getByText("קראתי ומאשר/ת").first();
  const confirmationVisible = await confirmationButton.isVisible({ timeout: 2000 }).catch(() => false);
  if (confirmationVisible) {
    await confirmationButton.click().catch(() => {});
  }
  await page.waitForTimeout(500);
}

async function login(page: Page, credential: SourceLogin): Promise<void> {
  await page.goto("https://nitkati-group.com/auth", { waitUntil: "networkidle" });
  await page.locator('input[type="email"]').first().fill(credential.email).catch(() => {});
  await page.locator('input[type="password"]').first().fill(credential.password).catch(() => {});
  await page.locator('button[type="submit"]').first().click().catch(() => {});
  await page.waitForLoadState("networkidle").catch(() => {});
}

export async function discoverListings(page: Page, query: DiscoveryQuery, listingDetailExtractor: ListingDetailExtractor = createOpenAiListingDetailExtractor()): Promise<DiscoveredListingDraft[]> {
  await page.goto(query.url, { waitUntil: "networkidle" });
  const categoryHtml = await page.content();
  const links = parseCategoryPageLinks(categoryHtml, query.url);
  const category = nitkatiCategoryFromUrl(query.url) ?? query.category;

  const listings: DiscoveredListingDraft[] = [];
  let failures = 0;
  for (const link of links) {
    try {
      await page.goto(link, { waitUntil: "networkidle" });
      await clickShowContactInfo(page);
      const detailHtml = await page.content();
      const draft = await parseListingDetail(detailHtml, { url: link, category }, listingDetailExtractor);
      listings.push(draft);
    } catch (error) {
      failures += 1;
      console.warn("nitkati_group: failed to parse listing", link, error);
    }
  }
  if (links.length > 0 && listings.length === 0 && failures === links.length) {
    throw new Error(`nitkati_group: failed to extract details for all ${links.length} listing(s)`);
  }
  return listings;
}

export const nitkatiGroupAdapter: DiscoveryAdapter = {
  sourceName: "nitkati_group",
  login,
  discoverListings,
};

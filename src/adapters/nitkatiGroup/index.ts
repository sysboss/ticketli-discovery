import type { Page } from "playwright";
import type { DiscoveryQuery } from "../../apiClient";
import type { DiscoveredListingDraft, DiscoveryAdapter, SourceLogin } from "../types";
import { nitkatiCategoryFromUrl, parseCategoryPageLinks, parseListingDetail } from "./parse";

// Best-effort: reveals seller contact info if it's gated behind a button. Not
// every listing has this button, and revealing it may require an
// authenticated session (see login() below) -- failures here are non-fatal,
// the listing is still recorded without a seller_username.
async function clickShowContactInfo(page: Page): Promise<void> {
  const button = page.getByText("הצג פרטי קשר").first();
  const visible = await button.isVisible({ timeout: 2000 }).catch(() => false);
  if (!visible) return;
  await button.click().catch(() => {});
  await page.waitForTimeout(500);
}

async function login(page: Page, credential: SourceLogin): Promise<void> {
  await page.goto("https://nitkati-group.com/auth", { waitUntil: "networkidle" });
  await page.locator('input[type="email"]').first().fill(credential.email).catch(() => {});
  await page.locator('input[type="password"]').first().fill(credential.password).catch(() => {});
  await page.locator('button[type="submit"]').first().click().catch(() => {});
  await page.waitForLoadState("networkidle").catch(() => {});
}

async function discoverListings(page: Page, query: DiscoveryQuery): Promise<DiscoveredListingDraft[]> {
  await page.goto(query.url, { waitUntil: "networkidle" });
  const categoryHtml = await page.content();
  const links = parseCategoryPageLinks(categoryHtml, query.url);
  const category = nitkatiCategoryFromUrl(query.url) ?? query.category;

  const listings: DiscoveredListingDraft[] = [];
  for (const link of links) {
    try {
      await page.goto(link, { waitUntil: "networkidle" });
      await clickShowContactInfo(page);
      const detailHtml = await page.content();
      listings.push(parseListingDetail(detailHtml, { url: link, category }));
    } catch (error) {
      console.warn("nitkati_group: failed to parse listing", link, error);
    }
  }
  return listings;
}

export const nitkatiGroupAdapter: DiscoveryAdapter = {
  sourceName: "nitkati_group",
  login,
  discoverListings,
};

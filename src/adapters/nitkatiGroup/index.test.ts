import { describe, expect, it } from "vitest";
import type { Page } from "playwright";
import type { DiscoveryQuery } from "../../apiClient";
import { discoverListings } from "./index";
import type { ListingDetailExtractor } from "./parse";

const query: DiscoveryQuery = {
  id: "query-1",
  source_name: "nitkati_group",
  url: "https://nitkati-group.com/category/flights",
  category: "flight",
  query: null,
  location: null,
  radius_km: null,
  is_active: 1,
  last_crawled_at: null,
  last_crawl_status: null,
  last_crawl_error: null,
};

function createPage(contents: Record<string, string>) {
  let currentUrl = "";
  let contactRequested = false;
  let contactConfirmed = false;
  return {
    async goto(url: string) {
      currentUrl = url;
      contactRequested = false;
      contactConfirmed = false;
    },
    async content() {
      const html = contents[currentUrl];
      if (!html) throw new Error(`missing fixture for ${currentUrl}`);
      return contactConfirmed ? html.replace("<!-- gated-contact -->", '<div class="seller-contact">Dana K. 050-0000000 <a href="https://wa.me/972504555075">WhatsApp</a></div>') : html;
    },
    getByText(text: string) {
      return {
        first() {
          return {
            async isVisible() {
              if (text === "הצג פרטי קשר") return true;
              if (text === "קראתי ומאשר/ת") return contactRequested;
              return false;
            },
            async click() {
              if (text === "הצג פרטי קשר") contactRequested = true;
              if (text === "קראתי ומאשר/ת" && contactRequested) contactConfirmed = true;
            },
          };
        },
      };
    },
    async waitForTimeout() {},
  };
}

describe("discoverListings", () => {
  it("throws when every discovered detail page fails AI extraction", async () => {
    const page = createPage({
      "https://nitkati-group.com/category/flights": '<a href="/listing/one">one</a><a href="/listing/two">two</a>',
      "https://nitkati-group.com/listing/one": "<main><article><h1>One</h1></article></main>",
      "https://nitkati-group.com/listing/two": "<main><article><h1>Two</h1></article></main>",
    }) as unknown as Page;
    const extractor: ListingDetailExtractor = {
      async extract() {
        throw new Error("model unavailable");
      },
    };

    await expect(discoverListings(page, query, extractor)).rejects.toThrow("failed to extract details for all 2 listing");
  });

  it("clicks the contact reveal and confirmation buttons before sending listing HTML to AI", async () => {
    const page = createPage({
      "https://nitkati-group.com/category/flights": '<a href="/listing/one">one</a>',
      "https://nitkati-group.com/listing/one": "<main><article><h1>Flight deal</h1><!-- gated-contact --></article></main>",
    }) as unknown as Page;
    const extractor: ListingDetailExtractor = {
      async extract(input) {
        expect(input.html).toContain("Flight deal");
        expect(input.html).toContain("050-0000000");
        expect(input.html).toContain("https://wa.me/972504555075");
        expect(input.html).toContain("Dana K.");
        return {
          title: "Flight deal",
          description: null,
          price: null,
          original_price: null,
          currency: "ILS",
          location_label: null,
          seller_username: "Dana K. 050-0000000",
          seller_phone_e164: "+972504555075",
          preferred_contact_channel: "whatsapp",
          published_at: null,
          cover_image_url: null,
          category_details_summary: null,
          category_details: null,
        };
      },
    };

    const listings = await discoverListings(page, query, extractor);

    expect(listings).toHaveLength(1);
    expect(listings[0]?.seller_username).toBe("Dana K. 050-0000000");
    expect(listings[0]?.seller_phone_e164).toBe("+972504555075");
    expect(listings[0]?.preferred_contact_channel).toBe("whatsapp");
  });

  it("persists AI output instead of overriding detail fields from HTML", async () => {
    const page = createPage({
      "https://nitkati-group.com/category/flights": '<a href="/listing/one">one</a>',
      "https://nitkati-group.com/listing/one": '<main><article><h1>HTML title</h1><!-- gated-contact --></article></main>',
    }) as unknown as Page;
    const extractor: ListingDetailExtractor = {
      async extract() {
        return {
          title: "AI title",
          description: "AI description",
          price: 123,
          original_price: 456,
          currency: "ILS",
          location_label: "AI location",
          seller_username: "AI seller",
          seller_phone_e164: "+972501111111",
          preferred_contact_channel: "whatsapp",
          published_at: "2026-07-18T12:00:00.000Z",
          cover_image_url: "https://example.test/ai-cover.jpg",
          category_details_summary: null,
          category_details: null,
        };
      },
    };

    const listings = await discoverListings(page, query, extractor);

    expect(listings[0]).toMatchObject({
      title: "AI title",
      description: "AI description",
      price: 123,
      original_price: 456,
      location_label: "AI location",
      seller_username: "AI seller",
      seller_phone_e164: "+972501111111",
      preferred_contact_channel: "whatsapp",
      published_at: "2026-07-18T12:00:00.000Z",
      coverImageUrl: "https://example.test/ai-cover.jpg",
    });
  });
});

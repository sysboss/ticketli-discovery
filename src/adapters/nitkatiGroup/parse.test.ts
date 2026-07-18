import { describe, expect, it } from "vitest";
import { nitkatiCategoryFromUrl, parseCategoryPageLinks, parseListingDetail } from "./parse";

// These fixtures are a hand-built approximation of nitkati-group.com's
// rendered markup (the real site requires JS execution to inspect, so no
// verified static fixture exists yet). They exercise the parsing logic's
// shape and regex fallbacks; re-validate/tighten selectors against real
// `page.content()` output from a live crawler run.

const CATEGORY_PAGE_HTML = `
  <html>
    <body>
      <div class="listing-grid">
        <a href="/listing/flight-to-new-york-123">
          <span class="badge">✈️ טיסות</span>
          <h3 class="title">מחיר מציאה לקיץ טיסה ישירה לניו יורק</h3>
          <span>ניו יורק · ארה״ב</span>
          <span class="price">₪8,393</span>
          <span class="price">₪5,250</span>
        </a>
        <a href="/listing/flight-to-paris-456">
          <h3 class="title">טיסה לפריז</h3>
        </a>
      </div>
    </body>
  </html>
`;

const DETAIL_PAGE_HTML = `
  <html>
    <body>
      <img src="/logo.svg" />
      <h1>מחיר מציאה לקיץ טיסה ישירה לניו יורק 3 כרטיסים עם ארקיע</h1>
      <img src="/uploads/flight-cover.jpg" />
      <p class="description">3 כרטיסי ישירה עם ארקיע ניתן לקנות גם בודדים כולל כבודה</p>
      <span>ניו יורק · ארה״ב</span>
      <span class="original-price">₪8,393</span>
      <span class="price">₪5,250</span>
      <div class="seller-name">Dana K.</div>
    </body>
  </html>
`;

describe("nitkatiCategoryFromUrl", () => {
  it("maps known category slugs to Ticketli categories", () => {
    expect(nitkatiCategoryFromUrl("https://nitkati-group.com/category/flights")).toBe("flight");
    expect(nitkatiCategoryFromUrl("https://nitkati-group.com/category/hotel-flight")).toBe("vacation");
    expect(nitkatiCategoryFromUrl("https://nitkati-group.com/category/shows")).toBe("event");
  });

  it("returns null for an unrecognized slug", () => {
    expect(nitkatiCategoryFromUrl("https://nitkati-group.com/category/unknown-thing")).toBeNull();
  });
});

describe("parseCategoryPageLinks", () => {
  it("extracts unique absolute listing detail URLs", () => {
    const links = parseCategoryPageLinks(CATEGORY_PAGE_HTML, "https://nitkati-group.com/category/flights");
    expect(links).toEqual([
      "https://nitkati-group.com/listing/flight-to-new-york-123",
      "https://nitkati-group.com/listing/flight-to-paris-456",
    ]);
  });
});

describe("parseListingDetail", () => {
  it("extracts title, description, lowest price, location, seller, and cover image", () => {
    const draft = parseListingDetail(DETAIL_PAGE_HTML, {
      url: "https://nitkati-group.com/listing/flight-to-new-york-123",
      category: "flight",
    });

    expect(draft).toMatchObject({
      external_url: "https://nitkati-group.com/listing/flight-to-new-york-123",
      title: "מחיר מציאה לקיץ טיסה ישירה לניו יורק 3 כרטיסים עם ארקיע",
      description: "3 כרטיסי ישירה עם ארקיע ניתן לקנות גם בודדים כולל כבודה",
      price: 5250,
      currency: "ILS",
      location_label: "ניו יורק · ארה״ב",
      seller_username: "Dana K.",
      category: "flight",
      coverImageUrl: "https://nitkati-group.com/uploads/flight-cover.jpg",
    });
  });

  it("falls back to null fields when optional markup is absent", () => {
    const draft = parseListingDetail("<html><body><h1>Bare listing</h1></body></html>", {
      url: "https://nitkati-group.com/listing/bare",
      category: "other",
    });

    expect(draft.title).toBe("Bare listing");
    expect(draft.price).toBeNull();
    expect(draft.location_label).toBeNull();
    expect(draft.seller_username).toBeNull();
    expect(draft.coverImageUrl).toBeNull();
  });
});

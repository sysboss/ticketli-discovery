import { describe, expect, it } from "vitest";
import { SYSTEM_PROMPT } from "./aiExtraction";
import { extractListingCardHtml, nitkatiCategoryFromUrl, parseCategoryPageLinks, parseListingDetail, type ListingDetailExtractor } from "./parse";

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
      <header><a href="/">Home</a><img src="/logo.svg" /></header>
      <img src="/logo.svg" />
      <main class="container py-6 flex-1">
        <article class="listing-detail-card" data-react-id="too-many-tokens">
          <h1>מחיר מציאה לקיץ טיסה ישירה לניו יורק 3 כרטיסים עם ארקיע</h1>
          <img class="cover" src="/uploads/flight-cover.jpg" />
          <p class="description">3 כרטיסי ישירה עם ארקיע ניתן לקנות גם בודדים כולל כבודה</p>
          <span>ניו יורק · ארה״ב</span>
          <span class="original-price">₪8,393</span>
          <span class="price">₪5,250</span>
          <div class="seller-name">Dana K.</div>
          <a href="https://wa.me/972504555075">וואטסאפ</a>
        </article>
        <section class="listing-extra-fields">
          <dl>
            <dt>מועד שינוי שם נוסע</dt>
            <dd>עד 2026-08-10</dd>
            <dt>כולל כבודה</dt>
            <dd>כן</dd>
          </dl>
        </section>
      </main>
      <footer>Footer links that should not reach the model</footer>
    </body>
  </html>
`;

const fakeExtractor: ListingDetailExtractor = {
  async extract(input) {
    expect(input.html).toContain("מחיר מציאה לקיץ");
    expect(input.html).toContain("מועד שינוי שם נוסע");
    expect(input.html).not.toContain("Footer links");
    expect(input.html).not.toContain("listing-detail-card");
    return {
      title: "מחיר מציאה לקיץ טיסה ישירה לניו יורק 3 כרטיסים עם ארקיע",
      description: "3 כרטיסי ישירה עם ארקיע ניתן לקנות גם בודדים כולל כבודה",
      price: 5250,
      original_price: 8393,
      currency: "ILS",
      location_label: "ניו יורק · ארה״ב",
      seller_username: "Dana K.",
      seller_phone_e164: "+972504555075",
      preferred_contact_channel: "whatsapp",
      published_at: null,
      cover_image_url: "/uploads/flight-cover.jpg",
      category_details_summary: "airline_name=ארקיע; passenger_count=3; baggage_included=true",
      category_details: null,
    };
  },
};

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

describe("extractListingCardHtml", () => {
  it("keeps the listing card while removing token-heavy chrome", () => {
    const html = extractListingCardHtml(DETAIL_PAGE_HTML);

    expect(html).toContain("מחיר מציאה לקיץ");
    expect(html).toContain("/uploads/flight-cover.jpg");
    expect(html).toContain("מועד שינוי שם נוסע");
    expect(html).toContain("עד 2026-08-10");
    expect(html).not.toContain("Footer links");
    expect(html).not.toContain("data-react-id");
    expect(html).not.toContain("<header>");
  });
});

describe("parseListingDetail", () => {
  it("uses an AI extractor on trimmed listing-card HTML and maps the model output", async () => {
    const draft = await parseListingDetail(DETAIL_PAGE_HTML, {
      url: "https://nitkati-group.com/listing/flight-to-new-york-123",
      category: "flight",
    }, fakeExtractor);

    expect(draft).toMatchObject({
      external_url: "https://nitkati-group.com/listing/flight-to-new-york-123",
      title: "מחיר מציאה לקיץ טיסה ישירה לניו יורק 3 כרטיסים עם ארקיע",
      price: 5250,
      original_price: 8393,
      currency: "ILS",
      location_label: "ניו יורק · ארה״ב",
      seller_username: "Dana K.",
      seller_phone_e164: "+972504555075",
      preferred_contact_channel: "whatsapp",
      category: "flight",
      coverImageUrl: "https://nitkati-group.com/uploads/flight-cover.jpg",
    });
    expect(draft.description).toContain("3 כרטיסי ישירה עם ארקיע ניתן לקנות גם בודדים כולל כבודה");
    expect(draft.description).toContain("airline_name=ארקיע");
  });

  it("carries the active category's detail object through as category_details", async () => {
    const hotelDetails = {
      property_name: "Sala Sami Chaweng",
      city: "Samui",
      country: "Thailand",
      check_in_at: "2026-10-09",
      check_out_at: "2026-10-11",
      nights: 2,
      guest_count: 2,
    };
    const draft = await parseListingDetail(DETAIL_PAGE_HTML, {
      url: "https://nitkati-group.com/listing/hotel-stay",
      category: "hotel",
    }, {
      async extract() {
        return {
          title: "Sala Sami Chaweng",
          description: null,
          price: 1,
          original_price: 4000,
          currency: "ILS",
          location_label: "Samui · Thailand",
          seller_username: "ליאן קריאף",
          seller_phone_e164: "+972504555075",
          preferred_contact_channel: "whatsapp",
          published_at: null,
          cover_image_url: null,
          category_details_summary: null,
          category_details: { flight: null, event: null, voucher: null, gift_card: null, hotel: hotelDetails, cruise: null, vacation: null, other: null },
        };
      },
    });

    expect(draft.category_details).toEqual(hotelDetails);
  });

  it("returns null category_details when the model has nothing for the active category", async () => {
    const draft = await parseListingDetail(DETAIL_PAGE_HTML, {
      url: "https://nitkati-group.com/listing/flight-to-new-york-123",
      category: "flight",
    }, fakeExtractor);

    expect(draft.category_details).toBeNull();
  });

  it("falls back to URL title and null fields when the model cannot extract optional values", async () => {
    const draft = await parseListingDetail("<html><body><h1>Bare listing</h1></body></html>", {
      url: "https://nitkati-group.com/listing/bare",
      category: "other",
    }, {
      async extract() {
        return {
          title: null,
          description: null,
          price: null,
          original_price: null,
          currency: null,
          location_label: null,
          seller_username: null,
          seller_phone_e164: null,
          preferred_contact_channel: null,
          published_at: null,
          cover_image_url: null,
          category_details_summary: null,
          category_details: null,
        };
      },
    });

    expect(draft.title).toBe("https://nitkati-group.com/listing/bare");
    expect(draft.price).toBeNull();
    expect(draft.original_price).toBeNull();
    expect(draft.location_label).toBeNull();
    expect(draft.seller_username).toBeNull();
    expect(draft.seller_phone_e164).toBeNull();
    expect(draft.preferred_contact_channel).toBeNull();
    expect(draft.coverImageUrl).toBeNull();
  });
});

describe("SYSTEM_PROMPT", () => {
  it("instructs the model to derive hotel check-out dates from check-in plus nights", () => {
    expect(SYSTEM_PROMPT).toContain('check_in_at "2026-10-09" and nights 2 means check_out_at "2026-10-11"');
  });
});

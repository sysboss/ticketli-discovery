import type { Page } from "playwright";
import type { DiscoveryQuery } from "../apiClient";

export interface DiscoveredListingDraft {
  external_url: string;
  title: string;
  description?: string | null;
  price?: number | null;
  original_price?: number | null;
  currency?: string;
  location_label?: string | null;
  seller_username?: string | null;
  seller_phone_e164?: string | null;
  preferred_contact_channel?: string | null;
  published_at?: string | null;
  category: string;
  /** The active category's detail object (e.g. hotel: {property_name, city, ...}), or null if none was extracted. */
  category_details?: Record<string, unknown> | null;
  coverImageUrl?: string | null;
}

export interface SourceLogin {
  email: string;
  password: string;
}

export interface DiscoveryAdapter {
  sourceName: string;
  /** Log in once per crawler run, before any query for this source is processed. */
  login?(page: Page, credential: SourceLogin): Promise<void>;
  /** Navigate to `query.url` and return every listing found there. */
  discoverListings(page: Page, query: DiscoveryQuery): Promise<DiscoveredListingDraft[]>;
}

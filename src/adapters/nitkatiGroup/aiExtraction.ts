import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";
import { loadConfig } from "../../config";
import type { ListingDetailExtractor, ListingDetailInput, ListingDetailModelOutput } from "./parse";

const CategoryDetailsSchema = z.object({
  flight: z
    .object({
      airline_name: z.string().nullable(),
      flight_number: z.string().nullable(),
      departure_airport: z.string().nullable(),
      arrival_airport: z.string().nullable(),
      departure_at: z.string().nullable(),
      arrival_at: z.string().nullable(),
      passenger_change_deadline_at: z.string().nullable(),
      ticket_class: z.string().nullable(),
      baggage_included: z.boolean().nullable(),
      trip_type: z.enum(["round", "oneway"]).nullable(),
      return_at: z.string().nullable(),
      passenger_count: z.number().int().nullable(),
      passenger_types: z.array(z.string()).nullable(),
    })
    .nullable(),
  event: z
    .object({
      event_name: z.string().nullable(),
      venue_name: z.string().nullable(),
      city: z.string().nullable(),
      event_date: z.string().nullable(),
      ticket_count: z.number().int().nullable(),
      seat_info_summary: z.string().nullable(),
      organizer_name: z.string().nullable(),
      section: z.string().nullable(),
      gate: z.string().nullable(),
      row: z.string().nullable(),
    })
    .nullable(),
  voucher: z
    .object({
      voucher_type: z.string().nullable(),
      redeemable_at: z.string().nullable(),
      usage_scope: z.string().nullable(),
      expiry_at: z.string().nullable(),
      quantity: z.number().int().nullable(),
      vendor_name: z.string().nullable(),
    })
    .nullable(),
  gift_card: z
    .object({
      brand_name: z.string().nullable(),
      card_type: z.string().nullable(),
      redemption_channel: z.string().nullable(),
      remaining_balance: z.number().nullable(),
      expiry_at: z.string().nullable(),
      quantity: z.number().int().nullable(),
    })
    .nullable(),
  hotel: z
    .object({
      property_name: z.string().nullable(),
      city: z.string().nullable(),
      country: z.string().nullable(),
      check_in_at: z.string().nullable(),
      check_out_at: z.string().nullable(),
      nights: z.number().int().nullable(),
      guest_count: z.number().int().nullable(),
    })
    .nullable(),
  cruise: z
    .object({
      location_text: z.string().nullable(),
      relevant_date: z.string().nullable(),
      quantity: z.number().int().nullable(),
    })
    .nullable(),
  vacation: z
    .object({
      location_text: z.string().nullable(),
      relevant_date: z.string().nullable(),
      quantity: z.number().int().nullable(),
    })
    .nullable(),
  other: z
    .object({
      location_text: z.string().nullable(),
      relevant_date: z.string().nullable(),
      quantity: z.number().int().nullable(),
    })
    .nullable(),
});

export const ListingDetailModelOutputSchema = z.object({
  title: z.string().nullable(),
  description: z.string().nullable(),
  price: z.number().nullable(),
  original_price: z.number().nullable(),
  currency: z.string().nullable(),
  location_label: z.string().nullable(),
  seller_username: z.string().nullable(),
  seller_phone_e164: z.string().nullable(),
  preferred_contact_channel: z.enum(["whatsapp", "phone", "telegram", "facebook", "unknown"]).nullable(),
  published_at: z.string().nullable(),
  cover_image_url: z.string().nullable(),
  category_details_summary: z.string().nullable(),
  category_details: CategoryDetailsSchema,
});

export const SYSTEM_PROMPT = `You extract listing details from a trimmed Hebrew/English HTML listing card for Ticketli discovery.

Return only the structured schema. Do not invent values. Use null when a value is absent or uncertain.

General listing fields:
- title: concise public listing title.
- description: seller-provided description or a concise faithful summary.
- price: seller asking/discounted price as a number, usually ILS.
- original_price: original/full price before discount as a number. If both a crossed-out price and current asking price are visible, original_price is the crossed-out/full price and price is the current asking price. Use null when no separate original/full price appears.
- currency: ISO 4217 currency code. Use ILS for ₪ or Hebrew shekel prices.
- location_label: visible location text, city/country, airport route, venue city, or similar.
- seller_username: visible seller/contact name after gated contact info is revealed.
- seller_phone_e164: seller phone number in E.164 format when present. For WhatsApp links like https://wa.me/972504555075, return +972504555075.
- preferred_contact_channel: set to whatsapp when a WhatsApp contact link (wa.me, api.whatsapp.com, or WhatsApp-labeled link) is present. Otherwise use phone/telegram/facebook when clearly preferred, unknown when a contact method exists but preference is unclear, or null when absent.
- published_at: ISO-like date if visible; otherwise null.
- cover_image_url: the main listing image URL/path if visible. Ignore logos and icons.

Category requirements from the Ticketli database schema:
- flight: airline_name, flight_number, departure_airport, arrival_airport, departure_at, arrival_at, passenger_change_deadline_at, ticket_class, baggage_included, trip_type (round/oneway), return_at, passenger_count, passenger_types.
- event: event_name, venue_name, city, event_date, ticket_count, seat_info_summary, organizer_name, section, gate, row.
- voucher: voucher_type, redeemable_at, usage_scope, expiry_at, quantity, vendor_name. Infer vendor_name from natural text when clear, e.g. "למכירה 10 שוברים של ארקיע" means vendor_name is "ארקיע" and quantity is 10.
- gift_card: brand_name, card_type, redemption_channel, remaining_balance, expiry_at, quantity.
- hotel: property_name, city, country, check_in_at, check_out_at, nights, guest_count. If check_in_at and nights are present but check_out_at is missing, calculate check_out_at by adding nights calendar days to check_in_at. Example: check_in_at "2026-10-09" and nights 2 means check_out_at "2026-10-11".
- cruise/vacation/other: location_text, relevant_date, quantity.

Set only the active category details object for the requested category when possible; other category detail objects should be null. Also provide category_details_summary as a compact Hebrew/English summary of the extracted category-specific values so they can be preserved in the staging description.`;

function userPrompt(input: ListingDetailInput): string {
  return `Source: nitkati_group\nCategory: ${input.category}\nListing URL: ${input.url}\n\nTrimmed listing-card HTML:\n${input.html}`;
}

function logDebugPrompt(messages: Array<{ role: "system" | "user"; content: string }>): void {
  console.debug("nitkati_group: OpenAI listing extraction prompt", JSON.stringify(messages, null, 2));
}

function logDebugOutput(output: ListingDetailModelOutput): void {
  console.debug("nitkati_group: OpenAI listing extraction output", JSON.stringify(output, null, 2));
}

export function createOpenAiListingDetailExtractor(): ListingDetailExtractor {
  const config = loadConfig();
  const client = new OpenAI({ apiKey: config.openAiApiKey });

  return {
    async extract(input: ListingDetailInput): Promise<ListingDetailModelOutput> {
      const messages = [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt(input) },
      ] satisfies Array<{ role: "system" | "user"; content: string }>;

      if (config.logLevel === "debug") logDebugPrompt(messages);

      const response = await client.responses.parse({
        model: config.openAiModel,
        input: messages,
        text: { format: zodTextFormat(ListingDetailModelOutputSchema, "nitkati_listing_detail") },
      });

      if (!response.output_parsed) {
        throw new Error("OpenAI listing extraction returned no parsed output");
      }

      if (config.logLevel === "debug") logDebugOutput(response.output_parsed);

      return response.output_parsed;
    },
  };
}

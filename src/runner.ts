import { chromium } from "playwright";
import { adapterRegistry } from "./adapters/registry";
import {
  DiscoveryApiError,
  fetchDueQueries,
  fetchSourceCredential,
  markQueryCrawled,
  upsertDiscoveredListing,
  uploadDiscoveredListingCover,
  type DiscoveryQuery,
} from "./apiClient";
import { loadConfig } from "./config";

const COVER_CONTENT_TYPES = new Set(["image/jpeg", "image/png"]);

async function fetchCoverBytes(url: string): Promise<{ contentType: string; bytes: Uint8Array } | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const contentType = response.headers.get("content-type")?.split(";")[0] ?? "";
    if (!COVER_CONTENT_TYPES.has(contentType)) return null;
    return { contentType, bytes: new Uint8Array(await response.arrayBuffer()) };
  } catch (error) {
    console.warn("Failed to download cover image", url, error);
    return null;
  }
}

async function processQuery(config: ReturnType<typeof loadConfig>, page: import("playwright").Page, query: DiscoveryQuery, loggedInSources: Set<string>): Promise<void> {
  const adapter = adapterRegistry[query.source_name];
  if (!adapter) {
    console.warn(`No adapter registered for source "${query.source_name}", skipping query ${query.id}`);
    return;
  }

  if (adapter.login && !loggedInSources.has(query.source_name)) {
    loggedInSources.add(query.source_name);
    try {
      const { items } = await fetchSourceCredential(config, query.source_name);
      if (items[0]) {
        await adapter.login(page, items[0]);
      } else {
        console.warn(`No stored credential for source "${query.source_name}"; continuing unauthenticated`);
      }
    } catch (error) {
      console.warn(`Login failed for source "${query.source_name}"`, error);
    }
  }

  try {
    const drafts = await adapter.discoverListings(page, query);
    for (const draft of drafts) {
      const { coverImageUrl, ...listingInput } = draft;
      const listing = await upsertDiscoveredListing(config, { ...listingInput, source_name: query.source_name, discovery_query_id: query.id });
      if (coverImageUrl) {
        const cover = await fetchCoverBytes(coverImageUrl);
        if (cover) {
          await uploadDiscoveredListingCover(config, listing.id, cover.contentType, cover.bytes).catch((error) => {
            console.warn(`Failed to upload cover for discovered listing ${listing.id}`, error);
          });
        }
      }
    }
    await markQueryCrawled(config, query.id, { status: "success" });
    console.log(`[${query.source_name}] query ${query.id}: ${drafts.length} listing(s) found`);
  } catch (error) {
    const message = error instanceof DiscoveryApiError ? error.message : String(error);
    console.warn(`Query ${query.id} (${query.source_name}) failed`, error);
    await markQueryCrawled(config, query.id, { status: "error", error: message }).catch(() => {});
  }
}

async function main(): Promise<void> {
  const config = loadConfig();
  const { items: queries } = await fetchDueQueries(config);
  console.log(`Processing ${queries.length} discovery quer${queries.length === 1 ? "y" : "ies"} (batch size ${config.batchSize})`);

  const browser = await chromium.launch();
  const loggedInSources = new Set<string>();
  try {
    const page = await browser.newPage();
    for (const query of queries) {
      await processQuery(config, page, query, loggedInSources);
    }
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error("Discovery run failed", error);
  process.exitCode = 1;
});

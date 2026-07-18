import type { DiscoveryConfig } from "./config";

export class DiscoveryApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
  ) {
    super(message);
  }
}

export interface DiscoveryQuery {
  id: string;
  source_name: string;
  url: string;
  category: string;
  query: string | null;
  location: string | null;
  radius_km: number | null;
  is_active: number;
  last_crawled_at: string | null;
  last_crawl_status: "success" | "error" | null;
  last_crawl_error: string | null;
}

export interface DiscoveredListingInput {
  discovery_query_id?: string;
  source_name: string;
  external_url: string;
  title: string;
  description?: string | null;
  price?: number | null;
  currency?: string;
  location_label?: string | null;
  seller_username?: string | null;
  published_at?: string | null;
  category: string;
}

export interface DiscoveredListingResult extends DiscoveredListingInput {
  id: string;
}

export interface SourceCredential {
  id: string;
  source_name: string;
  email: string;
  password: string;
}

async function call<T>(config: DiscoveryConfig, method: string, path: string, body?: unknown, extraHeaders: Record<string, string> = {}): Promise<T> {
  const response = await fetch(`${config.backendBaseUrl}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${config.adminToken}`,
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...extraHeaders,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const payload = (await response.json().catch(() => null)) as { success: boolean; data?: T; error?: { code: string; message: string } } | null;

  if (!response.ok || payload === null || !payload.success) {
    throw new DiscoveryApiError(payload?.error?.message ?? `${method} ${path} failed with ${response.status}`, response.status, payload?.error?.code);
  }

  return payload.data as T;
}

export function fetchDueQueries(config: DiscoveryConfig): Promise<{ items: DiscoveryQuery[] }> {
  return call(config, "GET", `/admin/discovery/queries?is_active=true&order_by=last_crawled_at&limit=${config.batchSize}`);
}

export function markQueryCrawled(config: DiscoveryConfig, queryId: string, outcome: { status: "success" | "error"; error?: string }): Promise<DiscoveryQuery> {
  return call(config, "PUT", `/admin/discovery/queries/${queryId}`, {
    last_crawled_at: new Date().toISOString(),
    last_crawl_status: outcome.status,
    last_crawl_error: outcome.error ?? null,
  });
}

export function upsertDiscoveredListing(config: DiscoveryConfig, listing: DiscoveredListingInput): Promise<DiscoveredListingResult> {
  return call(config, "POST", "/admin/discovery/listings", listing);
}

export async function uploadDiscoveredListingCover(config: DiscoveryConfig, listingId: string, contentType: string, bytes: Uint8Array): Promise<void> {
  const response = await fetch(`${config.backendBaseUrl}/admin/discovery/listings/${listingId}/cover`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${config.adminToken}`, "Content-Type": contentType },
    body: bytes,
  });

  const payload = (await response.json().catch(() => null)) as { success: boolean; error?: { code: string; message: string } } | null;
  if (!response.ok || payload === null || !payload.success) {
    throw new DiscoveryApiError(payload?.error?.message ?? `cover upload for ${listingId} failed with ${response.status}`, response.status, payload?.error?.code);
  }
}

export function fetchSourceCredential(config: DiscoveryConfig, sourceName: string): Promise<{ items: SourceCredential[] }> {
  return call(config, "GET", `/admin/discovery/credentials?source_name=${encodeURIComponent(sourceName)}`);
}

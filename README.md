# Ticketli Discovery

Standalone crawler that discovers listings on external sites and reports them to the Ticketli admin API.

## Overview

This package runs discovery jobs for Ticketli. It fetches due discovery queries from the backend, uses a source-specific Playwright adapter to crawl external listing pages, and upserts the discovered listings back through the admin API.

Current source support:

- `nitkati_group` - Playwright adapter for the Nitkati Group site. Category-page listing discovery is static, while detail-page extraction uses OpenAI on trimmed listing-card HTML.

## Requirements

- Node.js compatible with modern ESM and TypeScript tooling
- npm, pnpm, yarn, or another Node package manager
- Playwright browser dependencies installed for Chromium
- Access to the Ticketli backend admin discovery API

## Setup

Install dependencies:

```bash
npm install
```

Create a local environment file from the example:

```bash
cp .env.example .env
```

Configure:

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `BACKEND_BASE_URL` | Yes | `http://localhost:3000` in `.env.example` | Base URL of the Ticketli backend Worker API. |
| `DISCOVERY_ADMIN_TOKEN` | Yes | empty | Admin bearer token for `/admin/discovery/*` routes. Use a dedicated service/admin account. |
| `DISCOVERY_BATCH_SIZE` | No | `20` | Number of discovery queries to process per run. |
| `OPENAI_API_KEY` | Yes | empty | OpenAI API key for AI-based Nitkati listing detail extraction. Keep the real value only in local `.env`. |
| `OPENAI_MODEL` | No | `gpt-4.1-mini` | OpenAI model used for structured listing extraction. |
| `LOG_LEVEL` | No | `info` | Set to `debug` to print the OpenAI prompt payload and parsed model output for each extraction call. |

## Commands

```bash
npm start       # Run the crawler with tsx src/runner.ts
npm test        # Run Vitest tests
npm run lint    # Run TypeScript checks
npm run typecheck
```

There is no separate build step; this package runs TypeScript directly through `tsx` and validates with `tsc --noEmit`.

## Runtime Flow

1. `src/runner.ts` loads and validates environment configuration.
2. The runner fetches due discovery queries from `/admin/discovery/queries`.
3. Chromium is launched through Playwright.
4. For each query, `src/adapters/registry.ts` selects an adapter by `source_name`.
5. If the adapter supports login, the runner fetches source credentials from `/admin/discovery/credentials` and logs in once per source.
6. The adapter visits the query URL, trims each detail page down to the listing card, and asks OpenAI to extract the listing fields plus category-specific details from the schema.
7. Each listing draft is upserted through `/admin/discovery/listings`.
8. If a listing has `coverImageUrl`, the runner downloads it and uploads it to `/admin/discovery/listings/:id/cover`.
9. The query is marked as crawled successfully or with an error through `/admin/discovery/queries/:id`.

## Project Layout

```text
src/
  runner.ts                         # Main crawler entrypoint
  config.ts                         # Environment loading and validation
  apiClient.ts                      # Ticketli admin discovery API client
  adapters/
    types.ts                        # Adapter interfaces and listing draft types
    registry.ts                     # Source-name to adapter mapping
    nitkatiGroup/
      index.ts                      # Playwright adapter implementation
      parse.ts                      # HTML parsing helpers
      parse.test.ts                 # Parser tests
```

## Adding a Source Adapter

1. Create a new adapter under `src/adapters/<sourceName>/`.
2. Implement the interfaces from `src/adapters/types.ts`.
3. Register the adapter in `src/adapters/registry.ts` using the backend `source_name` value.
4. Add parser or adapter tests, especially for site-specific HTML extraction.
5. Run `npm test` and `npm run typecheck` before shipping.

## Notes

- Do not commit real admin tokens or site credentials.
- Keep crawler behavior idempotent: repeated runs should update existing listings instead of creating duplicates.
- Prefer parser unit tests for brittle HTML assumptions so source-site changes are easy to diagnose.

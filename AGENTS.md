# AGENTS.md

Guidance for automated coding agents and contributors working in this repository.

## Project Summary

`discovery` is a private TypeScript ESM package for crawling external listing sites and reporting discovered listings to the Ticketli backend admin API. The runtime entrypoint is `src/runner.ts`; the active adapter registry is in `src/adapters/registry.ts`.

## Required Commands

Run these before handing off changes:

```bash
npm run typecheck
npm test
```

`npm run lint` is currently the same as `npm run typecheck` (`tsc --noEmit`). There is no build command.

## Code Standards

- Preserve strict TypeScript safety. Do not use `as any`, `@ts-ignore`, or `@ts-expect-error`.
- Keep the package ESM-compatible (`"type": "module"`).
- Match existing source style: small modules, explicit exported types, and clear adapter boundaries.
- Keep environment access centralized in `src/config.ts`.
- Keep backend route usage centralized in `src/apiClient.ts` unless there is a strong reason to change the API abstraction.
- Do not commit secrets. Use `.env` locally and document new variables in `.env.example` and `README.md`.

## Adapter Guidance

- Adapter contracts live in `src/adapters/types.ts`.
- Register source adapters in `src/adapters/registry.ts` using the exact backend `source_name`.
- Put source-specific browser automation and parsing under `src/adapters/<sourceName>/`.
- Add tests for parsing logic when HTML assumptions are introduced or changed.
- Current registered source: `nitkati_group`.

## Verification Checklist

For source changes, verify the narrowest relevant scope first, then the full project checks:

1. Parser or adapter-specific tests, when applicable.
2. `npm test`
3. `npm run typecheck`

For documentation-only changes, review rendered Markdown and ensure commands, environment variables, and file paths match the current repository.

## Operational Notes

- The crawler reads `BACKEND_BASE_URL`, `DISCOVERY_ADMIN_TOKEN`, and `DISCOVERY_BATCH_SIZE` from the environment.
- `DISCOVERY_ADMIN_TOKEN` should be a dedicated service/admin token, not a human admin's personal token.
- Playwright launches Chromium during crawler runs, so browser availability can affect local execution.
- Discovery should remain idempotent: repeated runs must safely update existing backend records.

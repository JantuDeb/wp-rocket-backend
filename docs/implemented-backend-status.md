# Implemented Backend Status

This document summarizes what this backend currently implements relative to the self-hosted WP Rocket service contract.

## Compatibility Endpoints

The strict WP Rocket-compatible API surface is implemented and covered by contract tests:

- `GET /health`
- `POST /rucss-job`
- `GET /rucss-job`
- `POST /api/job/`
- `GET /api/job/:jobId/`
- `POST /performance/`
- `GET /performance/`
- `GET /recommendations/`
- `GET /api/v2/exclusions/list`
- `GET /api/v2/delay-js-exclusions/list`
- `GET /api/v2/incompatible-plugins/list`
- Product/account/CDN stub endpoints for pricing, remote settings, updates, plugin information, RocketCDN status/pricing/purge, and CDN iframe.

The compatibility endpoints preserve the response shapes expected by the existing WP Rocket client.

## Queue and Storage

Two execution modes are available:

- `QUEUE_DRIVER=memory`: default development/test mode. Jobs are stored in memory and browser work runs in-process.
- `QUEUE_DRIVER=redis`: Redis-backed job storage plus BullMQ producers/workers for RUCSS, Performance Hints, Critical CSS, and Performance jobs.

Redis mode persists job results and performance reports for `REDIS_JOB_TTL_SECONDS`.

`docker-compose.yml` starts Redis and the backend in Redis queue mode with health checks for both services.

## Browser-Backed Optimizations

Critical CSS generation uses local Chromium through Penthouse.

RUCSS uses Chromium CSS coverage and a PostCSS safe-parser pruning pass. The extractor keeps complete CSS rules instead of raw text fragments and preserves:

- matching used rules from browser coverage
- safelisted selectors, including regex-style safelist entries
- `:root` and custom property declarations
- `@font-face`
- keyframes referenced by kept animation declarations
- parent `@media`, `@supports`, and `@layer` wrappers around kept rules

Performance Hints reuse the RUCSS browser pass and return above-the-fold image/LCP arrays in the contract shape.

## Performance Reports

The WP Rocket-compatible `/performance/` endpoint still returns only the expected Rocket Insights metrics shape.

The additive `GET /reports/:jobId` endpoint returns richer JSON for a custom WP admin UI:

- metrics: performance score, LCP, TBT, CLS, TTFB
- detected issues: slow TTFB, slow LCP, high TBT, layout shifts, render-blocking resources, large JS/CSS, third-party impact
- resource evidence with plugin/theme/core/uploads/third-party attribution
- DOM evidence for LCP and layout-shift sources when browser APIs provide it
- source groups aggregating resources and issue IDs by plugin/theme/host/source type

## Recommendations

The legacy `GET /recommendations/` endpoint remains compatible and now uses submitted metrics when present.

The additive `GET /reports/:jobId/recommendations` endpoint converts a granular report into actionable recommendation cards with:

- source attribution fields
- linked issue IDs
- source URLs
- fix steps for the WP admin UI

## Tests

The suite covers:

- contract shapes for RUCSS, Performance Hints, CPCSS, Performance, Recommendations, and Dynamic Lists
- additive report and report recommendation endpoints
- PostCSS-based used-CSS pruning for nested `@media`, `@supports`, `@layer`, keyframes, custom properties, font faces, and safelists

Current verification commands:

```sh
npm run build
npm test
```

## Remaining Work

The largest remaining implementation gaps are:

- deeper RUCSS parity with WP Rocket SaaS behavior on complex production stylesheets
- inline script/style attribution to WordPress handles where the plugin can provide handle metadata
- richer LCP preload recommendations that identify exact hero image preload candidates
- integration tests that run Redis/BullMQ jobs in CI, not only local Docker smoke tests
- production hardening around queue concurrency, retry policies, observability, and report retention

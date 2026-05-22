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

BullMQ attempts, backoff, completed/failed job retention, and worker concurrency are configurable through environment variables. Redis job indexes prune expired job IDs when lists are read so dashboard views do not retain references after payload TTL expiry.

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
- LCP preload candidates with exact image URL, selector, source attribution, dimensions, loading state, preload status, matched preload URL, `srcset`, `sizes`, and `picture` source evidence
- resource evidence with plugin/theme/core/uploads/third-party attribution
- optional WordPress script/style handle attribution when performance job payloads include external or inline handle metadata
- DOM evidence for LCP and layout-shift sources when browser APIs provide it
- source groups aggregating resources and issue IDs by plugin/theme/host/source type
- observability fields for audit duration, browser launch/load/collection timing, resource count, issue count, and browser errors when available

## Recommendations

The legacy `GET /recommendations/` endpoint remains compatible and now uses submitted metrics when present.

The additive `GET /reports/:jobId/recommendations` endpoint converts a granular report into actionable recommendation cards with:

- source attribution fields
- linked issue IDs
- source URLs
- exact LCP image preload recommendations when a report identifies a non-preloaded hero/LCP candidate
- fix steps for the WP admin UI

## Admin Dashboard

The backend exposes a built-in operations surface:

- `GET /dashboard` renders a lightweight dashboard for recent jobs, queue health, report/recommendation detail, and retry actions.
- `GET /admin/jobs` lists recent jobs across RUCSS, Performance Hints, CPCSS, and Performance queues with pagination, state/kind filters, and URL/job search.
- `GET /admin/jobs/:jobId` returns the stored input/result for a single job.
- `POST /admin/jobs/:jobId/retry` retries a stored job in memory mode or requeues it in Redis/BullMQ mode.
- `POST /admin/jobs/:jobId/cancel` cancels pending jobs with compatibility-shaped failure results.
- `GET /admin/reports` lists completed performance reports with score, metrics, and issue counts.
- `GET /admin/reports/history` returns report history and latest-vs-previous metric deltas for a URL.
- `GET /admin/queues` returns queue health counts for waiting, active, delayed, completed, and failed jobs.

The dashboard includes job filtering/detail views, queue health, report/recommendation JSON detail, retry/cancel actions, and a report history view with metric deltas and compact trend bars. Memory and Redis storage both maintain enough job index data for these endpoints. Set `ADMIN_TOKEN` to require bearer-token authentication for `/dashboard` and `/admin/*`.

## Tests

The suite covers:

- contract shapes for RUCSS, Performance Hints, CPCSS, Performance, Recommendations, and Dynamic Lists
- admin job/report listing, filtering, queue health, retry/cancel endpoints, and the dashboard HTML shell
- dashboard report history controls wired to the history API
- opt-in Redis/BullMQ queue processing through real Redis with `RUN_REDIS_TESTS=1`
- additive report and report recommendation endpoints
- LCP preload candidate report fields and recommendation mapping
- external and inline WordPress handle attribution
- PostCSS-based used-CSS pruning for nested `@media`, `@supports`, `@layer`, keyframes, custom properties, font faces, and safelists
- wildcard dynamic-class safelists, multi-animation keyframe retention, and CSS registration at-rule preservation

Current verification commands:

```sh
npm run build
npm test
```

## Remaining Work

The largest remaining implementation gaps are:

- CI wiring for the opt-in Redis/BullMQ integration test using a Redis service container
- broader production RUCSS parity validation against a corpus of real themes/plugins
- browser-level tests for responsive LCP preload detection across live `srcset`, `picture`, and CDN rewrite scenarios
- richer long-term observability sinks, such as metrics export and alerting around worker/browser failure rates

# WP Rocket Backend

Self-hosted optimization backend for the WP Rocket fork.

## Development

```sh
npm install
npm run dev
```

The service listens on `http://localhost:8080` by default.

The built-in operations dashboard is available at:

```text
http://localhost:8080/dashboard
```

It shows recent jobs, queue health, job input/result detail, performance report detail, recommendations, retry/cancel actions, and report-history metric deltas for repeated URL audits.

Set `ADMIN_TOKEN` to require a bearer token for `/dashboard` and `/admin/*`:

```sh
ADMIN_TOKEN=local-secret npm run dev
curl -H 'authorization: Bearer local-secret' http://localhost:8080/admin/jobs
```

Memory-backed jobs and an in-memory tenant store are used by default. To run durable Redis/BullMQ jobs plus persistent accounts/sites/API keys locally:

```sh
QUEUE_DRIVER=redis \
REDIS_URL=redis://localhost:6379 \
TENANT_STORE_DRIVER=postgres \
DATABASE_URL=postgres://wp_rocket:wp_rocket@localhost:5432/wp_rocket_backend \
SAAS_AUTH_REQUIRED=true \
API_KEY_PEPPER=local-secret-pepper \
npm run dev
```

`docker-compose.yml` starts Redis, Postgres, and the backend in Redis/Postgres SaaS mode.

```sh
docker compose up --build
```

For production-style Docker with persistent Redis/Postgres volumes and required secrets:

```sh
POSTGRES_PASSWORD='replace-me' \
API_KEY_PEPPER='replace-me-too' \
ADMIN_TOKEN='admin-secret' \
docker compose -f docker-compose.prod.yml up --build -d
```

Once the backend is healthy, these commands exercise the Redis/BullMQ path:

```sh
curl http://localhost:8080/health

API_KEY=$(curl -s -X POST http://localhost:8080/account/signup \
  -H 'content-type: application/json' \
  -d '{"email":"local@example.com","site_url":"https://example.com"}' \
  | node -pe "JSON.parse(fs.readFileSync(0, 'utf8')).api_key.key")

PERF_ID=$(curl -s -X POST http://localhost:8080/performance/ \
  -H 'content-type: application/json' \
  -d "{\"url\":\"https://example.com\",\"email\":\"local@example.com\",\"credentials\":{\"wpr_key\":\"$API_KEY\"}}" \
  | node -pe "JSON.parse(fs.readFileSync(0, 'utf8')).uuid")

curl -H "x-api-key: $API_KEY" "http://localhost:8080/performance/?uuid=$PERF_ID"
curl -H "x-api-key: $API_KEY" "http://localhost:8080/reports/$PERF_ID"
curl -H "x-api-key: $API_KEY" "http://localhost:8080/reports/$PERF_ID/recommendations"
```

Redis/BullMQ production controls:

- `QUEUE_ATTEMPTS`: retry attempts per queued job.
- `QUEUE_BACKOFF_MS`: exponential backoff delay between attempts.
- `QUEUE_REMOVE_ON_COMPLETE_COUNT` and `QUEUE_REMOVE_ON_COMPLETE_AGE_SECONDS`: completed BullMQ retention.
- `QUEUE_REMOVE_ON_FAIL_AGE_SECONDS`: failed BullMQ retention.
- `WORKER_CONCURRENCY`: worker concurrency per queue.

Redis/BullMQ integration coverage is opt-in so the default test suite does not require Redis:

```sh
RUN_REDIS_TESTS=1 REDIS_URL=redis://127.0.0.1:6379 npm test -- tests/contract/redis-queue.integration.test.ts
RUN_POSTGRES_TESTS=1 DATABASE_URL=postgres://wp_rocket:wp_rocket@127.0.0.1:5432/wp_rocket_backend npm test -- tests/contract/postgres-tenant-store.integration.test.ts
```

Browser-backed fixture and live WordPress smoke coverage are also opt-in:

```sh
RUN_BROWSER_TESTS=1 PERFORMANCE_CHROMIUM_EXECUTABLE=/usr/bin/chromium npm test -- tests/contract/browser-lcp.fixture.test.ts
RUN_LIVE_WP_TESTS=1 LIVE_WP_URL=https://cbsepath.com/ PERFORMANCE_CHROMIUM_EXECUTABLE=/usr/bin/chromium npm test -- tests/contract/live-wordpress-performance.test.ts
```

To run those browser tests in Docker with Chromium installed:

```sh
docker compose --profile test run --rm browser-tests
```

## WordPress Constants

```php
define( 'WP_ROCKET_SAAS_API_URL', 'http://localhost:8080/' );
define( 'WP_ROCKET_CPCSS_API_URL', 'http://localhost:8080/api/job/' );
define( 'WP_ROCKET_EXCLUSIONS_API_URL', 'http://localhost:8080/api/v2/' );
```

## Current Scope

The backend implements contract-compatible responses for:

- `GET /health`
- `POST /account/signup`
- `GET /account/me`
- `GET /account/sites`
- `POST /account/sites`
- `POST /account/api-keys`
- `POST /rucss-job`
- `GET /rucss-job`
- `POST /api/job/`
- `GET /api/job/:jobId/`
- `POST /performance/`
- `GET /performance/`
- `GET /reports/:jobId`
- `GET /dashboard`
- `GET /admin/jobs`
- `GET /admin/jobs/:jobId`
- `POST /admin/jobs/:jobId/retry`
- `POST /admin/jobs/:jobId/cancel`
- `GET /admin/reports`
- `GET /admin/reports/history`
- `GET /admin/queues`
- `GET /admin/metrics`
- `GET /metrics`
- `POST /admin/reports/cleanup`
- `GET /recommendations/`
- `GET /api/v2/exclusions/list`
- `GET /api/v2/delay-js-exclusions/list`
- `GET /api/v2/incompatible-plugins/list`

Jobs use in-memory storage by default and Redis/BullMQ when `QUEUE_DRIVER=redis`. Critical CSS, RUCSS, Performance Hints, and Rocket Insights use local Chromium-backed workers outside `NODE_ENV=test`; tests keep deterministic fake output for speed.

Set `CPCSS_CHROMIUM_EXECUTABLE`, `RUCSS_CHROMIUM_EXECUTABLE`, and `PERFORMANCE_CHROMIUM_EXECUTABLE` when Chromium is not available at `/usr/bin/chromium`. Private network URLs are blocked by default for browser-backed jobs; enable the matching `*_ALLOW_PRIVATE_NETWORKS` flag only for trusted local development.

## Extended APIs

The WP Rocket-compatible endpoints keep their original response shapes. Additional client UI can use `GET /reports/:jobId` after a `/performance/` job completes to fetch granular JSON with metrics, detected issues, resource URLs, source attribution, and fix recommendations. Resource attribution maps same-origin `/wp-content/plugins/{slug}/...` and `/wp-content/themes/{slug}/...` URLs to plugin/theme slugs when possible.

## Account and API Key Flow

Create an account, register a site, and get a site-scoped API key:

```sh
curl -X POST http://localhost:8080/account/signup \
  -H 'content-type: application/json' \
  -d '{"email":"owner@example.com","site_url":"https://example.com"}'
```

Use the returned `api_key.key` in either an `x-api-key` header, a bearer token, or WP Rocket-style credentials:

```json
{
  "url": "https://example.com/",
  "credentials": {
    "wpr_email": "owner@example.com",
    "wpr_key": "wprb_returned_key"
  }
}
```

When `SAAS_AUTH_REQUIRED=true`, WP Rocket-compatible SaaS endpoints require a valid key. Site-scoped keys can only submit jobs for their registered domain or subdomains. This gives the connector plugin two setup options: send `x-api-key` for custom calls, or inject the key into WP Rocket's existing `credentials[wpr_key]` field.

Performance jobs may include optional WordPress handle metadata under `handles`, `resource_handles`, or `wp_handles`:

```json
{
  "url": "https://example.com/",
  "handles": [
    {
      "url": "https://example.com/wp-content/plugins/shop/assets/cart.js?ver=1.2.3",
      "handle": "shop-cart",
      "type": "script",
      "source_kind": "plugin",
      "source_slug": "shop"
    },
    {
      "handle": "theme-inline-critical",
      "type": "style",
      "source_kind": "theme",
      "source_slug": "storefront",
      "inline": true,
      "id": "storefront-inline-css"
    }
  ]
}
```

When a measured resource URL matches, reports preserve the handle in `resource.source.handle` and source groups separate that handle from other resources in the same plugin/theme. Inline handle metadata is preserved in `report.inline_sources` and added to `report.source_groups` with zero network resources so a UI can still attribute inline CSS/JS to the responsible handle.

Granular reports include `observability` with audit duration, browser launch/page load/collection timing when available, resource count, issue count, and browser error text for failed browser audits. Redis storage prunes expired job IDs from list indexes as retained job payloads age out, and workers log queue, attempt, and duration fields for completed and failed jobs.

LCP preload candidates include the selected image URL plus responsive evidence such as `srcset`, `sizes`, `picture_sources`, and any matching preload URL detected through `href` or `imagesrcset`. URL matching tolerates equivalent absolute/relative URLs and CDN host rewrites when the path and query identify the same image candidate.

Use `GET /reports/:jobId/recommendations` to turn a granular report into actionable recommendation cards with source attribution and fix steps. The legacy `GET /recommendations/` endpoint remains compatible with the WP Rocket client and also uses submitted metrics such as `lcp`, `ttfb`, `cls`, and `tbt` when present.

## Admin APIs

The dashboard uses these read/write admin endpoints:

- `GET /admin/jobs?kind=performance&state=completed&q=example&limit=50&offset=0`
- `GET /admin/jobs/:jobId`
- `POST /admin/jobs/:jobId/retry`
- `POST /admin/jobs/:jobId/cancel`
- `GET /admin/reports`
- `GET /admin/reports/history?url=https://example.com/`
- `GET /admin/queues`

`/admin/jobs/:jobId` returns input, result, attempts, timestamps, and report availability. Retry requeues Redis/BullMQ jobs when Redis mode is active; in memory mode it reruns the local worker function. Cancel marks pending jobs as failed with a compatibility-shaped result for the original polling endpoint.

`/admin/reports/history` returns completed reports for one URL and a latest-vs-previous metric delta when at least two reports exist.

`/admin/metrics` returns JSON totals for jobs, reports, queues, and audit observability. `/metrics` exposes the same data in Prometheus text format. Both endpoints honor `ADMIN_TOKEN` when it is set.

`POST /admin/reports/cleanup` deletes performance jobs older than `older_than_days` or `REPORT_RETENTION_DAYS`. Pass `dry_run=true` to preview matched/deleted counts without removing stored reports.

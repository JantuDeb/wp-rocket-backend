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

Memory-backed jobs are used by default. To run durable Redis/BullMQ jobs locally:

```sh
QUEUE_DRIVER=redis REDIS_URL=redis://localhost:6379 npm run dev
```

`docker-compose.yml` starts Redis and runs the backend in Redis queue mode.

```sh
docker compose up --build
```

Once the backend is healthy, these commands exercise the Redis/BullMQ path:

```sh
curl http://localhost:8080/health

PERF_ID=$(curl -s -X POST http://localhost:8080/performance/ \
  -H 'content-type: application/json' \
  -d '{"url":"https://example.com","email":"local@example.com"}' \
  | node -pe "JSON.parse(fs.readFileSync(0, 'utf8')).uuid")

curl "http://localhost:8080/performance/?uuid=$PERF_ID"
curl "http://localhost:8080/reports/$PERF_ID"
curl "http://localhost:8080/reports/$PERF_ID/recommendations"
```

Redis/BullMQ production controls:

- `QUEUE_ATTEMPTS`: retry attempts per queued job.
- `QUEUE_BACKOFF_MS`: exponential backoff delay between attempts.
- `QUEUE_REMOVE_ON_COMPLETE_COUNT` and `QUEUE_REMOVE_ON_COMPLETE_AGE_SECONDS`: completed BullMQ retention.
- `QUEUE_REMOVE_ON_FAIL_AGE_SECONDS`: failed BullMQ retention.
- `WORKER_CONCURRENCY`: worker concurrency per queue.

## WordPress Constants

```php
define( 'WP_ROCKET_SAAS_API_URL', 'http://localhost:8080/' );
define( 'WP_ROCKET_CPCSS_API_URL', 'http://localhost:8080/api/job/' );
define( 'WP_ROCKET_EXCLUSIONS_API_URL', 'http://localhost:8080/api/v2/' );
```

## Current Scope

The backend implements contract-compatible responses for:

- `GET /health`
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
- `GET /recommendations/`
- `GET /api/v2/exclusions/list`
- `GET /api/v2/delay-js-exclusions/list`
- `GET /api/v2/incompatible-plugins/list`

Jobs currently use in-memory storage. Critical CSS, RUCSS, Performance Hints, and Rocket Insights use local Chromium-backed workers outside `NODE_ENV=test`; tests keep deterministic fake output for speed.

Set `CPCSS_CHROMIUM_EXECUTABLE`, `RUCSS_CHROMIUM_EXECUTABLE`, and `PERFORMANCE_CHROMIUM_EXECUTABLE` when Chromium is not available at `/usr/bin/chromium`. Private network URLs are blocked by default for browser-backed jobs; enable the matching `*_ALLOW_PRIVATE_NETWORKS` flag only for trusted local development.

## Extended APIs

The WP Rocket-compatible endpoints keep their original response shapes. Additional client UI can use `GET /reports/:jobId` after a `/performance/` job completes to fetch granular JSON with metrics, detected issues, resource URLs, source attribution, and fix recommendations. Resource attribution maps same-origin `/wp-content/plugins/{slug}/...` and `/wp-content/themes/{slug}/...` URLs to plugin/theme slugs when possible.

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
    }
  ]
}
```

When a measured resource URL matches, reports preserve the handle in `resource.source.handle` and source groups separate that handle from other resources in the same plugin/theme.

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

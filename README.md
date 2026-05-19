# WP Rocket Backend

Self-hosted optimization backend for the WP Rocket fork.

## Development

```sh
npm install
npm run dev
```

The service listens on `http://localhost:8080` by default.

## WordPress Constants

```php
define( 'WP_ROCKET_SAAS_API_URL', 'http://localhost:8080/' );
define( 'WP_ROCKET_CPCSS_API_URL', 'http://localhost:8080/api/job/' );
define( 'WP_ROCKET_EXCLUSIONS_API_URL', 'http://localhost:8080/api/v2/' );
```

## Current Scope

This first milestone implements contract-compatible stub responses for:

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

Jobs use in-memory storage and complete after `JOB_COMPLETE_AFTER_MS`.

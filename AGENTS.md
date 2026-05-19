# Repository Guidelines

## Project Structure & Module Organization

This is a TypeScript Node.js service built around Fastify. Application source lives in `src/`, with HTTP entry points in `src/server.ts` and `src/app.ts`. Route handlers are under `src/http/routes/`, shared plugins under `src/http/plugins/`, contracts under `src/contracts/`, and domain logic under `src/services/`. Queue helpers live in `src/queues/`, job storage in `src/storage/`, and worker entry points in `src/workers/`. Static contract data is stored in `src/fixtures/`. Contract tests live in `tests/contract/`. Compiled output goes to `dist/` and should not be edited by hand.

## Build, Test, and Development Commands

- `npm install`: install dependencies from `package-lock.json`.
- `npm run dev`: run the Fastify server with `tsx watch src/server.ts`; default URL is `http://localhost:8080`.
- `npm run build`: type-check and compile with `tsc -p tsconfig.json` into `dist/`.
- `npm start`: run the compiled server from `dist/server.js`.
- `npm test`: run the Vitest suite once.
- `npm run test:watch`: run Vitest in watch mode while developing.

For local WordPress integration, copy `.env.example` to `.env` and point the `README.md` plugin constants at the local service.

## Coding Style & Naming Conventions

Use strict TypeScript with ES modules. Keep imports explicit and include `.js` extensions for local runtime imports, matching the existing NodeNext setup. Use two-space indentation, double quotes, `camelCase` for functions and variables, `PascalCase` for classes and types, and kebab-case filenames such as `dynamic-lists.ts`. Prefer small modules grouped by responsibility: route wiring in routes, validation shapes in contracts, and reusable behavior in services.

## Testing Guidelines

Tests use Vitest and Fastify injection. Add contract coverage in `tests/contract/*.test.ts` when changing endpoint behavior or response shapes. Name test files after the feature or endpoint group, for example `performance.test.ts`. Run `npm test` before submitting changes, and run `npm run build` when touching types, configuration, or module boundaries.

## Commit & Pull Request Guidelines

This repository currently has no commit history to infer a local convention. Use concise Conventional Commit-style subjects such as `feat: add rucss route contract` or `fix: preserve job status response`. Pull requests should include a short summary, linked issue or context, test results, and notes about API contract changes. Include screenshots only when a change affects documented WordPress setup or visible output.

## Security & Configuration Tips

Do not commit real secrets or environment-specific overrides. Keep `.env.example` as the documented baseline. Validate inbound request data with contract schemas before passing it into services or queues.

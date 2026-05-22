import { createServer, type Server } from "node:http";
import { existsSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { env } from "../../src/config/env.js";
import { auditPerformance } from "../../src/services/lighthouse/audit.js";

const runBrowserTests = process.env.RUN_BROWSER_TESTS === "1" && existsSync(process.env.PERFORMANCE_CHROMIUM_EXECUTABLE ?? "/usr/bin/chromium");
const describeBrowser = runBrowserTests ? describe : describe.skip;

let server: Server | undefined;
let baseUrl = "";

beforeEach(async () => {
  if (!runBrowserTests) {
    return;
  }

  server = createServer((request, response) => {
    if (request.url === "/hero-1200.jpg" || request.url === "/hero-800.jpg") {
      response.writeHead(200, {
        "content-type": "image/svg+xml",
        "cache-control": "public, max-age=3600",
      });
      response.end("<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"1200\" height=\"700\"><rect width=\"1200\" height=\"700\" fill=\"#1f7a5a\"/></svg>");
      return;
    }

    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(`<!doctype html>
      <html>
        <head>
          <link rel="preload" as="image" imagesrcset="/hero-800.jpg 800w, /hero-1200.jpg 1200w" imagesizes="100vw">
          <style>body{margin:0}.hero{display:block;width:100vw;height:auto}</style>
        </head>
        <body>
          <picture>
            <source media="(min-width: 900px)" srcset="/hero-1200.jpg 1200w" type="image/svg+xml">
            <img class="hero" src="/hero-800.jpg" srcset="/hero-800.jpg 800w, /hero-1200.jpg 1200w" sizes="100vw" width="1200" height="700" alt="">
          </picture>
        </body>
      </html>`);
  });
  await new Promise<void>((resolve) => {
    server?.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();

  if (!address || typeof address === "string") {
    throw new Error("Unable to start fixture server");
  }

  baseUrl = `http://127.0.0.1:${address.port}/`;
});

afterEach(async () => {
  await new Promise<void>((resolve) => server?.close(() => resolve()) ?? resolve());
  server = undefined;
});

describeBrowser("Browser LCP preload fixture", () => {
  it("captures responsive image preload evidence from a live page", async () => {
    env.NODE_ENV = "development";
    env.PERFORMANCE_ALLOW_PRIVATE_NETWORKS = true;
    env.PERFORMANCE_CHROMIUM_EXECUTABLE = process.env.PERFORMANCE_CHROMIUM_EXECUTABLE ?? "/usr/bin/chromium";

    const report = await auditPerformance({
      url: baseUrl,
      jobId: "browser_lcp_fixture",
    });
    const candidate = report.lcp_preload_candidates[0];

    expect(candidate).toMatchObject({
      as: "image",
      already_preloaded: true,
      srcset: expect.stringContaining("hero-1200.jpg"),
      picture_sources: [
        expect.objectContaining({
          srcset: expect.stringContaining("hero-1200.jpg"),
        }),
      ],
    });
    expect(candidate.matched_preload).toContain("hero-");
  }, 30000);
});

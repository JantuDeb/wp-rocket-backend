import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { env } from "../../src/config/env.js";
import { auditPerformance } from "../../src/services/lighthouse/audit.js";

const liveUrl = process.env.LIVE_WP_URL ?? "https://cbsepath.com/";
const runLiveTests = process.env.RUN_LIVE_WP_TESTS === "1" && existsSync(process.env.PERFORMANCE_CHROMIUM_EXECUTABLE ?? "/usr/bin/chromium");
const describeLive = runLiveTests ? describe : describe.skip;

describeLive("Live WordPress performance smoke", () => {
  it("audits cbsepath.com with the browser-backed performance collector", async () => {
    env.NODE_ENV = "development";
    env.PERFORMANCE_CHROMIUM_EXECUTABLE = process.env.PERFORMANCE_CHROMIUM_EXECUTABLE ?? "/usr/bin/chromium";
    env.PERFORMANCE_TIMEOUT_MS = Number(process.env.PERFORMANCE_TIMEOUT_MS ?? 45000);

    const report = await auditPerformance({
      url: liveUrl,
      jobId: "live_cbsepath",
    });

    expect(report.url).toContain(new URL(liveUrl).host);
    expect(report.metrics.performance_score).toEqual(expect.any(Number));
    expect(report.resources.length).toBeGreaterThan(0);
    expect(report.observability.audit_duration_ms).toBeGreaterThan(0);
  }, 60000);
});

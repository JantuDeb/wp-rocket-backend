import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { PerformanceReport } from "../../src/contracts/performance.js";
import { recommendationsForReport } from "../../src/services/recommendations/rules.js";
import { testApp } from "./test-app.js";

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
});

describe("Recommendations contract", () => {
  it("returns recommendations and metadata", async () => {
    app = await testApp();

    const response = await app.inject({
      method: "GET",
      url: "/recommendations/?email=customer%40example.com&language=en&tbt=750",
    });

    expect(response.json()).toMatchObject({
      recommendations: expect.any(Array),
      metadata: {
        language: "en",
        total_recommendations: expect.any(Number),
      },
    });
    expect(response.json().recommendations[0]).toMatchObject({
      option_slug: expect.any(String),
      title: expect.any(String),
    });
  });

  it("returns report-driven recommendations from the additive report endpoint", async () => {
    app = await testApp();

    const add = await app.inject({
      method: "POST",
      url: "/performance/",
      payload: {
        url: "https://example.com",
        email: "customer@example.com",
      },
    });
    const uuid = add.json().uuid;
    const response = await app.inject({
      method: "GET",
      url: `/reports/${uuid}/recommendations?language=en`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      recommendations: expect.any(Array),
      metadata: {
        language: "en",
        report_uuid: uuid,
        status: "completed",
        total_recommendations: expect.any(Number),
      },
    });
    expect(response.json().recommendations[0]).toMatchObject({
      option_slug: expect.any(String),
      fix_steps: expect.any(Array),
    });
  });

  it("does not treat millisecond report metrics as seconds", async () => {
    app = await testApp();

    const add = await app.inject({
      method: "POST",
      url: "/performance/",
      payload: {
        url: "https://example.com",
        email: "customer@example.com",
      },
    });
    const uuid = add.json().uuid;
    const response = await app.inject({
      method: "GET",
      url: `/reports/${uuid}/recommendations?language=en`,
    });

    expect(response.json().recommendations[0].option_slug).not.toBe("page_cache");
  });

  it("returns exact LCP image preload recommendations from granular reports", () => {
    const report: PerformanceReport = {
      uuid: "perf_lcp",
      url: "https://example.com/",
      generated_at: new Date(0).toISOString(),
      metrics: {
        report_url: "http://localhost:8080/reports/perf_lcp",
        performance_score: 72,
        largest_contentful_paint: { value: 3200 },
        total_blocking_time: { value: 80 },
        cumulative_layout_shift: { value: 0.01 },
        time_to_first_byte: { value: 250 },
      },
      issues: [
        {
          id: "lcp-preload-hero",
          type: "lcp_preload_candidate",
          severity: "high",
          metric: "lcp",
          title: "LCP image can be prioritized",
          description: "Hero image is not preloaded.",
          recommendation: "Preload the exact hero image.",
          evidence: [],
          preload_candidates: [
            {
              url: "https://example.com/wp-content/uploads/hero.jpg",
              selector: "img.hero",
              tag: "img",
              as: "image",
              fetchpriority: "high",
              source: {
                kind: "uploads",
                host: "example.com",
              },
              already_preloaded: false,
              current_loading: "lazy",
              width: 1280,
              height: 720,
            },
          ],
        },
      ],
      resources: [],
      inline_sources: [],
      dom_evidence: [],
      lcp_preload_candidates: [],
      source_groups: [],
      observability: {
        audit_duration_ms: 0,
        resource_count: 0,
        issue_count: 1,
      },
    };

    const recommendations = recommendationsForReport(report);

    expect(recommendations[0]).toMatchObject({
      option_slug: "preload_lcp_image",
      issue_id: "lcp-preload-hero",
      source_kind: "uploads",
      source_url: "https://example.com/wp-content/uploads/hero.jpg",
    });
  });
});

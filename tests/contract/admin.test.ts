import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { testApp } from "./test-app.js";

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
});

describe("Admin dashboard endpoints", () => {
  it("lists recent jobs across optimization queues", async () => {
    app = await testApp();

    const addPerformance = await app.inject({
      method: "POST",
      url: "/performance/",
      payload: {
        url: "https://example.com",
        email: "customer@example.com",
      },
    });
    const addRucss = await app.inject({
      method: "POST",
      url: "/rucss-job",
      payload: {
        url: "https://example.com/page",
        config: { optimization_list: ["rucss"] },
      },
    });
    const response = await app.inject({
      method: "GET",
      url: "/admin/jobs?limit=10",
    });
    const jobs = response.json().jobs;

    expect(response.statusCode).toBe(200);
    expect(jobs).toEqual(expect.any(Array));
    expect(jobs.map((job: { id: string }) => job.id)).toEqual(
      expect.arrayContaining([
        addPerformance.json().uuid,
        addRucss.json().contents.jobId,
      ]),
    );
    expect(jobs[0]).toMatchObject({
      id: expect.any(String),
      kind: expect.any(String),
      state: expect.any(String),
      created_at: expect.any(String),
      age_ms: expect.any(Number),
      has_report: expect.any(Boolean),
    });
  });

  it("filters jobs by kind and returns job detail", async () => {
    app = await testApp();

    await app.inject({
      method: "POST",
      url: "/api/job/",
      payload: {
        url: "https://example.com",
        mobile: 0,
      },
    });
    const list = await app.inject({
      method: "GET",
      url: "/admin/jobs?kind=cpcss",
    });
    const job = list.json().jobs[0];
    const detail = await app.inject({
      method: "GET",
      url: `/admin/jobs/${job.id}`,
    });

    expect(list.statusCode).toBe(200);
    expect(job.kind).toBe("cpcss");
    expect(detail.json()).toMatchObject({
      id: job.id,
      kind: "cpcss",
      input: expect.any(Object),
      result: expect.any(Object),
    });
  });

  it("filters jobs by state and search query", async () => {
    app = await testApp();

    await app.inject({
      method: "POST",
      url: "/performance/",
      payload: {
        url: "https://example.com/search-target",
        email: "customer@example.com",
      },
    });
    await app.inject({
      method: "POST",
      url: "/rucss-job",
      payload: {
        url: "https://example.com/other-page",
        config: { optimization_list: ["rucss"] },
      },
    });
    const response = await app.inject({
      method: "GET",
      url: "/admin/jobs?state=completed&q=search-target",
    });
    const jobs = response.json().jobs;

    expect(response.statusCode).toBe(200);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      kind: "performance",
      state: "completed",
      url: "https://example.com/search-target",
      attempts: 1,
      updated_at: expect.any(String),
    });
  });

  it("returns queue health in memory mode", async () => {
    app = await testApp();

    await app.inject({
      method: "POST",
      url: "/rucss-job",
      payload: {
        url: "https://example.com",
        config: { optimization_list: ["rucss"] },
      },
    });
    const response = await app.inject({
      method: "GET",
      url: "/admin/queues",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      queues: expect.arrayContaining([
        {
          kind: "rucss",
          waiting: expect.any(Number),
          active: 0,
          delayed: 0,
          completed: expect.any(Number),
          failed: expect.any(Number),
        },
      ]),
      metadata: {
        driver: "memory",
      },
    });
  });

  it("retries a failed job", async () => {
    app = await testApp();

    const add = await app.inject({
      method: "POST",
      url: "/performance/",
      payload: {
        email: "customer@example.com",
      },
    });
    const uuid = add.json().uuid;
    const failed = await app.inject({
      method: "GET",
      url: `/performance/?uuid=${uuid}`,
    });
    const retry = await app.inject({
      method: "POST",
      url: `/admin/jobs/${uuid}/retry`,
    });
    const detail = await app.inject({
      method: "GET",
      url: `/admin/jobs/${uuid}`,
    });

    expect(failed.json().status).toBe("failed");
    expect(retry.statusCode).toBe(202);
    expect(detail.json()).toMatchObject({
      id: uuid,
      state: "failed",
      attempts: 2,
    });
  });

  it("rejects cancel requests for completed jobs", async () => {
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
    const cancel = await app.inject({
      method: "POST",
      url: `/admin/jobs/${uuid}/cancel`,
    });

    expect(cancel.statusCode).toBe(409);
    expect(cancel.json()).toMatchObject({
      status: "failed",
      message: "Only pending jobs can be canceled",
    });
  });

  it("lists performance reports separately", async () => {
    app = await testApp();

    const add = await app.inject({
      method: "POST",
      url: "/performance/",
      payload: {
        url: "https://example.com",
        email: "customer@example.com",
      },
    });
    const response = await app.inject({
      method: "GET",
      url: "/admin/reports",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      reports: [
        {
          id: add.json().uuid,
          kind: "performance",
          report_url: expect.any(String),
          metrics: {
            performance_score: expect.any(Number),
          },
          issue_count: expect.any(Number),
        },
      ],
      metadata: {
        total: 1,
      },
    });
  });

  it("returns performance report history for a URL", async () => {
    app = await testApp();

    await app.inject({
      method: "POST",
      url: "/performance/",
      payload: {
        url: "https://example.com/history?utm=test",
        email: "customer@example.com",
      },
    });
    await app.inject({
      method: "POST",
      url: "/performance/",
      payload: {
        url: "https://example.com/history",
        email: "customer@example.com",
      },
    });
    const response = await app.inject({
      method: "GET",
      url: "/admin/reports/history?url=https%3A%2F%2Fexample.com%2Fhistory",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      url: "https://example.com/history",
      reports: [
        {
          id: expect.any(String),
          metrics: {
            performance_score: expect.any(Number),
          },
          issue_count: expect.any(Number),
        },
        {
          id: expect.any(String),
          metrics: {
            performance_score: expect.any(Number),
          },
          issue_count: expect.any(Number),
        },
      ],
      comparison: {
        performance_score: expect.any(Number),
        largest_contentful_paint: expect.any(Number),
      },
      metadata: {
        total: 2,
      },
    });
  });

  it("returns admin metrics in JSON and Prometheus formats", async () => {
    app = await testApp();

    await app.inject({
      method: "POST",
      url: "/performance/",
      payload: {
        url: "https://example.com/metrics",
        email: "customer@example.com",
      },
    });

    const json = await app.inject({
      method: "GET",
      url: "/admin/metrics",
    });
    const prometheus = await app.inject({
      method: "GET",
      url: "/metrics",
    });

    expect(json.statusCode).toBe(200);
    expect(json.json()).toMatchObject({
      jobs: {
        total: expect.any(Number),
        by_state: {
          completed: expect.any(Number),
        },
      },
      reports: {
        total: 1,
        average_score: expect.any(Number),
      },
      observability: {
        average_audit_duration_ms: expect.any(Number),
      },
    });
    expect(prometheus.statusCode).toBe(200);
    expect(prometheus.body).toContain("wp_rocket_backend_reports_total 1");
  });

  it("previews report retention cleanup", async () => {
    app = await testApp();

    await app.inject({
      method: "POST",
      url: "/performance/",
      payload: {
        url: "https://example.com/cleanup",
        email: "customer@example.com",
      },
    });
    const response = await app.inject({
      method: "POST",
      url: "/admin/reports/cleanup",
      payload: {
        older_than_days: 30,
        dry_run: true,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: "preview",
      older_than_days: 30,
      matched: expect.any(Number),
      deleted: 0,
      dry_run: true,
    });
  });

  it("serves the dashboard html", async () => {
    app = await testApp();

    const response = await app.inject({
      method: "GET",
      url: "/dashboard",
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/html");
    expect(response.body).toContain("WP Rocket Backend Dashboard");
    expect(response.body).toContain("Report history URL");
    expect(response.body).toContain("/admin/reports/history?url=");
  });
});

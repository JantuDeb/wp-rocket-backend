import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
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
});

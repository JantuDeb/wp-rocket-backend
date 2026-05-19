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
      url: "/recommendations/?email=customer%40example.com&language=en",
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
});

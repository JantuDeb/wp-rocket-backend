import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { testApp } from "./test-app.js";

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
});

describe("RUCSS contract", () => {
  it("queues a form-encoded job with job id and queue name", async () => {
    app = await testApp();

    const response = await app.inject({
      method: "POST",
      url: "/rucss-job",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: "url=https%3A%2F%2Fexample.com&config%5Boptimization_list%5D%5B0%5D=rucss",
    });

    expect([200, 201]).toContain(response.statusCode);
    expect(response.json()).toMatchObject({
      contents: {
        queueName: "rucss",
      },
    });
    expect(response.json().contents.jobId).toEqual(expect.stringMatching(/^rucss_/));
  });

  it("returns a wrapped completed response with shaken CSS", async () => {
    app = await testApp();

    const add = await app.inject({
      method: "POST",
      url: "/rucss-job",
      payload: {
        url: "https://example.com",
        config: { optimization_list: ["rucss"] },
      },
    });
    const jobId = add.json().contents.jobId;
    const status = await app.inject({
      method: "GET",
      url: `/rucss-job?id=${jobId}`,
    });

    expect(status.json().returnvalue).toMatchObject({
      code: 200,
      status: "completed",
      contents: {
        success: true,
      },
    });
    expect(status.json().returnvalue.contents.shakedCSS).toEqual(expect.any(String));
    expect(status.json().returnvalue.contents.shakedCSS.length).toBeGreaterThan(0);
  });
});

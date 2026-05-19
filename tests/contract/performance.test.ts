import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { testApp } from "./test-app.js";

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
});

describe("Performance endpoints", () => {
  it("returns above-the-fold arrays for performance hints through /rucss-job", async () => {
    app = await testApp();

    const add = await app.inject({
      method: "POST",
      url: "/rucss-job",
      payload: {
        url: "https://example.com",
        config: { optimization_list: ["performance_hints"] },
      },
    });
    const jobId = add.json().contents.jobId;
    const status = await app.inject({
      method: "GET",
      url: `/rucss-job?id=${jobId}&force_queue=performance_hints`,
    });
    const result = status.json().returnvalue.contents.above_the_fold_result;

    expect(add.json().contents.queueName).toBe("performance_hints");
    expect(result.lcp).toEqual(expect.any(Array));
    expect(result.images_above_fold).toEqual(expect.any(Array));
  });

  it("queues and completes a Rocket Insights performance test", async () => {
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
    const status = await app.inject({
      method: "GET",
      url: `/performance/?uuid=${uuid}`,
    });

    expect(add.json()).toMatchObject({ uuid, status: "pending" });
    expect(status.json()).toMatchObject({
      uuid,
      status: "completed",
      data: {
        data: {
          performance_score: expect.any(Number),
          report_url: expect.any(String),
        },
      },
    });
  });
});

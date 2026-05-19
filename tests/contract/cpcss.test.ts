import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { testApp } from "./test-app.js";

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
});

describe("Critical CSS contract", () => {
  it("queues a job and returns status 200 with data.id", async () => {
    app = await testApp();

    const response = await app.inject({
      method: "POST",
      url: "/api/job/",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: "url=https%3A%2F%2Fexample.com&mobile=0&nofontface=false",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: 200,
      data: {
        id: expect.stringMatching(/^cpcss_/),
      },
    });
  });

  it("returns complete state and critical_path", async () => {
    app = await testApp();

    const add = await app.inject({
      method: "POST",
      url: "/api/job/",
      payload: { url: "https://example.com", mobile: 0 },
    });
    const response = await app.inject({
      method: "GET",
      url: `/api/job/${add.json().data.id}/`,
    });

    expect(response.json()).toMatchObject({
      status: 200,
      data: {
        state: "complete",
        critical_path: expect.any(String),
      },
    });
  });
});

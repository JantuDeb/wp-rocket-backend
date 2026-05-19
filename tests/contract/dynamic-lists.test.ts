import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { getDynamicListHash } from "../../src/services/dynamic-lists/lists.js";
import { testApp } from "./test-app.js";

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
});

describe("Dynamic list contract", () => {
  it.each([
    "/api/v2/exclusions/list",
    "/api/v2/delay-js-exclusions/list",
    "/api/v2/incompatible-plugins/list",
  ])("returns a non-empty 200 body for %s", async (url) => {
    app = await testApp();

    const response = await app.inject({ method: "GET", url });

    expect(response.statusCode).toBe(200);
    expect(response.body.length).toBeGreaterThan(2);
  });

  it("returns a non-empty 206 body when the list hash matches", async () => {
    app = await testApp();
    const hash = getDynamicListHash("default");

    const response = await app.inject({
      method: "GET",
      url: `/api/v2/exclusions/list?hash=${hash}`,
    });

    expect(response.statusCode).toBe(206);
    expect(response.json()).toEqual({ message: "Lists are up to date" });
  });
});

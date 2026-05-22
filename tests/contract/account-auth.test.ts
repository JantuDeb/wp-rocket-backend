import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { env } from "../../src/config/env.js";
import { testApp } from "./test-app.js";

let app: FastifyInstance | undefined;

afterEach(async () => {
  env.SAAS_AUTH_REQUIRED = false;
  await app?.close();
});

describe("Account and API key auth", () => {
  it("creates an account, site, and site-scoped API key", async () => {
    app = await testApp();

    const response = await app.inject({
      method: "POST",
      url: "/account/signup",
      payload: {
        email: "owner@example.com",
        name: "Owner",
        site_url: "https://example.com",
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      account: {
        email: "owner@example.com",
        name: "Owner",
      },
      site: {
        url: "https://example.com",
        domain: "example.com",
      },
      api_key: {
        key: expect.stringMatching(/^wprb_/),
        prefix: expect.any(String),
      },
    });
  });

  it("accepts API keys through WP Rocket credentials", async () => {
    env.SAAS_AUTH_REQUIRED = true;
    app = await testApp();

    const signup = await app.inject({
      method: "POST",
      url: "/account/signup",
      payload: {
        email: "owner@example.com",
        site_url: "https://example.com",
      },
    });
    const apiKey = signup.json().api_key.key;
    const response = await app.inject({
      method: "POST",
      url: "/performance/",
      payload: {
        url: "https://example.com/page",
        email: "owner@example.com",
        credentials: {
          wpr_key: apiKey,
        },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      uuid: expect.any(String),
      status: "pending",
    });
  });

  it("rejects protected SaaS endpoints without a valid API key when required", async () => {
    env.SAAS_AUTH_REQUIRED = true;
    app = await testApp();

    const response = await app.inject({
      method: "POST",
      url: "/performance/",
      payload: {
        url: "https://example.com",
        email: "owner@example.com",
      },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({
      status: "failed",
      message: "Valid API key required",
    });
  });

  it("rejects site-scoped API keys for another domain", async () => {
    env.SAAS_AUTH_REQUIRED = true;
    app = await testApp();

    const signup = await app.inject({
      method: "POST",
      url: "/account/signup",
      payload: {
        email: "owner@example.com",
        site_url: "https://example.com",
      },
    });
    const response = await app.inject({
      method: "POST",
      url: "/performance/",
      headers: {
        "x-api-key": signup.json().api_key.key,
      },
      payload: {
        url: "https://other.example.org",
        email: "owner@example.com",
      },
    });

    expect(response.statusCode).toBe(401);
  });

  it("returns account details with a valid API key", async () => {
    app = await testApp();

    const signup = await app.inject({
      method: "POST",
      url: "/account/signup",
      payload: {
        email: "owner@example.com",
        site_url: "https://example.com",
      },
    });
    const response = await app.inject({
      method: "GET",
      url: "/account/me",
      headers: {
        authorization: `Bearer ${signup.json().api_key.key}`,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      account: {
        email: "owner@example.com",
      },
      site: {
        domain: "example.com",
      },
      api_key: {
        prefix: signup.json().api_key.prefix,
      },
    });
  });
});

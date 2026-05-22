import type { FastifyInstance } from "fastify";
import type { AccountMeResponse, AccountSignupResponse } from "../../contracts/account.js";
import type { TenantStore } from "../../storage/tenant-store.js";
import { requestData } from "./request.js";

export async function accountRoutes(app: FastifyInstance, tenantStore: TenantStore): Promise<void> {
  app.post("/account/signup", async (request, reply) => {
    const body = requestData(request);
    const email = requireString(body.email, "email").toLowerCase();
    const siteUrl = requireString(body.site_url ?? body.url, "site_url");
    const account = await tenantStore.createAccount({
      email,
      name: typeof body.name === "string" ? body.name : undefined,
    });
    const site = await tenantStore.createSite({
      accountId: account.id,
      url: siteUrl,
    });
    const apiKey = await tenantStore.createApiKey({
      accountId: account.id,
      siteId: site.id,
      name: typeof body.key_name === "string" ? body.key_name : site.domain,
    });

    return reply.code(201).send({
      account: {
        id: account.id,
        email: account.email,
        name: account.name,
      },
      site: {
        id: site.id,
        url: site.url,
        domain: site.domain,
      },
      api_key: {
        id: apiKey.id,
        name: apiKey.name,
        prefix: apiKey.prefix,
        key: apiKey.key,
      },
    } satisfies AccountSignupResponse);
  });

  app.get("/account/me", async (request, reply) => {
    if (!request.tenant) {
      return reply.code(401).send({
        status: "failed",
        message: "Valid API key required",
      });
    }

    return reply.code(200).send({
      account: {
        id: request.tenant.account.id,
        email: request.tenant.account.email,
        name: request.tenant.account.name,
      },
      site: request.tenant.site
        ? {
            id: request.tenant.site.id,
            url: request.tenant.site.url,
            domain: request.tenant.site.domain,
          }
        : undefined,
      api_key: {
        id: request.tenant.apiKey.id,
        name: request.tenant.apiKey.name,
        prefix: request.tenant.apiKey.prefix,
      },
    } satisfies AccountMeResponse);
  });

  app.get("/account/sites", async (request, reply) => {
    if (!request.tenant) {
      return reply.code(401).send({
        status: "failed",
        message: "Valid API key required",
      });
    }

    return reply.code(200).send({
      sites: await tenantStore.listSites(request.tenant.account.id),
    });
  });

  app.post("/account/sites", async (request, reply) => {
    if (!request.tenant) {
      return reply.code(401).send({
        status: "failed",
        message: "Valid API key required",
      });
    }

    const body = requestData(request);
    const site = await tenantStore.createSite({
      accountId: request.tenant.account.id,
      url: requireString(body.site_url ?? body.url, "site_url"),
    });

    return reply.code(201).send({ site });
  });

  app.post("/account/api-keys", async (request, reply) => {
    if (!request.tenant) {
      return reply.code(401).send({
        status: "failed",
        message: "Valid API key required",
      });
    }

    const body = requestData(request);
    const apiKey = await tenantStore.createApiKey({
      accountId: request.tenant.account.id,
      siteId: typeof body.site_id === "string" ? body.site_id : undefined,
      name: typeof body.name === "string" ? body.name : "API key",
    });

    return reply.code(201).send({
      api_key: {
        id: apiKey.id,
        name: apiKey.name,
        prefix: apiKey.prefix,
        key: apiKey.key,
      },
    });
  });
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Missing required field: ${field}`);
  }

  return value.trim();
}

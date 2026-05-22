import type { FastifyInstance } from "fastify";
import { env } from "../../config/env.js";
import { hostMatchesSite, type TenantContext, type TenantStore } from "../../storage/tenant-store.js";
import { requestData } from "../routes/request.js";

export type Credentials = {
  wpr_email?: string;
  wpr_key?: string;
  api_key?: string;
};

const publicPaths = new Set([
  "/health",
  "/account/signup",
]);

export async function registerAuth(app: FastifyInstance, tenantStore?: TenantStore): Promise<void> {
  app.decorateRequest("credentials", null);
  app.decorateRequest("tenant", null);

  app.addHook("preHandler", async (request, reply) => {
    const payload = requestData(request);
    const credentials = (payload as { credentials?: Credentials }).credentials;

    request.credentials = credentials ?? null;

    if (!tenantStore) {
      return;
    }

    const apiKey = readApiKey(request.headers.authorization, request.headers["x-api-key"], credentials);

    if (apiKey) {
      const tenant = await tenantStore.validateApiKey(apiKey);

      if (tenant && hostMatchesSite(readRequestUrl(payload, request.query), tenant.site)) {
        request.tenant = tenant;
        await tenantStore.recordUsage({
          accountId: tenant.account.id,
          siteId: tenant.site?.id,
          apiKeyId: tenant.apiKey.id,
          route: request.routeOptions.url ?? request.url,
          url: readRequestUrl(payload, request.query),
        });
        return;
      }
    }

    if (env.SAAS_AUTH_REQUIRED && isProtectedSaasPath(request.routeOptions.url ?? request.url)) {
      return reply.code(401).send({
        status: "failed",
        message: "Valid API key required",
      });
    }
  });
}

function readApiKey(
  authorization: string | undefined,
  headerValue: string | string[] | undefined,
  credentials: Credentials | undefined,
): string | undefined {
  if (authorization?.startsWith("Bearer ")) {
    return authorization.slice("Bearer ".length).trim();
  }

  if (typeof headerValue === "string" && headerValue.trim()) {
    return headerValue.trim();
  }

  return credentials?.api_key ?? credentials?.wpr_key;
}

function readRequestUrl(payload: unknown, query: unknown): string | undefined {
  const payloadUrl = payload && typeof payload === "object" ? (payload as { url?: unknown }).url : undefined;
  const queryUrl = query && typeof query === "object" ? (query as { url?: unknown }).url : undefined;

  return typeof payloadUrl === "string" ? payloadUrl : typeof queryUrl === "string" ? queryUrl : undefined;
}

function isProtectedSaasPath(path: string): boolean {
  if (publicPaths.has(path)) {
    return false;
  }

  return path === "/rucss-job" ||
    path === "/performance/" ||
    path === "/recommendations/" ||
    path === "/api/job/" ||
    path.startsWith("/api/job/") ||
    path.startsWith("/reports/");
}

declare module "fastify" {
  interface FastifyRequest {
    credentials: Credentials | null;
    tenant: TenantContext | null;
  }
}

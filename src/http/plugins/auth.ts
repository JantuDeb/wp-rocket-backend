import type { FastifyInstance } from "fastify";

export type Credentials = {
  wpr_email?: string;
  wpr_key?: string;
};

export async function registerAuth(app: FastifyInstance): Promise<void> {
  app.decorateRequest("credentials", null);

  app.addHook("preHandler", async (request) => {
    const payload = request.body && typeof request.body === "object" ? request.body : {};
    const credentials = (payload as { credentials?: Credentials }).credentials;

    request.credentials = credentials ?? null;
  });
}

declare module "fastify" {
  interface FastifyRequest {
    credentials: Credentials | null;
  }
}

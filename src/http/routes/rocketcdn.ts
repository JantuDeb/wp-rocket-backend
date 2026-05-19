import type { FastifyInstance } from "fastify";

export async function rocketCdnRoutes(app: FastifyInstance): Promise<void> {
  app.get("/rocketcdn/api/website/search/", async () => ({
    id: 0,
    is_active: false,
    cdn_url: "",
    subscription_next_date_update: 0,
    subscription_status: "cancelled",
  }));

  app.get("/rocketcdn/api/pricing", async () => ({
    price: 7.99,
    currency: "USD",
    interval: "month",
  }));

  app.patch("/rocketcdn/api/website/:websiteId/", async () => ({}));

  app.delete("/rocketcdn/api/website/:websiteId/purge/", async () => ({
    success: true,
  }));

  app.get("/cdn/iframe", async (_request, reply) => {
    return reply.type("text/html").send("<!doctype html><title>RocketCDN</title><p>RocketCDN is not configured.</p>");
  });
}

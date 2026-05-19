import type { FastifyInstance } from "fastify";

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get("/health", async () => ({
    ok: true,
    version: "0.1.0",
    workers: {
      rucss: true,
      cpcss: true,
      performance: true,
    },
  }));
}

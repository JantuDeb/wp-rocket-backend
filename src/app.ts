import Fastify, { type FastifyInstance } from "fastify";
import { logger } from "./config/logger.js";
import { registerAuth } from "./http/plugins/auth.js";
import { registerFormBody } from "./http/plugins/form-body.js";
import { cpcssRoutes } from "./http/routes/cpcss.js";
import { dynamicListsRoutes } from "./http/routes/dynamic-lists.js";
import { healthRoutes } from "./http/routes/health.js";
import { performanceRoutes } from "./http/routes/performance.js";
import { productApiRoutes } from "./http/routes/product-api.js";
import { recommendationsRoutes } from "./http/routes/recommendations.js";
import { rocketCdnRoutes } from "./http/routes/rocketcdn.js";
import { rucssRoutes } from "./http/routes/rucss.js";
import { MemoryJobStore } from "./storage/memory-job-store.js";

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger });
  const store = new MemoryJobStore();

  await registerFormBody(app);
  await registerAuth(app);

  await healthRoutes(app);
  await rucssRoutes(app, store);
  await cpcssRoutes(app, store);
  await performanceRoutes(app, store);
  await recommendationsRoutes(app);
  await dynamicListsRoutes(app);
  await productApiRoutes(app);
  await rocketCdnRoutes(app);

  return app;
}

import Fastify, { type FastifyInstance } from "fastify";
import { logger } from "./config/logger.js";
import { env } from "./config/env.js";
import { registerAuth } from "./http/plugins/auth.js";
import { adminRoutes } from "./http/routes/admin.js";
import { registerFormBody } from "./http/plugins/form-body.js";
import { cpcssRoutes } from "./http/routes/cpcss.js";
import { dynamicListsRoutes } from "./http/routes/dynamic-lists.js";
import { healthRoutes } from "./http/routes/health.js";
import { performanceRoutes } from "./http/routes/performance.js";
import { productApiRoutes } from "./http/routes/product-api.js";
import { recommendationsRoutes } from "./http/routes/recommendations.js";
import { rocketCdnRoutes } from "./http/routes/rocketcdn.js";
import { rucssRoutes } from "./http/routes/rucss.js";
import { BullMqJobProducer } from "./queues/producers.js";
import { MemoryJobStore } from "./storage/memory-job-store.js";
import { RedisJobStore } from "./storage/redis-job-store.js";
import { startWorkers } from "./workers/index.js";

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger });
  const store = env.QUEUE_DRIVER === "redis" ? new RedisJobStore() : new MemoryJobStore();
  const producer = env.QUEUE_DRIVER === "redis" ? new BullMqJobProducer() : undefined;
  const workers = env.QUEUE_DRIVER === "redis" && env.START_WORKERS ? startWorkers(store, app.log) : undefined;

  app.addHook("onClose", async () => {
    await workers?.close();
    await producer?.close();

    if ("close" in store && typeof store.close === "function") {
      await store.close();
    }
  });

  await registerFormBody(app);
  await registerAuth(app);

  await adminRoutes(app, store, producer);
  await healthRoutes(app);
  await rucssRoutes(app, store, producer);
  await cpcssRoutes(app, store, producer);
  await performanceRoutes(app, store, producer);
  await recommendationsRoutes(app, store);
  await dynamicListsRoutes(app);
  await productApiRoutes(app);
  await rocketCdnRoutes(app);

  return app;
}

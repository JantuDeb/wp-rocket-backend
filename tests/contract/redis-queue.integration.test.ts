import { afterEach, describe, expect, it } from "vitest";
import { Redis } from "ioredis";
import { env } from "../../src/config/env.js";
import { BullMqJobProducer } from "../../src/queues/producers.js";
import { RedisJobStore } from "../../src/storage/redis-job-store.js";
import { startWorkers, type WorkerHandle } from "../../src/workers/index.js";

const runRedisTests = process.env.RUN_REDIS_TESTS === "1";
const describeRedis = runRedisTests ? describe : describe.skip;

let redis: Redis | undefined;
let producer: BullMqJobProducer | undefined;
let workers: WorkerHandle | undefined;
let store: RedisJobStore | undefined;

afterEach(async () => {
  await workers?.close();
  await producer?.close();
  await store?.close();
  if (!store) {
    await redis?.quit();
  }
  workers = undefined;
  producer = undefined;
  store = undefined;
  redis = undefined;
});

describeRedis("Redis/BullMQ integration", () => {
  it("processes a queued performance job through Redis storage and workers", async () => {
    env.NODE_ENV = "test";
    env.REDIS_URL = process.env.REDIS_URL ?? "redis://127.0.0.1:6379";
    env.QUEUE_ATTEMPTS = 1;
    env.QUEUE_BACKOFF_MS = 0;
    env.WORKER_CONCURRENCY = 1;

    redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
    await redis.ping();
    store = new RedisJobStore(redis, `wpr:test:${Date.now()}`);
    producer = new BullMqJobProducer();
    workers = startWorkers(store);

    const job = await store.create("performance", {
      url: "https://example.com",
      email: "customer@example.com",
    }, {
      uuid: "",
      status: "completed",
      data: {
        data: {
          report_url: "",
          performance_score: 0,
          largest_contentful_paint: { value: 0 },
          total_blocking_time: { value: 0 },
          cumulative_layout_shift: { value: 0 },
          time_to_first_byte: { value: 0 },
        },
      },
    });

    await producer.enqueue("performance", {
      jobId: job.id,
      input: job.input as Record<string, unknown>,
    });

    const completed = await waitForCompletedJob(job.id);

    expect(completed?.state).toBe("completed");
    expect(completed?.result).toMatchObject({
      uuid: job.id,
      status: "completed",
      report: {
        uuid: job.id,
        observability: {
          audit_duration_ms: expect.any(Number),
        },
      },
    });
  }, 15000);
});

async function waitForCompletedJob(jobId: string): Promise<Awaited<ReturnType<RedisJobStore["get"]>>> {
  const deadline = Date.now() + 5000;

  while (Date.now() < deadline) {
    const job = await store?.get(jobId);

    if (job?.state === "completed" || job?.state === "failed") {
      return job;
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  return store?.get(jobId);
}

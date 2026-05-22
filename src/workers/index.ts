import { Worker } from "bullmq";
import type { FastifyBaseLogger } from "fastify";
import { env } from "../config/env.js";
import type { JobKind, JobStore } from "../storage/job-store.js";
import { queueConnection } from "../queues/connection.js";
import type { QueuePayload } from "../queues/producers.js";
import { runCpcssJob } from "../http/routes/cpcss.js";
import { runPerformanceJob } from "../http/routes/performance.js";
import { runRucssJob } from "../http/routes/rucss.js";

export type WorkerHandle = {
  close(): Promise<void>;
};

export function startWorkers(store: JobStore, logger?: FastifyBaseLogger): WorkerHandle {
  const kinds: JobKind[] = ["rucss", "performance_hints", "cpcss", "performance"];
  const workers = kinds.map((kind) =>
    new Worker<QueuePayload>(
      kind,
      async (job) => {
        const startedAt = Date.now();

        await processJob(kind, store, job.data);
        logger?.info({
          jobId: job.data.jobId,
          queue: kind,
          attemptsMade: job.attemptsMade,
          durationMs: Date.now() - startedAt,
        }, "Queued job completed");
      },
      {
        connection: queueConnection(),
        concurrency: env.WORKER_CONCURRENCY,
      },
    ),
  );

  for (const worker of workers) {
    worker.on("failed", (job, error) => {
      logger?.error({
        error,
        jobId: job?.data.jobId,
        queue: worker.name,
        attemptsMade: job?.attemptsMade,
        failedReason: job?.failedReason,
      }, "Queued job failed");
    });
  }

  return {
    async close(): Promise<void> {
      await Promise.all(workers.map((worker) => worker.close()));
    },
  };
}

async function processJob(kind: JobKind, store: JobStore, payload: QueuePayload): Promise<void> {
  switch (kind) {
    case "rucss":
    case "performance_hints":
      await runRucssJob(store, payload.jobId, kind, payload.input);
      return;

    case "cpcss":
      await runCpcssJob(store, payload.jobId, payload.input);
      return;

    case "performance":
      await runPerformanceJob(store, payload.jobId, payload.input);
      return;
  }
}

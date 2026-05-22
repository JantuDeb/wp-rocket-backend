import { Queue } from "bullmq";
import { env } from "../config/env.js";
import type { JobKind } from "../storage/job-store.js";
import { queueConnection } from "./connection.js";

export type QueueHealth = {
  kind: JobKind;
  waiting: number;
  active: number;
  delayed: number;
  completed: number;
  failed: number;
};

export type QueuePayload = {
  jobId: string;
  input: Record<string, unknown>;
};

export interface JobProducer {
  enqueue(kind: JobKind, payload: QueuePayload): Promise<void>;
  health(): Promise<QueueHealth[]>;
  close(): Promise<void>;
}

export class BullMqJobProducer implements JobProducer {
  private readonly queues = new Map<JobKind, Queue<QueuePayload>>();

  async enqueue(kind: JobKind, payload: QueuePayload): Promise<void> {
    const queue = this.queue(kind);

    await queue.add(kind, payload, {
      jobId: payload.jobId,
      attempts: env.QUEUE_ATTEMPTS,
      backoff: env.QUEUE_BACKOFF_MS > 0
        ? {
            type: "exponential",
            delay: env.QUEUE_BACKOFF_MS,
          }
        : undefined,
      removeOnComplete: {
        age: env.QUEUE_REMOVE_ON_COMPLETE_AGE_SECONDS,
        count: env.QUEUE_REMOVE_ON_COMPLETE_COUNT,
      },
      removeOnFail: {
        age: env.QUEUE_REMOVE_ON_FAIL_AGE_SECONDS,
      },
    });
  }

  async health(): Promise<QueueHealth[]> {
    const kinds: JobKind[] = ["rucss", "performance_hints", "cpcss", "performance"];

    return Promise.all(kinds.map(async (kind) => {
      const queue = this.queue(kind);
      const counts = await queue.getJobCounts("waiting", "active", "delayed", "completed", "failed");

      return {
        kind,
        waiting: counts.waiting ?? 0,
        active: counts.active ?? 0,
        delayed: counts.delayed ?? 0,
        completed: counts.completed ?? 0,
        failed: counts.failed ?? 0,
      };
    }));
  }

  async close(): Promise<void> {
    await Promise.all([...this.queues.values()].map((queue) => queue.close()));
  }

  private queue(kind: JobKind): Queue<QueuePayload> {
    const existing = this.queues.get(kind);

    if (existing) {
      return existing;
    }

    const queue = new Queue<QueuePayload>(kind, {
      connection: queueConnection(),
    });

    this.queues.set(kind, queue);

    return queue;
  }
}

import { Queue } from "bullmq";
import type { JobKind } from "../storage/job-store.js";
import { queueConnection } from "./connection.js";

export type QueuePayload = {
  jobId: string;
  input: Record<string, unknown>;
};

export interface JobProducer {
  enqueue(kind: JobKind, payload: QueuePayload): Promise<void>;
  close(): Promise<void>;
}

export class BullMqJobProducer implements JobProducer {
  private readonly queues = new Map<JobKind, Queue<QueuePayload>>();

  async enqueue(kind: JobKind, payload: QueuePayload): Promise<void> {
    const queue = this.queue(kind);

    await queue.add(kind, payload, {
      jobId: payload.jobId,
      attempts: 2,
      removeOnComplete: {
        age: 3600,
        count: 1000,
      },
      removeOnFail: {
        age: 86400,
      },
    });
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

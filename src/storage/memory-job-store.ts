import { env } from "../config/env.js";
import { createJobId, type JobKind, type JobStore, type StoredJob } from "./job-store.js";

export class MemoryJobStore implements JobStore {
  private readonly jobs = new Map<string, StoredJob>();

  create<T>(kind: JobKind, input: unknown, result: T): StoredJob<T> {
    const job: StoredJob<T> = {
      id: createJobId(kind),
      kind,
      state: "pending",
      input,
      result,
      createdAt: Date.now(),
      completeAfterMs: env.JOB_COMPLETE_AFTER_MS,
    };

    this.jobs.set(job.id, job);

    return job;
  }

  get<T = unknown>(id: string): StoredJob<T> | undefined {
    const job = this.jobs.get(id) as StoredJob<T> | undefined;

    if (!job) {
      return undefined;
    }

    if (job.state === "pending" && Date.now() - job.createdAt >= job.completeAfterMs) {
      job.state = "completed";
    }

    return job;
  }

  complete<T>(id: string, result: T): StoredJob<T> | undefined {
    const job = this.jobs.get(id) as StoredJob<T> | undefined;

    if (!job) {
      return undefined;
    }

    job.state = "completed";
    job.result = result;
    job.error = undefined;

    return job;
  }

  fail<T>(id: string, result: T, error?: string): StoredJob<T> | undefined {
    const job = this.jobs.get(id) as StoredJob<T> | undefined;

    if (!job) {
      return undefined;
    }

    job.state = "failed";
    job.result = result;
    job.error = error;

    return job;
  }
}

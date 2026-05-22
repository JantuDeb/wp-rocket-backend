import { env } from "../config/env.js";
import { createJobId, type JobKind, type JobStore, type StoredJob } from "./job-store.js";

export class MemoryJobStore implements JobStore {
  private readonly jobs = new Map<string, StoredJob>();

  create<T>(kind: JobKind, input: unknown, result: T): StoredJob<T> {
    const now = Date.now();
    const job: StoredJob<T> = {
      id: createJobId(kind),
      kind,
      state: "pending",
      input,
      result,
      createdAt: now,
      updatedAt: now,
      attempts: 1,
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

  list(options: { kind?: JobKind; limit?: number; offset?: number } = {}): StoredJob[] {
    const limit = options.limit ?? 100;
    const offset = options.offset ?? 0;

    return [...this.jobs.values()]
      .map((job) => this.get(job.id))
      .filter((job): job is StoredJob => Boolean(job))
      .filter((job) => !options.kind || job.kind === options.kind)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(offset, offset + limit);
  }

  deleteBefore(options: { kind?: JobKind; before: number; dryRun?: boolean }): { deleted: number; matched: number } {
    const matched = [...this.jobs.values()]
      .filter((job) => !options.kind || job.kind === options.kind)
      .filter((job) => job.createdAt < options.before);

    if (!options.dryRun) {
      for (const job of matched) {
        this.jobs.delete(job.id);
      }
    }

    return {
      deleted: options.dryRun ? 0 : matched.length,
      matched: matched.length,
    };
  }

  markPending<T = unknown>(id: string): StoredJob<T> | undefined {
    const job = this.jobs.get(id) as StoredJob<T> | undefined;

    if (!job) {
      return undefined;
    }

    job.state = "pending";
    job.error = undefined;
    job.updatedAt = Date.now();
    job.attempts += 1;

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
    job.updatedAt = Date.now();

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
    job.updatedAt = Date.now();

    return job;
  }
}

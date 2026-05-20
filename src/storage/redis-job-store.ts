import { Redis } from "ioredis";
import { env } from "../config/env.js";
import { createJobId, type JobKind, type JobStore, type StoredJob } from "./job-store.js";

export class RedisJobStore implements JobStore {
  private readonly redis: Redis;
  private readonly keyPrefix: string;

  constructor(redis = new Redis(env.REDIS_URL), keyPrefix = "wpr:jobs") {
    this.redis = redis;
    this.keyPrefix = keyPrefix;
  }

  async create<T>(kind: JobKind, input: unknown, result: T): Promise<StoredJob<T>> {
    const job: StoredJob<T> = {
      id: createJobId(kind),
      kind,
      state: "pending",
      input,
      result,
      createdAt: Date.now(),
      completeAfterMs: Number.MAX_SAFE_INTEGER,
    };

    await this.save(job);

    return job;
  }

  async get<T = unknown>(id: string): Promise<StoredJob<T> | undefined> {
    const payload = await this.redis.get(this.key(id));

    if (!payload) {
      return undefined;
    }

    return JSON.parse(payload) as StoredJob<T>;
  }

  async complete<T>(id: string, result: T): Promise<StoredJob<T> | undefined> {
    const job = await this.get<T>(id);

    if (!job) {
      return undefined;
    }

    job.state = "completed";
    job.result = result;
    job.error = undefined;
    await this.save(job);

    return job;
  }

  async fail<T>(id: string, result: T, error?: string): Promise<StoredJob<T> | undefined> {
    const job = await this.get<T>(id);

    if (!job) {
      return undefined;
    }

    job.state = "failed";
    job.result = result;
    job.error = error;
    await this.save(job);

    return job;
  }

  async close(): Promise<void> {
    await this.redis.quit();
  }

  private async save<T>(job: StoredJob<T>): Promise<void> {
    await this.redis.set(this.key(job.id), JSON.stringify(job), "EX", env.REDIS_JOB_TTL_SECONDS);
  }

  private key(id: string): string {
    return `${this.keyPrefix}:${id}`;
  }
}

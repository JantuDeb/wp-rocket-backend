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

  async list(options: { kind?: JobKind; limit?: number; offset?: number } = {}): Promise<StoredJob[]> {
    const limit = options.limit ?? 100;
    const offset = options.offset ?? 0;
    const ids = await this.redis.zrevrange(this.indexKey(options.kind), offset, offset + Math.max(0, limit - 1));
    const jobs = await Promise.all(ids.map((id) => this.get(id)));
    const missingIds = ids.filter((_, index) => !jobs[index]);

    if (missingIds.length > 0) {
      await this.redis.zrem(this.indexKey(options.kind), ...missingIds);

      if (options.kind) {
        await this.redis.zrem(this.indexKey(), ...missingIds);
      }
    }

    return jobs.filter((job): job is StoredJob => Boolean(job));
  }

  async markPending<T = unknown>(id: string): Promise<StoredJob<T> | undefined> {
    const job = await this.get<T>(id);

    if (!job) {
      return undefined;
    }

    job.state = "pending";
    job.error = undefined;
    job.updatedAt = Date.now();
    job.attempts += 1;
    await this.save(job);

    return job;
  }

  async complete<T>(id: string, result: T): Promise<StoredJob<T> | undefined> {
    const job = await this.get<T>(id);

    if (!job) {
      return undefined;
    }

    job.state = "completed";
    job.result = result;
    job.error = undefined;
    job.updatedAt = Date.now();
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
    job.updatedAt = Date.now();
    await this.save(job);

    return job;
  }

  async close(): Promise<void> {
    await this.redis.quit();
  }

  private async save<T>(job: StoredJob<T>): Promise<void> {
    await this.redis
      .multi()
      .set(this.key(job.id), JSON.stringify(job), "EX", env.REDIS_JOB_TTL_SECONDS)
      .zadd(this.indexKey(), job.createdAt, job.id)
      .zadd(this.indexKey(job.kind), job.createdAt, job.id)
      .expire(this.indexKey(), env.REDIS_JOB_TTL_SECONDS)
      .expire(this.indexKey(job.kind), env.REDIS_JOB_TTL_SECONDS)
      .exec();
  }

  private key(id: string): string {
    return `${this.keyPrefix}:${id}`;
  }

  private indexKey(kind?: JobKind): string {
    return kind ? `${this.keyPrefix}:index:${kind}` : `${this.keyPrefix}:index`;
  }
}

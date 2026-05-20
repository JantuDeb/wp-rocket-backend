import type { RedisOptions } from "ioredis";
import { env } from "../config/env.js";

export function queueConnection(): RedisOptions {
  return {
    maxRetriesPerRequest: null,
    lazyConnect: false,
    ...parseRedisUrl(env.REDIS_URL),
  };
}

function parseRedisUrl(value: string): RedisOptions {
  const url = new URL(value);

  return {
    host: url.hostname,
    port: url.port ? Number(url.port) : 6379,
    username: decodeURIComponent(url.username || ""),
    password: decodeURIComponent(url.password || ""),
    db: url.pathname.length > 1 ? Number(url.pathname.slice(1)) : 0,
    tls: url.protocol === "rediss:" ? {} : undefined,
  };
}

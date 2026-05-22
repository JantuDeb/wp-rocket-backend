import { randomUUID } from "node:crypto";

export type JobKind = "rucss" | "performance_hints" | "cpcss" | "performance";
export type JobState = "pending" | "completed" | "failed";

export type StoredJob<T = unknown> = {
  id: string;
  kind: JobKind;
  state: JobState;
  input: unknown;
  result: T;
  error?: string;
  createdAt: number;
  updatedAt: number;
  attempts: number;
  completeAfterMs: number;
};

export type MaybePromise<T> = T | Promise<T>;

export interface JobStore {
  create<T>(kind: JobKind, input: unknown, result: T): MaybePromise<StoredJob<T>>;
  get<T = unknown>(id: string): MaybePromise<StoredJob<T> | undefined>;
  list(options?: { kind?: JobKind; limit?: number; offset?: number }): MaybePromise<StoredJob[]>;
  deleteBefore(options: { kind?: JobKind; before: number; dryRun?: boolean }): MaybePromise<{ deleted: number; matched: number }>;
  markPending<T = unknown>(id: string): MaybePromise<StoredJob<T> | undefined>;
  complete<T>(id: string, result: T): MaybePromise<StoredJob<T> | undefined>;
  fail<T>(id: string, result: T, error?: string): MaybePromise<StoredJob<T> | undefined>;
}

export function createJobId(kind: JobKind): string {
  return `${kind}_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
}

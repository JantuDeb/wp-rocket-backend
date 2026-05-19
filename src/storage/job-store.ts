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
  completeAfterMs: number;
};

export interface JobStore {
  create<T>(kind: JobKind, input: unknown, result: T): StoredJob<T>;
  get<T = unknown>(id: string): StoredJob<T> | undefined;
  complete<T>(id: string, result: T): StoredJob<T> | undefined;
  fail<T>(id: string, result: T, error?: string): StoredJob<T> | undefined;
}

export function createJobId(kind: JobKind): string {
  return `${kind}_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
}

import type { JobKind, JobState } from "../storage/job-store.js";

export type AdminJobSummary = {
  id: string;
  kind: JobKind;
  state: JobState;
  created_at: string;
  updated_at: string;
  age_ms: number;
  duration_ms?: number;
  attempts: number;
  url?: string;
  has_report: boolean;
  error?: string;
};

export type AdminJobDetail = AdminJobSummary & {
  input: unknown;
  result: unknown;
};

export type AdminQueueHealth = {
  kind: JobKind;
  waiting: number;
  active: number;
  delayed: number;
  completed: number;
  failed: number;
};

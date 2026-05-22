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

export type AdminMetrics = {
  generated_at: string;
  jobs: {
    total: number;
    by_state: Record<JobState, number>;
    by_kind: Record<JobKind, number>;
  };
  reports: {
    total: number;
    average_score: number | null;
    average_lcp_ms: number | null;
    average_tbt_ms: number | null;
    average_cls: number | null;
    average_ttfb_ms: number | null;
    issues_total: number;
  };
  observability: {
    average_audit_duration_ms: number | null;
    browser_errors: number;
  };
  queues: AdminQueueHealth[];
};

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { env } from "../../config/env.js";
import type { AdminJobDetail, AdminJobSummary, AdminMetrics, AdminQueueHealth } from "../../contracts/admin.js";
import type { CpcssStatusResponse } from "../../contracts/cpcss.js";
import type { PerformanceJobResult } from "../../contracts/performance.js";
import type { RucssReturnValue } from "../../contracts/rucss.js";
import type { JobProducer } from "../../queues/producers.js";
import type { JobKind, JobState, JobStore, StoredJob } from "../../storage/job-store.js";
import { runCpcssJob } from "./cpcss.js";
import { runPerformanceJob } from "./performance.js";
import { requestData } from "./request.js";
import { runRucssJob } from "./rucss.js";

const jobKinds = new Set<JobKind>(["rucss", "performance_hints", "cpcss", "performance"]);
const jobStates = new Set<JobState>(["pending", "completed", "failed"]);

export async function adminRoutes(
  app: FastifyInstance,
  store: JobStore,
  producer?: JobProducer,
): Promise<void> {
  const adminAuth = { preHandler: requireAdminAuth };

  app.get("/admin/jobs", adminAuth, async (request) => {
    const body = requestData(request);
    const limit = readLimit(body.limit);
    const offset = readOffset(body.offset);
    const filtered = await filteredJobs(store, {
      kind: readJobKind(body.kind),
      state: readJobState(body.state),
      query: readSearch(body.q),
    });
    const jobs = filtered.slice(offset, offset + limit);

    return {
      jobs: jobs.map(jobSummary),
      metadata: {
        total: filtered.length,
        limit,
        offset,
      },
    };
  });

  app.get("/admin/jobs/:jobId", adminAuth, async (request, reply) => {
    const params = request.params as { jobId: string };
    const job = await store.get(params.jobId);

    if (!job) {
      return reply.code(404).send({
        status: "failed",
        message: "Job not found",
      });
    }

    return reply.code(200).send(jobDetail(job));
  });

  app.post("/admin/jobs/:jobId/retry", adminAuth, async (request, reply) => {
    const params = request.params as { jobId: string };
    const job = await store.get(params.jobId);

    if (!job) {
      return reply.code(404).send({
        status: "failed",
        message: "Job not found",
      });
    }

    const pending = await store.markPending(job.id);

    if (!pending) {
      return reply.code(404).send({
        status: "failed",
        message: "Job not found",
      });
    }

    if (producer) {
      await producer.enqueue(pending.kind, {
        jobId: pending.id,
        input: pending.input as Record<string, unknown>,
      });
    } else {
      const run = retryLocalJob(store, pending).catch((error: unknown) => {
        app.log.error({ error, jobId: pending.id }, "Retried job failed unexpectedly");
      });

      if (env.NODE_ENV === "test") {
        await run;
      }
    }

    return reply.code(202).send(jobSummary(pending));
  });

  app.post("/admin/jobs/:jobId/cancel", adminAuth, async (request, reply) => {
    const params = request.params as { jobId: string };
    const job = await store.get(params.jobId);

    if (!job) {
      return reply.code(404).send({
        status: "failed",
        message: "Job not found",
      });
    }

    if (job.state !== "pending") {
      return reply.code(409).send({
        status: "failed",
        message: "Only pending jobs can be canceled",
      });
    }

    const canceled = await store.fail(job.id, canceledResult(job), "Canceled by admin");

    return reply.code(200).send(canceled ? jobSummary(canceled) : jobSummary(job));
  });

  app.get("/admin/reports", adminAuth, async (request) => {
    const body = requestData(request);
    const limit = readLimit(body.limit);
    const offset = readOffset(body.offset);
    const filtered = await filteredJobs(store, {
      kind: "performance",
      state: readJobState(body.state),
      query: readSearch(body.q),
    });
    const reports = filtered
      .filter((job) => Boolean((job.result as PerformanceJobResult).report))
      .slice(offset, offset + limit)
      .map((job) => {
        const result = job.result as PerformanceJobResult;

        return {
          ...jobSummary(job),
          report_url: result.data.data.report_url,
          metrics: result.report?.metrics,
          issue_count: result.report?.issues.length ?? 0,
        };
      });

    return {
      reports,
      metadata: {
        total: filtered.length,
        limit,
        offset,
      },
    };
  });

  app.get("/admin/reports/history", adminAuth, async (request, reply) => {
    const body = requestData(request);
    const url = typeof body.url === "string" ? body.url : "";

    if (!url) {
      return reply.code(400).send({
        status: "failed",
        message: "Missing required query parameter: url",
      });
    }

    const reports = (await filteredJobs(store, {
      kind: "performance",
      query: url,
    }))
      .filter((job) => Boolean((job.result as PerformanceJobResult).report))
      .filter((job) => normalizeComparableUrl(((job.result as PerformanceJobResult).report?.url ?? jobSummary(job).url ?? "")) === normalizeComparableUrl(url))
      .map((job) => {
        const result = job.result as PerformanceJobResult;

        return {
          id: job.id,
          generated_at: result.report?.generated_at,
          metrics: result.report?.metrics,
          issue_count: result.report?.issues.length ?? 0,
        };
      })
      .sort((a, b) => String(b.generated_at).localeCompare(String(a.generated_at)));

    return reply.code(200).send({
      url,
      reports,
      comparison: compareReports(reports),
      metadata: {
        total: reports.length,
      },
    });
  });

  app.get("/admin/queues", adminAuth, async () => {
    const queues = producer
      ? await producer.health()
      : memoryQueueHealth(await store.list({ limit: 1000 }));

    return {
      queues,
      metadata: {
        driver: env.QUEUE_DRIVER,
      },
    };
  });

  app.get("/admin/metrics", adminAuth, async () => {
    const queues = producer
      ? await producer.health()
      : memoryQueueHealth(await store.list({ limit: 1000 }));

    return buildAdminMetrics(await store.list({ limit: 1000 }), queues);
  });

  app.get("/metrics", adminAuth, async (_request, reply) => {
    const queues = producer
      ? await producer.health()
      : memoryQueueHealth(await store.list({ limit: 1000 }));
    const metrics = buildAdminMetrics(await store.list({ limit: 1000 }), queues);

    return reply.type("text/plain; version=0.0.4; charset=utf-8").send(prometheusMetrics(metrics));
  });

  app.post("/admin/reports/cleanup", adminAuth, async (request, reply) => {
    const body = requestData(request);
    const retentionDays = readPositiveNumber(body.older_than_days) ?? env.REPORT_RETENTION_DAYS;
    const dryRun = readBoolean(body.dry_run);
    const before = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
    const result = await store.deleteBefore({
      kind: "performance",
      before,
      dryRun,
    });

    return reply.code(200).send({
      status: dryRun ? "preview" : "completed",
      older_than_days: retentionDays,
      before: new Date(before).toISOString(),
      matched: result.matched,
      deleted: result.deleted,
      dry_run: dryRun,
    });
  });

  app.get("/dashboard", adminAuth, async (_request, reply) =>
    reply.type("text/html; charset=utf-8").send(dashboardHtml(Boolean(env.ADMIN_TOKEN))),
  );
}

async function requireAdminAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!env.ADMIN_TOKEN) {
    return;
  }

  const header = request.headers.authorization;
  const bearer = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : undefined;
  const tokenHeader = request.headers["x-admin-token"];
  const tokenQuery = (request.query as { token?: unknown } | undefined)?.token;
  const token = bearer ?? (typeof tokenHeader === "string" ? tokenHeader : undefined) ?? (typeof tokenQuery === "string" ? tokenQuery : undefined);

  if (token === env.ADMIN_TOKEN) {
    return;
  }

  reply.code(401).send({
    status: "failed",
    message: "Admin token required",
  });
}

async function filteredJobs(
  store: JobStore,
  options: { kind?: JobKind; state?: JobState; query?: string },
): Promise<StoredJob[]> {
  const jobs = await store.list({
    kind: options.kind,
    limit: 1000,
  });
  const query = options.query?.toLowerCase();

  return jobs
    .filter((job) => !options.state || job.state === options.state)
    .filter((job) => {
      if (!query) {
        return true;
      }

      const summary = jobSummary(job);

      return [
        summary.id,
        summary.kind,
        summary.state,
        summary.url ?? "",
        summary.error ?? "",
      ].some((value) => value.toLowerCase().includes(query));
    });
}

function jobSummary(job: StoredJob): AdminJobSummary {
  const input = job.input as { url?: unknown } | undefined;
  const updatedAt = job.updatedAt ?? job.createdAt;

  return {
    id: job.id,
    kind: job.kind,
    state: job.state,
    created_at: new Date(job.createdAt).toISOString(),
    updated_at: new Date(updatedAt).toISOString(),
    age_ms: Math.max(0, Date.now() - job.createdAt),
    duration_ms: job.state === "pending" ? undefined : Math.max(0, updatedAt - job.createdAt),
    attempts: job.attempts ?? 1,
    url: typeof input?.url === "string" ? input.url : undefined,
    has_report: Boolean((job.result as PerformanceJobResult | undefined)?.report),
    error: job.error,
  };
}

function jobDetail(job: StoredJob): AdminJobDetail {
  return {
    ...jobSummary(job),
    input: job.input,
    result: job.result,
  };
}

async function retryLocalJob(store: JobStore, job: StoredJob): Promise<void> {
  const input = job.input as Record<string, unknown>;

  switch (job.kind) {
    case "rucss":
    case "performance_hints":
      await runRucssJob(store, job.id, job.kind, input);
      return;

    case "cpcss":
      await runCpcssJob(store, job.id, input);
      return;

    case "performance":
      await runPerformanceJob(store, job.id, input);
      return;
  }
}

function canceledResult(job: StoredJob): unknown {
  switch (job.kind) {
    case "rucss":
    case "performance_hints":
      return {
        code: 500,
        status: "failed",
        message: "Canceled by admin",
        contents: {
          success: false,
          shakedCSS: "",
          shakedCSS_size: 0,
          above_the_fold_result: {
            lcp: [],
            images_above_fold: [],
          },
        },
      } satisfies RucssReturnValue;

    case "cpcss":
      return {
        status: 400,
        message: "Canceled by admin",
        data: {
          state: "failed",
        },
      } satisfies CpcssStatusResponse;

    case "performance":
      return {
        uuid: job.id,
        status: "failed",
        message: "Canceled by admin",
        data: {
          data: {
            report_url: "",
            performance_score: 0,
            largest_contentful_paint: { value: 0 },
            total_blocking_time: { value: 0 },
            cumulative_layout_shift: { value: 0 },
            time_to_first_byte: { value: 0 },
          },
        },
      } satisfies PerformanceJobResult;
  }
}

function memoryQueueHealth(jobs: StoredJob[]): AdminQueueHealth[] {
  return [...jobKinds].map((kind) => {
    const queueJobs = jobs.filter((job) => job.kind === kind);

    return {
      kind,
      waiting: queueJobs.filter((job) => job.state === "pending").length,
      active: 0,
      delayed: 0,
      completed: queueJobs.filter((job) => job.state === "completed").length,
      failed: queueJobs.filter((job) => job.state === "failed").length,
    };
  });
}

function compareReports(reports: Array<{
  metrics?: PerformanceJobResult["data"]["data"];
}>): Record<string, number> | null {
  const latest = reports[0]?.metrics;
  const previous = reports[1]?.metrics;

  if (!latest || !previous) {
    return null;
  }

  return {
    performance_score: latest.performance_score - previous.performance_score,
    largest_contentful_paint: latest.largest_contentful_paint.value - previous.largest_contentful_paint.value,
    total_blocking_time: latest.total_blocking_time.value - previous.total_blocking_time.value,
    cumulative_layout_shift: latest.cumulative_layout_shift.value - previous.cumulative_layout_shift.value,
    time_to_first_byte: latest.time_to_first_byte.value - previous.time_to_first_byte.value,
  };
}

function buildAdminMetrics(jobs: StoredJob[], queues: AdminQueueHealth[]): AdminMetrics {
  const reports = jobs
    .filter((job) => job.kind === "performance")
    .map((job) => (job.result as PerformanceJobResult | undefined)?.report)
    .filter((report): report is NonNullable<PerformanceJobResult["report"]> => Boolean(report));
  const auditDurations = reports
    .map((report) => report.observability?.audit_duration_ms)
    .filter((value): value is number => typeof value === "number");

  return {
    generated_at: new Date().toISOString(),
    jobs: {
      total: jobs.length,
      by_state: {
        pending: jobs.filter((job) => job.state === "pending").length,
        completed: jobs.filter((job) => job.state === "completed").length,
        failed: jobs.filter((job) => job.state === "failed").length,
      },
      by_kind: {
        rucss: jobs.filter((job) => job.kind === "rucss").length,
        performance_hints: jobs.filter((job) => job.kind === "performance_hints").length,
        cpcss: jobs.filter((job) => job.kind === "cpcss").length,
        performance: jobs.filter((job) => job.kind === "performance").length,
      },
    },
    reports: {
      total: reports.length,
      average_score: average(reports.map((report) => report.metrics.performance_score)),
      average_lcp_ms: average(reports.map((report) => report.metrics.largest_contentful_paint.value)),
      average_tbt_ms: average(reports.map((report) => report.metrics.total_blocking_time.value)),
      average_cls: average(reports.map((report) => report.metrics.cumulative_layout_shift.value)),
      average_ttfb_ms: average(reports.map((report) => report.metrics.time_to_first_byte.value)),
      issues_total: reports.reduce((total, report) => total + report.issues.length, 0),
    },
    observability: {
      average_audit_duration_ms: average(auditDurations),
      browser_errors: reports.filter((report) => report.observability?.browser_error).length,
    },
    queues,
  };
}

function prometheusMetrics(metrics: AdminMetrics): string {
  const lines = [
    "# HELP wp_rocket_backend_jobs_total Stored jobs by state and kind.",
    "# TYPE wp_rocket_backend_jobs_total gauge",
    ...Object.entries(metrics.jobs.by_state).map(([state, count]) => `wp_rocket_backend_jobs_total{state="${state}"} ${count}`),
    ...Object.entries(metrics.jobs.by_kind).map(([kind, count]) => `wp_rocket_backend_jobs_total{kind="${kind}"} ${count}`),
    "# HELP wp_rocket_backend_reports_total Stored performance reports.",
    "# TYPE wp_rocket_backend_reports_total gauge",
    `wp_rocket_backend_reports_total ${metrics.reports.total}`,
    "# HELP wp_rocket_backend_report_average_score Average performance score.",
    "# TYPE wp_rocket_backend_report_average_score gauge",
    `wp_rocket_backend_report_average_score ${metrics.reports.average_score ?? 0}`,
    "# HELP wp_rocket_backend_report_average_lcp_ms Average LCP in milliseconds.",
    "# TYPE wp_rocket_backend_report_average_lcp_ms gauge",
    `wp_rocket_backend_report_average_lcp_ms ${metrics.reports.average_lcp_ms ?? 0}`,
    "# HELP wp_rocket_backend_report_average_tbt_ms Average TBT in milliseconds.",
    "# TYPE wp_rocket_backend_report_average_tbt_ms gauge",
    `wp_rocket_backend_report_average_tbt_ms ${metrics.reports.average_tbt_ms ?? 0}`,
    "# HELP wp_rocket_backend_report_average_cls Average CLS.",
    "# TYPE wp_rocket_backend_report_average_cls gauge",
    `wp_rocket_backend_report_average_cls ${metrics.reports.average_cls ?? 0}`,
    "# HELP wp_rocket_backend_browser_errors_total Reports with browser audit errors.",
    "# TYPE wp_rocket_backend_browser_errors_total gauge",
    `wp_rocket_backend_browser_errors_total ${metrics.observability.browser_errors}`,
    "# HELP wp_rocket_backend_queue_jobs Queue jobs by state.",
    "# TYPE wp_rocket_backend_queue_jobs gauge",
    ...metrics.queues.flatMap((queue) => [
      `wp_rocket_backend_queue_jobs{queue="${queue.kind}",state="waiting"} ${queue.waiting}`,
      `wp_rocket_backend_queue_jobs{queue="${queue.kind}",state="active"} ${queue.active}`,
      `wp_rocket_backend_queue_jobs{queue="${queue.kind}",state="delayed"} ${queue.delayed}`,
      `wp_rocket_backend_queue_jobs{queue="${queue.kind}",state="completed"} ${queue.completed}`,
      `wp_rocket_backend_queue_jobs{queue="${queue.kind}",state="failed"} ${queue.failed}`,
    ]),
  ];

  return `${lines.join("\n")}\n`;
}

function average(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }

  return Number((values.reduce((total, value) => total + value, 0) / values.length).toFixed(3));
}

function normalizeComparableUrl(value: string): string {
  try {
    const url = new URL(value);
    url.hash = "";
    url.search = "";

    return url.toString();
  } catch {
    return value;
  }
}

function readJobKind(value: unknown): JobKind | undefined {
  return typeof value === "string" && jobKinds.has(value as JobKind) ? value as JobKind : undefined;
}

function readJobState(value: unknown): JobState | undefined {
  return typeof value === "string" && jobStates.has(value as JobState) ? value as JobState : undefined;
}

function readSearch(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function readLimit(value: unknown): number {
  const parsed = typeof value === "string" || typeof value === "number" ? Number(value) : 50;

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 50;
  }

  return Math.min(100, Math.trunc(parsed));
}

function readOffset(value: unknown): number {
  const parsed = typeof value === "string" || typeof value === "number" ? Number(value) : 0;

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 0;
  }

  return Math.trunc(parsed);
}

function readPositiveNumber(value: unknown): number | undefined {
  const parsed = typeof value === "string" || typeof value === "number" ? Number(value) : undefined;

  return parsed && Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : undefined;
}

function readBoolean(value: unknown): boolean {
  return value === true || value === "true" || value === "1" || value === 1;
}

function dashboardHtml(requiresToken: boolean): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>WP Rocket Backend Dashboard</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f7f8fa;
      --panel: #ffffff;
      --text: #18202a;
      --muted: #697586;
      --border: #d9dee7;
      --accent: #1f7a5a;
      --failed: #b42318;
      --pending: #9a6700;
      --completed: #027a48;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: var(--bg);
      color: var(--text);
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      font-size: 14px;
    }
    header {
      border-bottom: 1px solid var(--border);
      background: var(--panel);
    }
    .wrap {
      width: min(1180px, calc(100% - 32px));
      margin: 0 auto;
    }
    .topbar, .toolbar, .tabs {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      flex-wrap: wrap;
    }
    .topbar { min-height: 72px; }
    h1 {
      margin: 0;
      font-size: 22px;
      line-height: 1.2;
    }
    main { padding: 24px 0 40px; }
    .muted { color: var(--muted); }
    .toolbar { margin-bottom: 16px; }
    .filters { display: flex; gap: 8px; flex-wrap: wrap; }
    button, select, input {
      height: 36px;
      border: 1px solid var(--border);
      border-radius: 6px;
      background: var(--panel);
      color: var(--text);
      padding: 0 12px;
      font: inherit;
    }
    button { cursor: pointer; }
    button.primary {
      border-color: var(--accent);
      background: var(--accent);
      color: #ffffff;
    }
    button.danger {
      border-color: var(--failed);
      color: var(--failed);
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 12px;
      margin-bottom: 16px;
    }
    .metric, .panel {
      border: 1px solid var(--border);
      border-radius: 8px;
      background: var(--panel);
    }
    .metric { padding: 16px; }
    .metric strong {
      display: block;
      font-size: 28px;
      line-height: 1;
      margin-bottom: 6px;
    }
    .panel { overflow: hidden; margin-bottom: 16px; }
    table { width: 100%; border-collapse: collapse; }
    th, td {
      padding: 12px;
      border-bottom: 1px solid var(--border);
      text-align: left;
      vertical-align: top;
    }
    th {
      color: var(--muted);
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0;
      background: #fbfcfd;
    }
    tr:last-child td { border-bottom: 0; }
    .state {
      display: inline-flex;
      align-items: center;
      min-height: 24px;
      border-radius: 999px;
      padding: 0 9px;
      font-size: 12px;
      font-weight: 700;
      background: #eef2f6;
    }
    .state.completed { color: var(--completed); background: #ecfdf3; }
    .state.pending { color: var(--pending); background: #fffaeb; }
    .state.failed { color: var(--failed); background: #fef3f2; }
    .url {
      max-width: 420px;
      word-break: break-word;
    }
    .detail {
      display: none;
      padding: 16px;
      border-top: 1px solid var(--border);
      background: #fbfcfd;
    }
    .detail.open { display: block; }
    .tabs {
      justify-content: flex-start;
      margin-bottom: 12px;
    }
    .tabs button.active {
      border-color: var(--accent);
      color: var(--accent);
      font-weight: 700;
    }
    .history-toolbar {
      display: flex;
      gap: 8px;
      padding: 12px;
      border-bottom: 1px solid var(--border);
      flex-wrap: wrap;
    }
    .history-toolbar input {
      flex: 1 1 320px;
      min-width: 0;
    }
    .history {
      padding: 12px;
    }
    .history-summary {
      display: flex;
      gap: 8px;
      margin-bottom: 12px;
      flex-wrap: wrap;
    }
    .delta {
      display: inline-flex;
      align-items: center;
      min-height: 28px;
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 0 8px;
      color: var(--muted);
      background: #ffffff;
      font-size: 12px;
    }
    .delta.good { color: var(--completed); border-color: #abefc6; }
    .delta.bad { color: var(--failed); border-color: #fecdca; }
    .chart {
      display: grid;
      gap: 10px;
    }
    .chart-row {
      display: grid;
      grid-template-columns: 120px 1fr 96px;
      gap: 10px;
      align-items: center;
    }
    .track {
      height: 10px;
      border-radius: 999px;
      background: #eef2f6;
      overflow: hidden;
    }
    .bar {
      height: 100%;
      width: 0%;
      background: var(--accent);
    }
    pre {
      max-height: 420px;
      overflow: auto;
      margin: 0;
      padding: 12px;
      border: 1px solid var(--border);
      border-radius: 6px;
      background: #ffffff;
      white-space: pre-wrap;
      word-break: break-word;
      font-size: 12px;
    }
    @media (max-width: 760px) {
      .topbar, .toolbar { align-items: flex-start; flex-direction: column; }
      .grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      th:nth-child(3), td:nth-child(3), th:nth-child(4), td:nth-child(4) { display: none; }
    }
  </style>
</head>
<body>
  <header>
    <div class="wrap topbar">
      <div>
        <h1>WP Rocket Backend Dashboard</h1>
        <div class="muted">Jobs, queues, reports, and recommendations</div>
      </div>
      <div class="filters">
        ${requiresToken ? '<input id="token" type="password" placeholder="Admin token">' : ""}
        <button class="primary" id="refresh">Refresh</button>
      </div>
    </div>
  </header>
  <main class="wrap">
    <div class="toolbar">
      <div class="filters">
        <input id="search" placeholder="Search URL or job ID">
        <select id="kind">
          <option value="">All jobs</option>
          <option value="rucss">RUCSS</option>
          <option value="performance_hints">Performance hints</option>
          <option value="cpcss">Critical CSS</option>
          <option value="performance">Performance reports</option>
        </select>
        <select id="state">
          <option value="">All states</option>
          <option value="pending">Pending</option>
          <option value="completed">Completed</option>
          <option value="failed">Failed</option>
        </select>
        <select id="limit">
          <option value="25">25 latest</option>
          <option value="50" selected>50 latest</option>
          <option value="100">100 latest</option>
        </select>
      </div>
      <div class="muted" id="updated">Not loaded</div>
    </div>
    <section class="grid" aria-label="Job counts">
      <div class="metric"><strong id="count-total">0</strong><span class="muted">Total</span></div>
      <div class="metric"><strong id="count-pending">0</strong><span class="muted">Pending</span></div>
      <div class="metric"><strong id="count-completed">0</strong><span class="muted">Completed</span></div>
      <div class="metric"><strong id="count-failed">0</strong><span class="muted">Failed</span></div>
    </section>
    <section class="panel">
      <table>
        <thead><tr><th>State</th><th>Kind</th><th>Updated</th><th>URL</th><th>Job</th></tr></thead>
        <tbody id="jobs"><tr><td colspan="5" class="muted">Loading jobs...</td></tr></tbody>
      </table>
      <div class="detail" id="detail"></div>
    </section>
    <section class="panel">
      <table>
        <thead><tr><th>Queue</th><th>Waiting</th><th>Active</th><th>Delayed</th><th>Completed</th><th>Failed</th></tr></thead>
        <tbody id="queues"><tr><td colspan="6" class="muted">Loading queue health...</td></tr></tbody>
      </table>
    </section>
    <section class="panel" aria-label="Report history">
      <div class="history-toolbar">
        <input id="history-url" placeholder="Report history URL">
        <button id="history-load">Load History</button>
      </div>
      <div class="history" id="history">
        <div class="muted">Select a performance report or enter a URL to compare recent metrics.</div>
      </div>
    </section>
  </main>
  <script>
    const jobsBody = document.querySelector("#jobs");
    const queuesBody = document.querySelector("#queues");
    const detail = document.querySelector("#detail");
    const history = document.querySelector("#history");
    const historyUrl = document.querySelector("#history-url");
    const historyLoad = document.querySelector("#history-load");
    const kind = document.querySelector("#kind");
    const state = document.querySelector("#state");
    const limit = document.querySelector("#limit");
    const search = document.querySelector("#search");
    const updated = document.querySelector("#updated");
    const tokenInput = document.querySelector("#token");
    let selectedJob = null;
    let detailData = {};

    if (tokenInput) {
      tokenInput.value = localStorage.getItem("wpr_admin_token") || "";
      tokenInput.addEventListener("change", () => {
        localStorage.setItem("wpr_admin_token", tokenInput.value);
        loadAll();
      });
    }

    document.querySelector("#refresh").addEventListener("click", loadAll);
    [kind, state, limit].forEach((field) => field.addEventListener("change", loadJobs));
    search.addEventListener("input", debounce(loadJobs, 250));
    historyLoad.addEventListener("click", loadHistory);
    historyUrl.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        loadHistory();
      }
    });

    function headers() {
      const token = tokenInput ? tokenInput.value : "";
      return token ? { Authorization: "Bearer " + token } : {};
    }

    async function api(path, options = {}) {
      const response = await fetch(path, { ...options, headers: { ...headers(), ...(options.headers || {}) } });

      if (!response.ok) {
        throw new Error((await response.json()).message || "Request failed");
      }

      return response.json();
    }

    async function loadAll() {
      await Promise.all([loadJobs(), loadQueues()]);
    }

    async function loadJobs() {
      const params = new URLSearchParams({ limit: limit.value });

      if (kind.value) params.set("kind", kind.value);
      if (state.value) params.set("state", state.value);
      if (search.value.trim()) params.set("q", search.value.trim());

      const data = await api("/admin/jobs?" + params.toString());
      const jobs = data.jobs || [];
      const counts = jobs.reduce((acc, job) => {
        acc.total += 1;
        acc[job.state] = (acc[job.state] || 0) + 1;
        return acc;
      }, { total: 0, pending: 0, completed: 0, failed: 0 });

      document.querySelector("#count-total").textContent = data.metadata.total;
      document.querySelector("#count-pending").textContent = counts.pending;
      document.querySelector("#count-completed").textContent = counts.completed;
      document.querySelector("#count-failed").textContent = counts.failed;
      updated.textContent = "Updated " + new Date().toLocaleTimeString();

      if (jobs.length === 0) {
        jobsBody.innerHTML = '<tr><td colspan="5" class="muted">No jobs found.</td></tr>';
        return;
      }

      jobsBody.innerHTML = jobs.map((job) => {
        const updatedAt = new Date(job.updated_at).toLocaleString();
        const url = job.url ? escapeHtml(job.url) : '<span class="muted">None</span>';

        return '<tr>' +
          '<td><span class="state ' + job.state + '">' + job.state + '</span></td>' +
          '<td>' + job.kind + '<br><span class="muted">' + job.attempts + ' attempt(s)</span></td>' +
          '<td>' + updatedAt + '</td>' +
          '<td class="url">' + url + '</td>' +
          '<td><button data-job="' + job.id + '">View</button>' +
          (job.has_report && job.url ? ' <button data-history-url="' + escapeHtml(job.url) + '">History</button>' : "") +
          '</td>' +
          '</tr>';
      }).join("");

      jobsBody.querySelectorAll("button[data-job]").forEach((button) => {
        button.addEventListener("click", () => loadDetail(button.dataset.job));
      });
      jobsBody.querySelectorAll("button[data-history-url]").forEach((button) => {
        button.addEventListener("click", () => {
          historyUrl.value = button.dataset.historyUrl;
          loadHistory();
        });
      });
    }

    async function loadQueues() {
      const data = await api("/admin/queues");
      queuesBody.innerHTML = (data.queues || []).map((queue) =>
        '<tr><td>' + queue.kind + '</td><td>' + queue.waiting + '</td><td>' + queue.active + '</td><td>' +
        queue.delayed + '</td><td>' + queue.completed + '</td><td>' + queue.failed + '</td></tr>'
      ).join("");
    }

    async function loadDetail(id) {
      selectedJob = await api("/admin/jobs/" + encodeURIComponent(id));
      detailData = { job: selectedJob };

      if (selectedJob.has_report) {
        detailData.report = await api("/reports/" + encodeURIComponent(id));
        detailData.recommendations = await api("/reports/" + encodeURIComponent(id) + "/recommendations");

        if (selectedJob.url) {
          historyUrl.value = selectedJob.url;
          await loadHistory();
        }
      }

      renderDetail("job");
    }

    function renderDetail(tab) {
      const tabs = ["job", "input", "result", "report", "recommendations"];
      const retry = selectedJob && selectedJob.state !== "pending"
        ? '<button class="danger" id="retry">Retry</button>'
        : "";
      const cancel = selectedJob && selectedJob.state === "pending"
        ? '<button class="danger" id="cancel">Cancel</button>'
        : "";
      detail.innerHTML =
        '<div class="tabs">' +
        tabs.map((item) => '<button data-tab="' + item + '" class="' + (item === tab ? "active" : "") + '">' + item + '</button>').join("") +
        retry + cancel +
        '</div><pre>' + escapeHtml(JSON.stringify(valueForTab(tab), null, 2)) + '</pre>';
      detail.classList.add("open");
      detail.querySelectorAll("button[data-tab]").forEach((button) => {
        button.addEventListener("click", () => renderDetail(button.dataset.tab));
      });
      const retryButton = detail.querySelector("#retry");

      if (retryButton) {
        retryButton.addEventListener("click", retrySelectedJob);
      }

      const cancelButton = detail.querySelector("#cancel");

      if (cancelButton) {
        cancelButton.addEventListener("click", cancelSelectedJob);
      }
    }

    function valueForTab(tab) {
      if (tab === "input") return selectedJob.input;
      if (tab === "result") return selectedJob.result;
      if (tab === "report") return detailData.report || null;
      if (tab === "recommendations") return detailData.recommendations || null;
      return selectedJob;
    }

    async function retrySelectedJob() {
      if (!selectedJob) return;
      await api("/admin/jobs/" + encodeURIComponent(selectedJob.id) + "/retry", { method: "POST" });
      detail.classList.remove("open");
      await loadAll();
    }

    async function cancelSelectedJob() {
      if (!selectedJob) return;
      await api("/admin/jobs/" + encodeURIComponent(selectedJob.id) + "/cancel", { method: "POST" });
      detail.classList.remove("open");
      await loadAll();
    }

    async function loadHistory() {
      const url = historyUrl.value.trim();

      if (!url) {
        history.innerHTML = '<div class="muted">Enter a URL to compare recent reports.</div>';
        return;
      }

      const data = await api("/admin/reports/history?url=" + encodeURIComponent(url));
      const reports = data.reports || [];

      if (reports.length === 0) {
        history.innerHTML = '<div class="muted">No reports found for this URL.</div>';
        return;
      }

      history.innerHTML =
        '<div class="history-summary">' + renderDeltas(data.comparison) + '</div>' +
        '<div class="chart">' + reports.slice(0, 8).map(renderHistoryReport).join("") + '</div>';
    }

    function renderDeltas(comparison) {
      if (!comparison) {
        return '<span class="delta">No previous report</span>';
      }

      return [
        ["Score", comparison.performance_score, true],
        ["LCP", comparison.largest_contentful_paint, false],
        ["TBT", comparison.total_blocking_time, false],
        ["CLS", comparison.cumulative_layout_shift, false],
        ["TTFB", comparison.time_to_first_byte, false],
      ].map(([label, value, higherIsBetter]) => {
        const numeric = Number(value || 0);
        const good = higherIsBetter ? numeric >= 0 : numeric <= 0;
        const sign = numeric > 0 ? "+" : "";

        return '<span class="delta ' + (good ? "good" : "bad") + '">' +
          label + ' ' + sign + formatMetricDelta(label, numeric) +
          '</span>';
      }).join("");
    }

    function renderHistoryReport(report) {
      const metrics = report.metrics || {};
      const score = Number(metrics.performance_score || 0);
      const generatedAt = report.generated_at ? new Date(report.generated_at).toLocaleString() : report.id;

      return [
        renderChartRow(generatedAt, "Score", score, 100, String(score)),
        renderChartRow("", "LCP", metricValue(metrics.largest_contentful_paint), 6000, formatMs(metricValue(metrics.largest_contentful_paint))),
        renderChartRow("", "TBT", metricValue(metrics.total_blocking_time), 1000, formatMs(metricValue(metrics.total_blocking_time))),
        renderChartRow("", "CLS", metricValue(metrics.cumulative_layout_shift), 0.5, metricValue(metrics.cumulative_layout_shift).toFixed(3)),
        renderChartRow("", "TTFB", metricValue(metrics.time_to_first_byte), 2000, formatMs(metricValue(metrics.time_to_first_byte))),
      ].join("");
    }

    function renderChartRow(label, metric, value, max, display) {
      const width = Math.max(0, Math.min(100, (Number(value || 0) / max) * 100));

      return '<div class="chart-row">' +
        '<div>' + escapeHtml(label || metric) + '</div>' +
        '<div class="track" title="' + metric + '"><div class="bar" style="width:' + width + '%"></div></div>' +
        '<div class="muted">' + escapeHtml(metric + ' ' + display) + '</div>' +
        '</div>';
    }

    function metricValue(metric) {
      return Number(metric && typeof metric.value === "number" ? metric.value : 0);
    }

    function formatMs(value) {
      return Math.round(value) + "ms";
    }

    function formatMetricDelta(label, value) {
      if (label === "Score") {
        return String(value);
      }

      if (label === "CLS") {
        return value.toFixed(3);
      }

      return formatMs(value);
    }

    function escapeHtml(value) {
      return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;");
    }

    function debounce(fn, wait) {
      let timer;
      return (...args) => {
        clearTimeout(timer);
        timer = setTimeout(() => fn(...args), wait);
      };
    }

    loadAll().catch((error) => {
      jobsBody.innerHTML = '<tr><td colspan="5">Unable to load jobs.</td></tr>';
      detail.textContent = error.message;
      detail.classList.add("open");
    });
  </script>
</body>
</html>`;
}

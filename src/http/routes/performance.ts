import type { FastifyInstance } from "fastify";
import { env } from "../../config/env.js";
import type { PerformanceJobResult } from "../../contracts/performance.js";
import type { JobProducer } from "../../queues/producers.js";
import { auditPerformance, fakePerformanceMetrics, fakePerformanceReport } from "../../services/lighthouse/audit.js";
import type { JobStore } from "../../storage/job-store.js";
import { requestData } from "./request.js";

export async function performanceRoutes(
  app: FastifyInstance,
  store: JobStore,
  producer?: JobProducer,
): Promise<void> {
  app.post("/performance/", async (request) => {
    const body = requestData(request);
    const job = await store.create<PerformanceJobResult>("performance", body, {
      uuid: "",
      status: "completed",
      data: {
        data: fakePerformanceMetrics("pending"),
      },
      report: fakePerformanceReport("pending"),
    });
    job.completeAfterMs = Number.MAX_SAFE_INTEGER;

    if (producer) {
      await producer.enqueue("performance", { jobId: job.id, input: body });
    } else {
      const run = runPerformanceJob(store, job.id, body).catch((error: unknown) => {
        app.log.error({ error, jobId: job.id }, "Performance job failed unexpectedly");
      });

      if (env.NODE_ENV === "test") {
        await run;
      }
    }

    return {
      uuid: job.id,
      status: "pending",
    };
  });

  app.get("/performance/", async (request) => {
    const body = requestData(request);
    const uuid = typeof body.uuid === "string" ? body.uuid : "";
    const job = await store.get<PerformanceJobResult>(uuid);

    if (!job) {
      return {
        uuid,
        status: "failed",
        message: "Job not found",
      };
    }

    if (job.state === "failed") {
      return performanceResponse(job.result);
    }

    if (job.state !== "completed") {
      return {
        uuid: job.id,
        status: "pending",
      };
    }

    return performanceResponse(job.result);
  });

  app.get("/reports/:jobId", async (request, reply) => {
    const params = request.params as { jobId: string };
    const job = await store.get<PerformanceJobResult>(params.jobId);

    if (!job) {
      return reply.code(404).send({
        status: "failed",
        message: "Report not found",
      });
    }

    if (job.state === "failed") {
      return reply.code(500).send({
        uuid: job.id,
        status: "failed",
        message: job.result.message ?? "Audit failed",
        report: job.result.report,
      });
    }

    if (job.state !== "completed" || !job.result.report) {
      return reply.code(202).send({
        uuid: job.id,
        status: "pending",
      });
    }

    return reply.code(200).send(job.result.report);
  });
}

export async function runPerformanceJob(
  store: JobStore,
  jobId: string,
  body: Record<string, unknown>,
): Promise<void> {
  try {
    const report = await auditPerformance({
      url: requireString(body.url, "url"),
      jobId,
    });

    await store.complete<PerformanceJobResult>(jobId, {
      uuid: jobId,
      status: "completed",
      data: {
        data: report.metrics,
      },
      report,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Audit failed";
    const url = typeof body.url === "string" ? body.url : "https://example.com";

    await store.fail<PerformanceJobResult>(
      jobId,
      {
        uuid: jobId,
        status: "failed",
        message,
        data: {
          data: fakePerformanceMetrics(jobId),
        },
        report: fakePerformanceReport(jobId, url),
      },
      message,
    );
  }
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Missing required field: ${field}`);
  }

  return value;
}

function performanceResponse(result: PerformanceJobResult): Omit<PerformanceJobResult, "report"> {
  return {
    uuid: result.uuid,
    status: result.status,
    message: result.message,
    data: result.data,
  };
}

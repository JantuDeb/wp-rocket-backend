import type { FastifyInstance } from "fastify";
import type { PerformanceJobResult } from "../../contracts/performance.js";
import { recommendationsForInput, recommendationsForReport } from "../../services/recommendations/rules.js";
import type { JobStore } from "../../storage/job-store.js";
import { requestData } from "./request.js";

export async function recommendationsRoutes(app: FastifyInstance, store: JobStore): Promise<void> {
  app.get("/recommendations/", async (request) => {
    const body = requestData(request);
    const language = typeof body.language === "string" ? body.language : "en";
    const recommendations = recommendationsForInput({
      lcp: readNumber(body.lcp),
      ttfb: readNumber(body.ttfb),
      cls: readNumber(body.cls),
      tbt: readNumber(body.tbt),
      globalScore: readNumber(body.global_score),
      enabledOptions: readStringList(body.enabled_options),
      limit: readInteger(body.limit),
    });

    return {
      recommendations,
      metadata: {
        language,
        total_recommendations: recommendations.length,
      },
    };
  });

  app.get("/reports/:jobId/recommendations", async (request, reply) => {
    const params = request.params as { jobId: string };
    const body = requestData(request);
    const language = typeof body.language === "string" ? body.language : "en";
    const job = await store.get<PerformanceJobResult>(params.jobId);

    if (!job) {
      return reply.code(404).send({
        recommendations: [],
        metadata: {
          language,
          total_recommendations: 0,
          status: "failed",
          message: "Report not found",
        },
      });
    }

    if (job.state !== "completed" || !job.result.report) {
      return reply.code(202).send({
        recommendations: [],
        metadata: {
          language,
          total_recommendations: 0,
          status: "pending",
        },
      });
    }

    const recommendations = recommendationsForReport(job.result.report, readInteger(body.limit));

    return reply.code(200).send({
      recommendations,
      metadata: {
        language,
        total_recommendations: recommendations.length,
        report_uuid: job.result.report.uuid,
        status: "completed",
      },
    });
  });
}

function readStringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string");
  }

  if (value && typeof value === "object") {
    return Object.values(value).filter((item): item is string => typeof item === "string");
  }

  if (typeof value === "string" && value.trim().length > 0) {
    return value.split(",").map((item) => item.trim()).filter(Boolean);
  }

  return [];
}

function readInteger(value: unknown): number | undefined {
  const parsed = typeof value === "string" || typeof value === "number" ? Number(value) : undefined;

  if (!parsed || !Number.isFinite(parsed)) {
    return undefined;
  }

  return Math.max(1, Math.trunc(parsed));
}

function readNumber(value: unknown): number | undefined {
  const parsed = typeof value === "string" || typeof value === "number" ? Number(value) : undefined;

  if (parsed === undefined || !Number.isFinite(parsed)) {
    return undefined;
  }

  return parsed;
}

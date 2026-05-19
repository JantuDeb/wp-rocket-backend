import type { FastifyInstance } from "fastify";
import type { CpcssStatusResponse } from "../../contracts/cpcss.js";
import { env } from "../../config/env.js";
import { generateCriticalCss } from "../../services/css/critical-css.js";
import type { MemoryJobStore } from "../../storage/memory-job-store.js";
import { requestData } from "./request.js";

export async function cpcssRoutes(app: FastifyInstance, store: MemoryJobStore): Promise<void> {
  app.post("/api/job/", async (request) => {
    const body = requestData(request);
    const job = store.create<CpcssStatusResponse>("cpcss", body, pendingResponse());
    job.completeAfterMs = Number.MAX_SAFE_INTEGER;

    const run = runCpcssJob(store, job.id, body).catch((error: unknown) => {
      app.log.error({ error, jobId: job.id }, "Critical CSS job failed unexpectedly");
    });

    if (env.NODE_ENV === "test") {
      await run;
    }

    return {
      status: 200,
      data: {
        id: job.id,
      },
    };
  });

  app.get("/api/job/:jobId/", async (request) => {
    const params = request.params as { jobId: string };
    const job = store.get<CpcssStatusResponse>(params.jobId);

    if (!job) {
      return {
        status: 400,
        message: "Job not found",
        data: {
          state: "failed",
        },
      };
    }

    if (job.state === "failed") {
      return job.result ?? failedResponse("Critical CSS job failed");
    }

    if (job.state !== "completed") {
      return {
        status: 200,
        data: {
          state: "pending",
        },
      };
    }

    return job.result ?? failedResponse("Critical CSS job completed without a result");
  });
}

async function runCpcssJob(
  store: MemoryJobStore,
  jobId: string,
  body: Record<string, unknown>,
): Promise<void> {
  try {
    const criticalCss = await generateCriticalCss({
      url: requireString(body.url, "url"),
      mobile: toBoolean(body.mobile),
      nofontface: toBoolean(body.nofontface),
    });

    store.complete<CpcssStatusResponse>(jobId, {
      status: 200,
      data: {
        state: "complete",
        critical_path: criticalCss,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to generate critical CSS";

    store.fail<CpcssStatusResponse>(jobId, failedResponse(message), message);
  }
}

function pendingResponse(): CpcssStatusResponse {
  return {
    status: 200,
    data: {
      state: "pending",
    },
  };
}

function failedResponse(message: string): CpcssStatusResponse {
  return {
    status: 400,
    message,
    data: {
      state: "failed",
    },
  };
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Missing required field: ${field}`);
  }

  return value;
}

function toBoolean(value: unknown): boolean {
  return value === true || value === "true" || value === "1" || value === 1;
}

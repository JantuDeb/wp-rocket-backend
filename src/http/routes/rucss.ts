import type { FastifyInstance } from "fastify";
import type { RucssQueueName, RucssReturnValue } from "../../contracts/rucss.js";
import { env } from "../../config/env.js";
import type { JobProducer } from "../../queues/producers.js";
import type { JobStore } from "../../storage/job-store.js";
import { generateUsedCss } from "../../services/css/used-css.js";
import { fakeAboveTheFoldResult } from "../../services/hints/above-the-fold.js";
import { requestData } from "./request.js";

export async function rucssRoutes(
  app: FastifyInstance,
  store: JobStore,
  producer?: JobProducer,
): Promise<void> {
  app.post("/rucss-job", async (request, reply) => {
    const body = requestData(request);
    const queueName = resolveQueueName(body);
    const job = await store.create<RucssReturnValue>(queueName, body, pendingReturnValue());
    job.completeAfterMs = Number.MAX_SAFE_INTEGER;

    if (producer) {
      await producer.enqueue(queueName, { jobId: job.id, input: body });
    } else {
      const run = runRucssJob(store, job.id, queueName, body).catch((error: unknown) => {
        app.log.error({ error, jobId: job.id }, "RUCSS job failed unexpectedly");
      });

      if (env.NODE_ENV === "test") {
        await run;
      }
    }

    return reply.code(201).send({
      code: 200,
      message: "queued",
      contents: {
        jobId: job.id,
        queueName,
      },
    });
  });

  app.get("/rucss-job", async (request) => {
    const body = requestData(request);
    const id = typeof body.id === "string" ? body.id : "";
    const job = await store.get<RucssReturnValue>(id);

    if (!job) {
      return {
        code: 200,
        returnvalue: failedReturnValue("Job not found"),
      };
    }

    return {
      code: 200,
      returnvalue: job.state === "completed" || job.state === "failed" ? job.result : pendingReturnValue(),
    };
  });
}

export function resolveQueueName(body: Record<string, unknown>): RucssQueueName {
  const config = body.config as { optimization_list?: unknown } | undefined;
  const optimizationList = config?.optimization_list;

  if (Array.isArray(optimizationList) && optimizationList.includes("performance_hints")) {
    return "performance_hints";
  }

  if (
    optimizationList &&
    typeof optimizationList === "object" &&
    Object.values(optimizationList).includes("performance_hints")
  ) {
    return "performance_hints";
  }

  return "rucss";
}

export async function runRucssJob(
  store: JobStore,
  jobId: string,
  queueName: RucssQueueName,
  body: Record<string, unknown>,
): Promise<void> {
  try {
    const result = await generateUsedCss({
      url: requireString(body.url, "url"),
      mobile: toBoolean(readConfigValue(body, "is_mobile")),
      safelist: readStringList(readConfigValue(body, "rucss_safelist")),
    });

    await store.complete<RucssReturnValue>(jobId, {
      code: 200,
      status: "completed",
      message: "completed",
      contents: {
        success: true,
        shakedCSS: queueName === "rucss" ? result.css : "",
        shakedCSS_size: queueName === "rucss" ? result.css.length : 0,
        above_the_fold_result: result.aboveTheFold,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to render page";

    await store.fail<RucssReturnValue>(jobId, failedReturnValue(message), message);
  }
}

function readConfigValue(body: Record<string, unknown>, key: string): unknown {
  const config = body.config as Record<string, unknown> | undefined;

  return config?.[key];
}

function readStringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string");
  }

  if (value && typeof value === "object") {
    return Object.values(value).filter((item): item is string => typeof item === "string");
  }

  if (typeof value === "string" && value.trim().length > 0) {
    return [value];
  }

  return [];
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

function pendingReturnValue(): RucssReturnValue {
  return {
    code: 202,
    status: "pending",
    message: "Job is still running",
    contents: {
      success: false,
      shakedCSS: "",
      shakedCSS_size: 0,
      above_the_fold_result: fakeAboveTheFoldResult(),
    },
  };
}

function failedReturnValue(message: string): RucssReturnValue {
  return {
    code: 500,
    status: "failed",
    message,
    contents: {
      success: false,
      shakedCSS: "",
      shakedCSS_size: 0,
      above_the_fold_result: fakeAboveTheFoldResult(),
    },
  };
}

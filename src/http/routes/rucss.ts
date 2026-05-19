import type { FastifyInstance } from "fastify";
import type { RucssQueueName, RucssReturnValue } from "../../contracts/rucss.js";
import type { MemoryJobStore } from "../../storage/memory-job-store.js";
import { fakeUsedCss } from "../../services/css/used-css.js";
import { fakeAboveTheFoldResult } from "../../services/hints/above-the-fold.js";
import { requestData } from "./request.js";

export async function rucssRoutes(app: FastifyInstance, store: MemoryJobStore): Promise<void> {
  app.post("/rucss-job", async (request, reply) => {
    const body = requestData(request);
    const queueName = resolveQueueName(body);
    const result = completedReturnValue(queueName);
    const job = store.create(queueName, body, result);

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
    const job = store.get<RucssReturnValue>(id);

    if (!job) {
      return {
        code: 200,
        returnvalue: failedReturnValue("Job not found"),
      };
    }

    return {
      code: 200,
      returnvalue: job.state === "completed" ? job.result : pendingReturnValue(),
    };
  });
}

function resolveQueueName(body: Record<string, unknown>): RucssQueueName {
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

function completedReturnValue(queueName: RucssQueueName): RucssReturnValue {
  return {
    code: 200,
    status: "completed",
    message: "completed",
    contents: {
      success: true,
      shakedCSS: queueName === "rucss" ? fakeUsedCss() : "",
      shakedCSS_size: queueName === "rucss" ? fakeUsedCss().length : 0,
      above_the_fold_result: fakeAboveTheFoldResult(),
    },
  };
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

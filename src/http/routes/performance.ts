import type { FastifyInstance } from "fastify";
import { fakePerformanceMetrics } from "../../services/lighthouse/audit.js";
import type { MemoryJobStore } from "../../storage/memory-job-store.js";
import { requestData } from "./request.js";

type PerformanceResult = {
  uuid: string;
  status: "completed";
  data: {
    data: ReturnType<typeof fakePerformanceMetrics>;
  };
};

export async function performanceRoutes(app: FastifyInstance, store: MemoryJobStore): Promise<void> {
  app.post("/performance/", async (request) => {
    const body = requestData(request);
    const job = store.create<PerformanceResult>("performance", body, {
      uuid: "",
      status: "completed",
      data: {
        data: fakePerformanceMetrics("pending"),
      },
    });

    job.result.uuid = job.id;
    job.result.data.data = fakePerformanceMetrics(job.id);

    return {
      uuid: job.id,
      status: "pending",
    };
  });

  app.get("/performance/", async (request) => {
    const body = requestData(request);
    const uuid = typeof body.uuid === "string" ? body.uuid : "";
    const job = store.get<PerformanceResult>(uuid);

    if (!job) {
      return {
        uuid,
        status: "failed",
        message: "Job not found",
      };
    }

    if (job.state !== "completed") {
      return {
        uuid: job.id,
        status: "pending",
      };
    }

    return job.result;
  });
}

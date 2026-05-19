import type { FastifyInstance } from "fastify";
import { recommendationsForInput } from "../../services/recommendations/rules.js";
import { requestData } from "./request.js";

export async function recommendationsRoutes(app: FastifyInstance): Promise<void> {
  app.get("/recommendations/", async (request) => {
    const body = requestData(request);
    const language = typeof body.language === "string" ? body.language : "en";
    const recommendations = recommendationsForInput();

    return {
      recommendations,
      metadata: {
        language,
        total_recommendations: recommendations.length,
      },
    };
  });
}

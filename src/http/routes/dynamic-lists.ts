import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { DynamicListName } from "../../contracts/dynamic-lists.js";
import { getDynamicList, getDynamicListHash } from "../../services/dynamic-lists/lists.js";
import { requestData } from "./request.js";

export async function dynamicListsRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/v2/exclusions/list", async (request, reply) => listResponse(request, reply, "default"));
  app.get("/api/v2/delay-js-exclusions/list", async (request, reply) => listResponse(request, reply, "delay-js"));
  app.get("/api/v2/incompatible-plugins/list", async (request, reply) =>
    listResponse(request, reply, "incompatible-plugins"),
  );
}

function listResponse(
  request: FastifyRequest,
  reply: FastifyReply,
  name: DynamicListName,
) {
  const body = requestData(request);
  const hash = typeof body.hash === "string" ? body.hash : "";

  if (hash && hash === getDynamicListHash(name)) {
    return reply.code(206).send({
      message: "Lists are up to date",
    });
  }

  return reply.code(200).send(getDynamicList(name));
}

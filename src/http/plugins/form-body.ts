import formBody from "@fastify/formbody";
import type { FastifyInstance } from "fastify";

export async function registerFormBody(app: FastifyInstance): Promise<void> {
  await app.register(formBody);
}

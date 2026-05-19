import type { FastifyInstance } from "fastify";

export async function testApp(): Promise<FastifyInstance> {
  process.env.NODE_ENV = "test";
  process.env.JOB_COMPLETE_AFTER_MS = "0";

  const { buildApp } = await import("../../src/app.js");
  const app = await buildApp();
  await app.ready();

  return app;
}

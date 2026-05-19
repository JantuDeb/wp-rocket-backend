import type { FastifyInstance } from "fastify";

const pluginInfo =
  'O:8:"stdClass":6:{s:4:"name";s:9:"WP Rocket";s:4:"slug";s:9:"wp-rocket";s:7:"version";s:6:"3.21.0";s:6:"tested";s:3:"6.8";s:8:"homepage";s:21:"https://wp-rocket.me";s:8:"sections";a:1:{s:11:"description";s:9:"WP Rocket";}}';

export async function productApiRoutes(app: FastifyInstance): Promise<void> {
  app.get("/stat/1.0/wp-rocket/pricing-2023.php", async () => ({
    single: { price: 59, currency: "USD" },
    plus: { price: 119, currency: "USD" },
    infinite: { price: 299, currency: "USD" },
  }));

  app.post("/api/wp-rocket/plugin-settings.php", async () => ({
    success: true,
    data: {
      settings: {},
      features: {},
    },
  }));

  app.get("/check_update.php", async (_request, reply) => {
    return reply.type("text/plain").send("3.21.0||3.21.0");
  });

  app.get("/plugin_information.php", async (_request, reply) => {
    return reply.type("text/plain").send(pluginInfo);
  });
}

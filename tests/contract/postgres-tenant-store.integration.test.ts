import { afterEach, describe, expect, it } from "vitest";
import { PostgresTenantStore } from "../../src/storage/postgres-tenant-store.js";

const runPostgresTests = process.env.RUN_POSTGRES_TESTS === "1";
const describePostgres = runPostgresTests ? describe : describe.skip;

let store: PostgresTenantStore | undefined;

afterEach(async () => {
  await store?.close();
  store = undefined;
});

describePostgres("Postgres tenant store integration", () => {
  it("persists accounts, sites, API keys, and usage", async () => {
    store = new PostgresTenantStore(process.env.DATABASE_URL);
    await store.migrate();

    const account = await store.createAccount({
      email: `owner-${Date.now()}@example.com`,
      name: "Owner",
    });
    const site = await store.createSite({
      accountId: account.id,
      url: "https://example.com",
    });
    const apiKey = await store.createApiKey({
      accountId: account.id,
      siteId: site.id,
      name: "Connector",
    });
    const tenant = await store.validateApiKey(apiKey.key);

    expect(tenant).toMatchObject({
      account: {
        id: account.id,
      },
      site: {
        id: site.id,
        domain: "example.com",
      },
      apiKey: {
        prefix: apiKey.prefix,
      },
    });

    await expect(store.recordUsage({
      accountId: account.id,
      siteId: site.id,
      apiKeyId: apiKey.id,
      route: "/performance/",
      url: "https://example.com/",
    })).resolves.toBeUndefined();
  }, 15000);
});

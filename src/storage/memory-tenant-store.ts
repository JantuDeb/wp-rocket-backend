import {
  apiKeyPrefix,
  createId,
  generateApiKey,
  hashApiKey,
  normalizeSiteUrl,
  type Account,
  type ApiKey,
  type ApiKeySecret,
  type Site,
  type TenantContext,
  type TenantStore,
} from "./tenant-store.js";

type StoredApiKey = ApiKey & {
  hash: string;
};

export class MemoryTenantStore implements TenantStore {
  private readonly accounts = new Map<string, Account>();
  private readonly sites = new Map<string, Site>();
  private readonly apiKeys = new Map<string, StoredApiKey>();
  private readonly usage: Array<{ accountId: string; siteId?: string; apiKeyId: string; route: string; url?: string; createdAt: number }> = [];

  async migrate(): Promise<void> {}

  async createAccount(input: { email: string; name?: string }): Promise<Account> {
    const existing = [...this.accounts.values()].find((account) => account.email === input.email.toLowerCase());

    if (existing) {
      return existing;
    }

    const account: Account = {
      id: createId("acct"),
      email: input.email.toLowerCase(),
      name: input.name,
      createdAt: Date.now(),
    };

    this.accounts.set(account.id, account);

    return account;
  }

  async createSite(input: { accountId: string; url: string }): Promise<Site> {
    const normalized = normalizeSiteUrl(input.url);
    const existing = [...this.sites.values()].find((site) => site.accountId === input.accountId && site.domain === normalized.domain);

    if (existing) {
      return existing;
    }

    const site: Site = {
      id: createId("site"),
      accountId: input.accountId,
      url: normalized.url,
      domain: normalized.domain,
      createdAt: Date.now(),
    };

    this.sites.set(site.id, site);

    return site;
  }

  async createApiKey(input: { accountId: string; siteId?: string; name: string }): Promise<ApiKeySecret> {
    const key = generateApiKey();
    const apiKey: StoredApiKey = {
      id: createId("key"),
      accountId: input.accountId,
      siteId: input.siteId,
      name: input.name,
      prefix: apiKeyPrefix(key),
      hash: hashApiKey(key),
      createdAt: Date.now(),
    };

    this.apiKeys.set(apiKey.id, apiKey);

    return withoutHash(apiKey, key);
  }

  async validateApiKey(key: string): Promise<TenantContext | undefined> {
    const hash = hashApiKey(key);
    const apiKey = [...this.apiKeys.values()].find((item) => item.hash === hash);

    if (!apiKey) {
      return undefined;
    }

    apiKey.lastUsedAt = Date.now();

    const account = this.accounts.get(apiKey.accountId);

    if (!account) {
      return undefined;
    }

    return {
      account,
      site: apiKey.siteId ? this.sites.get(apiKey.siteId) : undefined,
      apiKey: withoutHash(apiKey),
    };
  }

  async listSites(accountId: string): Promise<Site[]> {
    return [...this.sites.values()].filter((site) => site.accountId === accountId);
  }

  async listApiKeys(accountId: string): Promise<ApiKey[]> {
    return [...this.apiKeys.values()].filter((apiKey) => apiKey.accountId === accountId).map((apiKey) => withoutHash(apiKey));
  }

  async recordUsage(input: { accountId: string; siteId?: string; apiKeyId: string; route: string; url?: string }): Promise<void> {
    this.usage.push({
      ...input,
      createdAt: Date.now(),
    });
  }
}

function withoutHash(apiKey: StoredApiKey, key?: string): ApiKeySecret {
  return {
    id: apiKey.id,
    accountId: apiKey.accountId,
    siteId: apiKey.siteId,
    name: apiKey.name,
    prefix: apiKey.prefix,
    createdAt: apiKey.createdAt,
    lastUsedAt: apiKey.lastUsedAt,
    key: key ?? "",
  };
}

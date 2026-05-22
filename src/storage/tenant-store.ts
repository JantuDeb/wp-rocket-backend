import { createHash, randomBytes, randomUUID } from "node:crypto";
import { env } from "../config/env.js";

export type Account = {
  id: string;
  email: string;
  name?: string;
  createdAt: number;
};

export type Site = {
  id: string;
  accountId: string;
  url: string;
  domain: string;
  createdAt: number;
};

export type ApiKey = {
  id: string;
  accountId: string;
  siteId?: string;
  name: string;
  prefix: string;
  createdAt: number;
  lastUsedAt?: number;
};

export type ApiKeySecret = ApiKey & {
  key: string;
};

export type TenantContext = {
  account: Account;
  site?: Site;
  apiKey: ApiKey;
};

export interface TenantStore {
  migrate(): Promise<void>;
  createAccount(input: { email: string; name?: string }): Promise<Account>;
  createSite(input: { accountId: string; url: string }): Promise<Site>;
  createApiKey(input: { accountId: string; siteId?: string; name: string }): Promise<ApiKeySecret>;
  validateApiKey(key: string): Promise<TenantContext | undefined>;
  listSites(accountId: string): Promise<Site[]>;
  listApiKeys(accountId: string): Promise<ApiKey[]>;
  recordUsage(input: { accountId: string; siteId?: string; apiKeyId: string; route: string; url?: string }): Promise<void>;
  close?(): Promise<void>;
}

export function generateApiKey(): string {
  return `wprb_${randomBytes(24).toString("base64url")}`;
}

export function apiKeyPrefix(key: string): string {
  return key.slice(0, 12);
}

export function hashApiKey(key: string): string {
  return createHash("sha256").update(`${env.API_KEY_PEPPER}:${key}`).digest("hex");
}

export function createId(prefix: string): string {
  return `${prefix}_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
}

export function normalizeSiteUrl(value: string): { url: string; domain: string } {
  const url = new URL(value.startsWith("http://") || value.startsWith("https://") ? value : `https://${value}`);
  url.hash = "";
  url.pathname = url.pathname === "/" ? "/" : url.pathname.replace(/\/+$/, "");

  return {
    url: url.origin,
    domain: url.hostname.toLowerCase(),
  };
}

export function hostMatchesSite(value: string | undefined, site: Site | undefined): boolean {
  if (!site || !value) {
    return true;
  }

  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();

    return host === site.domain || host.endsWith(`.${site.domain}`);
  } catch {
    return true;
  }
}

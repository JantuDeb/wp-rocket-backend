import pg from "pg";
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
import { env } from "../config/env.js";

const { Pool } = pg;

export class PostgresTenantStore implements TenantStore {
  private readonly pool: pg.Pool;

  constructor(connectionString = env.DATABASE_URL) {
    this.pool = new Pool({ connectionString });
  }

  async migrate(): Promise<void> {
    await this.pool.query(`
      create table if not exists accounts (
        id text primary key,
        email text not null unique,
        name text,
        created_at timestamptz not null default now()
      );

      create table if not exists sites (
        id text primary key,
        account_id text not null references accounts(id) on delete cascade,
        url text not null,
        domain text not null,
        created_at timestamptz not null default now(),
        unique(account_id, domain)
      );

      create table if not exists api_keys (
        id text primary key,
        account_id text not null references accounts(id) on delete cascade,
        site_id text references sites(id) on delete cascade,
        name text not null,
        prefix text not null,
        hash text not null unique,
        created_at timestamptz not null default now(),
        last_used_at timestamptz
      );

      create table if not exists request_usage (
        id bigserial primary key,
        account_id text not null references accounts(id) on delete cascade,
        site_id text references sites(id) on delete set null,
        api_key_id text not null references api_keys(id) on delete cascade,
        route text not null,
        url text,
        created_at timestamptz not null default now()
      );
    `);
  }

  async createAccount(input: { email: string; name?: string }): Promise<Account> {
    const id = createId("acct");
    const result = await this.pool.query(
      `insert into accounts (id, email, name)
       values ($1, $2, $3)
       on conflict (email) do update set name = coalesce(excluded.name, accounts.name)
       returning id, email, name, created_at`,
      [id, input.email.toLowerCase(), input.name ?? null],
    );

    return accountFromRow(result.rows[0]);
  }

  async createSite(input: { accountId: string; url: string }): Promise<Site> {
    const normalized = normalizeSiteUrl(input.url);
    const result = await this.pool.query(
      `insert into sites (id, account_id, url, domain)
       values ($1, $2, $3, $4)
       on conflict (account_id, domain) do update set url = excluded.url
       returning id, account_id, url, domain, created_at`,
      [createId("site"), input.accountId, normalized.url, normalized.domain],
    );

    return siteFromRow(result.rows[0]);
  }

  async createApiKey(input: { accountId: string; siteId?: string; name: string }): Promise<ApiKeySecret> {
    const key = generateApiKey();
    const result = await this.pool.query(
      `insert into api_keys (id, account_id, site_id, name, prefix, hash)
       values ($1, $2, $3, $4, $5, $6)
       returning id, account_id, site_id, name, prefix, created_at, last_used_at`,
      [createId("key"), input.accountId, input.siteId ?? null, input.name, apiKeyPrefix(key), hashApiKey(key)],
    );

    return {
      ...apiKeyFromRow(result.rows[0]),
      key,
    };
  }

  async validateApiKey(key: string): Promise<TenantContext | undefined> {
    const result = await this.pool.query(
      `select
        api_keys.id as key_id,
        api_keys.account_id,
        api_keys.site_id,
        api_keys.name as key_name,
        api_keys.prefix,
        api_keys.created_at as key_created_at,
        api_keys.last_used_at,
        accounts.email,
        accounts.name as account_name,
        accounts.created_at as account_created_at,
        sites.url as site_url,
        sites.domain as site_domain,
        sites.created_at as site_created_at
       from api_keys
       join accounts on accounts.id = api_keys.account_id
       left join sites on sites.id = api_keys.site_id
       where api_keys.hash = $1`,
      [hashApiKey(key)],
    );

    const row = result.rows[0];

    if (!row) {
      return undefined;
    }

    await this.pool.query("update api_keys set last_used_at = now() where id = $1", [row.key_id]);

    return {
      account: {
        id: row.account_id,
        email: row.email,
        name: row.account_name ?? undefined,
        createdAt: new Date(row.account_created_at).getTime(),
      },
      site: row.site_id
        ? {
            id: row.site_id,
            accountId: row.account_id,
            url: row.site_url,
            domain: row.site_domain,
            createdAt: new Date(row.site_created_at).getTime(),
          }
        : undefined,
      apiKey: {
        id: row.key_id,
        accountId: row.account_id,
        siteId: row.site_id ?? undefined,
        name: row.key_name,
        prefix: row.prefix,
        createdAt: new Date(row.key_created_at).getTime(),
        lastUsedAt: row.last_used_at ? new Date(row.last_used_at).getTime() : undefined,
      },
    };
  }

  async listSites(accountId: string): Promise<Site[]> {
    const result = await this.pool.query(
      "select id, account_id, url, domain, created_at from sites where account_id = $1 order by created_at desc",
      [accountId],
    );

    return result.rows.map(siteFromRow);
  }

  async listApiKeys(accountId: string): Promise<ApiKey[]> {
    const result = await this.pool.query(
      "select id, account_id, site_id, name, prefix, created_at, last_used_at from api_keys where account_id = $1 order by created_at desc",
      [accountId],
    );

    return result.rows.map(apiKeyFromRow);
  }

  async recordUsage(input: { accountId: string; siteId?: string; apiKeyId: string; route: string; url?: string }): Promise<void> {
    await this.pool.query(
      "insert into request_usage (account_id, site_id, api_key_id, route, url) values ($1, $2, $3, $4, $5)",
      [input.accountId, input.siteId ?? null, input.apiKeyId, input.route, input.url ?? null],
    );
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

function accountFromRow(row: Record<string, unknown>): Account {
  return {
    id: String(row.id),
    email: String(row.email),
    name: typeof row.name === "string" ? row.name : undefined,
    createdAt: new Date(String(row.created_at)).getTime(),
  };
}

function siteFromRow(row: Record<string, unknown>): Site {
  return {
    id: String(row.id),
    accountId: String(row.account_id),
    url: String(row.url),
    domain: String(row.domain),
    createdAt: new Date(String(row.created_at)).getTime(),
  };
}

function apiKeyFromRow(row: Record<string, unknown>): ApiKey {
  return {
    id: String(row.id),
    accountId: String(row.account_id),
    siteId: typeof row.site_id === "string" ? row.site_id : undefined,
    name: String(row.name),
    prefix: String(row.prefix),
    createdAt: new Date(String(row.created_at)).getTime(),
    lastUsedAt: row.last_used_at ? new Date(String(row.last_used_at)).getTime() : undefined,
  };
}

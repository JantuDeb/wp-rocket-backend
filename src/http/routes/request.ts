import type { FastifyRequest } from "fastify";

type PlainRecord = Record<string, unknown>;

export function requestData(request: FastifyRequest): PlainRecord {
  const query = isRecord(request.query) ? request.query : {};
  const body = isRecord(request.body) ? request.body : {};

  return normalizeNestedForm({ ...query, ...body });
}

export function normalizeNestedForm(input: PlainRecord): PlainRecord {
  const output: PlainRecord = {};

  for (const [key, value] of Object.entries(input)) {
    const path = parseFormKey(key);

    if (path.length === 1) {
      output[key] = value;
      continue;
    }

    assignPath(output, path, value);
  }

  return output;
}

function parseFormKey(key: string): string[] {
  const matches = [...key.matchAll(/([^\[\]]+)|\[([^\[\]]*)\]/g)];

  if (matches.length === 0) {
    return [key];
  }

  return matches.map((match) => match[1] ?? match[2] ?? "");
}

function assignPath(target: PlainRecord, path: string[], value: unknown): void {
  let current: Record<string, unknown> = target;

  path.forEach((part, index) => {
    const isLast = index === path.length - 1;
    const nextPart = path[index + 1];
    const key = part === "" ? String(Object.keys(current).length) : part;

    if (isLast) {
      current[key] = value;
      return;
    }

    if (current[key] === undefined) {
      current[key] = {};
    }

    current = current[key] as Record<string, unknown>;
  });
}

function isRecord(value: unknown): value is PlainRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

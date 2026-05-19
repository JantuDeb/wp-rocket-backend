import { lookup } from "node:dns/promises";
import net from "node:net";
import { load } from "cheerio";
import penthouse from "penthouse";
import puppeteer from "puppeteer-core";
import { env } from "../../config/env.js";

export type CriticalCssInput = {
  url: string;
  mobile?: boolean;
  nofontface?: boolean;
};

type Stylesheet = {
  css: string;
  media?: string;
};

export async function generateCriticalCss(input: CriticalCssInput): Promise<string> {
  if (env.NODE_ENV === "test") {
    return fakeCriticalCss();
  }

  const url = normalizeHttpUrl(input.url);
  await assertFetchAllowed(url);
  const stylesheets = await collectStylesheets(url);
  const cssString = stripFontFaces(wrapMediaStyles(stylesheets), Boolean(input.nofontface));

  if (cssString.trim().length === 0) {
    throw new Error("No stylesheets found for Critical CSS generation");
  }

  const viewport = input.mobile
    ? { width: env.CPCSS_MOBILE_WIDTH, height: env.CPCSS_MOBILE_HEIGHT }
    : { width: env.CPCSS_DESKTOP_WIDTH, height: env.CPCSS_DESKTOP_HEIGHT };

  const criticalCss = await penthouse({
    url: url.href,
    cssString,
    width: viewport.width,
    height: viewport.height,
    timeout: env.CPCSS_TIMEOUT_MS,
    keepLargerMediaQueries: true,
    blockJSRequests: true,
    pageLoadSkipTimeout: Math.min(5000, env.CPCSS_TIMEOUT_MS),
    renderWaitTime: 250,
    puppeteer: {
      getBrowser: () =>
        puppeteer.launch({
          executablePath: chromiumExecutablePath(),
          args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
          acceptInsecureCerts: true,
        }),
    },
  });

  if (typeof criticalCss !== "string" || criticalCss.trim().length === 0) {
    throw new Error("Critical CSS generation returned an empty result");
  }

  return criticalCss;
}

export function fakeCriticalCss(): string {
  return "body{color:#111;background:#fff}.site-header{display:block}:where(.hero){content-visibility:auto}";
}

async function collectStylesheets(pageUrl: URL): Promise<Stylesheet[]> {
  const html = await fetchText(pageUrl);
  const $ = load(html);
  const stylesheets: Stylesheet[] = [];
  let totalBytes = 0;

  $("style").each((_, element) => {
    const css = $(element).html() ?? "";
    totalBytes += Buffer.byteLength(css);
    stylesheets.push({ css });
  });

  const links = $("link[href]").toArray().filter((element) => {
    const rel = ($(element).attr("rel") ?? "").toLowerCase();
    const as = ($(element).attr("as") ?? "").toLowerCase();

    return rel.split(/\s+/).includes("stylesheet") || (rel === "preload" && as === "style");
  });

  for (const link of links) {
    const href = $(link).attr("href");

    if (!href) {
      continue;
    }

    const stylesheetUrl = new URL(href, pageUrl);
    await assertFetchAllowed(stylesheetUrl);
    const css = await fetchText(stylesheetUrl);
    totalBytes += Buffer.byteLength(css);

    if (totalBytes > env.CPCSS_MAX_CSS_BYTES) {
      throw new Error(`Critical CSS input exceeded ${env.CPCSS_MAX_CSS_BYTES} bytes`);
    }

    stylesheets.push({
      css,
      media: normalizeMedia($(link).attr("media")),
    });
  }

  return stylesheets;
}

function wrapMediaStyles(stylesheets: Stylesheet[]): string {
  return stylesheets
    .map(({ css, media }) => {
      if (!media || media === "all" || media === "screen") {
        return css;
      }

      return `@media ${media}{${css}}`;
    })
    .join("\n");
}

function stripFontFaces(css: string, nofontface: boolean): string {
  if (!nofontface) {
    return css;
  }

  return css.replace(/@font-face\s*{[^{}]*(?:{[^{}]*}[^{}]*)*}/gi, "");
}

async function fetchText(url: URL): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), env.CPCSS_FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "user-agent": "WP Rocket Self-Hosted Backend/0.1 Critical CSS",
        accept: "text/html,text/css,*/*;q=0.8",
      },
      redirect: "follow",
    });

    if (!response.ok) {
      throw new Error(`Fetch failed for ${url.href}: HTTP ${response.status}`);
    }

    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeHttpUrl(value: string): URL {
  const url = new URL(value);

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only HTTP and HTTPS URLs can be used for Critical CSS generation");
  }

  return url;
}

function normalizeMedia(value: string | undefined): string | undefined {
  const media = value?.trim().toLowerCase();

  if (!media || media === "print") {
    return undefined;
  }

  return media;
}

function chromiumExecutablePath(): string {
  return env.CPCSS_CHROMIUM_EXECUTABLE ?? "/usr/bin/chromium";
}

async function assertFetchAllowed(url: URL): Promise<void> {
  if (env.CPCSS_ALLOW_PRIVATE_NETWORKS) {
    return;
  }

  if (isLocalHostname(url.hostname) || isPrivateIp(url.hostname)) {
    throw new Error(`Blocked private network URL: ${url.hostname}`);
  }

  const records = await lookup(url.hostname, { all: true, verbatim: true });

  if (records.some((record) => isPrivateIp(record.address))) {
    throw new Error(`Blocked private network DNS target: ${url.hostname}`);
  }
}

function isLocalHostname(hostname: string): boolean {
  const host = hostname.toLowerCase();

  return host === "localhost" || host.endsWith(".localhost");
}

function isPrivateIp(address: string): boolean {
  const ipVersion = net.isIP(address);

  if (ipVersion === 4) {
    const [a = 0, b = 0] = address.split(".").map(Number);

    return (
      a === 10 ||
      a === 127 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254) ||
      a === 0
    );
  }

  if (ipVersion === 6) {
    const normalized = address.toLowerCase();

    return (
      normalized === "::1" ||
      normalized.startsWith("fc") ||
      normalized.startsWith("fd") ||
      normalized.startsWith("fe80:")
    );
  }

  return false;
}

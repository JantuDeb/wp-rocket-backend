import { lookup } from "node:dns/promises";
import net from "node:net";
import type { AtRule, Node, Root, Rule } from "postcss";
import safeParse from "postcss-safe-parser";
import puppeteer from "puppeteer-core";
import { env } from "../../config/env.js";
import type { AboveTheFoldResult } from "../../contracts/rucss.js";

export type UsedCssInput = {
  url: string;
  mobile?: boolean;
  safelist?: string[];
};

export type UsedCssResult = {
  css: string;
  aboveTheFold: AboveTheFoldResult;
};

export type CssCoverageRange = {
  start: number;
  end: number;
};

export type CssCoverageEntry = {
  text: string;
  ranges: CssCoverageRange[];
};

export function fakeUsedCss(): string {
  return [
    "body{color:#111;background:#fff}",
    ".wp-site-blocks{min-height:100vh}",
    ".rocket-selfhosted-backend{display:block}",
    ".rocket-selfhosted-backend main{max-width:1200px;margin:0 auto}",
    ".rocket-selfhosted-backend img{height:auto;max-width:100%}",
  ].join("");
}

export async function generateUsedCss(input: UsedCssInput): Promise<UsedCssResult> {
  if (env.NODE_ENV === "test") {
    return {
      css: fakeUsedCss(),
      aboveTheFold: {
        lcp: [],
        images_above_fold: [],
      },
    };
  }

  const url = normalizeHttpUrl(input.url);
  await assertFetchAllowed(url);
  const viewport = input.mobile
    ? { width: env.RUCSS_MOBILE_WIDTH, height: env.RUCSS_MOBILE_HEIGHT }
    : { width: env.RUCSS_DESKTOP_WIDTH, height: env.RUCSS_DESKTOP_HEIGHT };
  const browser = await puppeteer.launch({
    executablePath: chromiumExecutablePath(),
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
    acceptInsecureCerts: true,
  });

  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(env.RUCSS_TIMEOUT_MS);
    page.setDefaultNavigationTimeout(env.RUCSS_TIMEOUT_MS);
    await page.setViewport(viewport);
    await page.coverage.startCSSCoverage({ resetOnNavigation: false });
    await page.goto(url.href, {
      waitUntil: "networkidle2",
      timeout: env.RUCSS_TIMEOUT_MS,
    });
    await waitForLateStyles(page);

    const [coverage, aboveTheFold] = await Promise.all([
      page.coverage.stopCSSCoverage() as Promise<CssCoverageEntry[]>,
      collectAboveTheFold(page),
    ]);
    const css = buildUsedCss(coverage, input.safelist ?? []);

    if (css.trim().length === 0) {
      throw new Error("CSS coverage returned an empty result");
    }

    return { css, aboveTheFold };
  } finally {
    await browser.close();
  }
}

export function buildUsedCss(coverage: CssCoverageEntry[], safelist: string[]): string {
  const parts: string[] = [];

  for (const entry of coverage) {
    parts.push(pruneCssEntry(entry, safelist));
  }

  return dedupeCss(parts).join("\n");
}

function pruneCssEntry(entry: CssCoverageEntry, safelist: string[]): string {
  const root = safeParse(entry.text) as Root;
  const ranges = mergeRanges(entry.ranges);
  const usedAnimationNames = new Set<string>();

  root.walkRules((rule) => {
    if (isInsideKeyframes(rule)) {
      return;
    }

    if (!shouldKeepRule(rule, ranges, safelist)) {
      rule.remove();
      return;
    }

    collectAnimationNames(rule, usedAnimationNames);
  });

  root.walkAtRules((atRule) => {
    if (isAlwaysPreservedAtRule(atRule)) {
      return;
    }

    if (isKeyframesAtRule(atRule)) {
      if (!usedAnimationNames.has(atRule.params.trim())) {
        atRule.remove();
      }

      return;
    }

    if (isEmptyAtRuleContainer(atRule)) {
      atRule.remove();
    }
  });

  return root.toString();
}

function shouldKeepRule(rule: Rule, ranges: CssCoverageRange[], safelist: string[]): boolean {
  return (
    isCovered(rule, ranges) ||
    isSafelistedSelector(rule.selector, safelist) ||
    preservesCustomProperties(rule)
  );
}

function isCovered(node: Node, ranges: CssCoverageRange[]): boolean {
  const nodeRange = sourceRange(node);

  if (!nodeRange) {
    return false;
  }

  return ranges.some((range) => rangesOverlap(nodeRange, range));
}

function sourceRange(node: Node): CssCoverageRange | undefined {
  const start = node.source?.start?.offset;
  const end = node.source?.end?.offset;

  if (start === undefined || end === undefined || end <= start) {
    return undefined;
  }

  return { start, end };
}

function rangesOverlap(left: CssCoverageRange, right: CssCoverageRange): boolean {
  return left.start < right.end && right.start < left.end;
}

function isSafelistedSelector(selector: string, safelist: string[]): boolean {
  return safelist.some((item) => selectorMatchesSafelist(selector, item));
}

function selectorMatchesSafelist(selector: string, item: string): boolean {
  const pattern = item.trim();

  if (!pattern) {
    return false;
  }

  if (pattern.startsWith("/") && pattern.endsWith("/") && pattern.length > 2) {
    try {
      return new RegExp(pattern.slice(1, -1)).test(selector);
    } catch {
      return selector.includes(pattern);
    }
  }

  return selector.includes(pattern);
}

function preservesCustomProperties(rule: Rule): boolean {
  if (rule.selector.split(",").some((selector) => selector.trim() === ":root")) {
    return true;
  }

  return rule.nodes.some((node) => node.type === "decl" && node.prop.startsWith("--"));
}

function collectAnimationNames(rule: Rule, names: Set<string>): void {
  rule.walkDecls((decl) => {
    if (decl.prop === "animation-name") {
      names.add(decl.value.trim());
      return;
    }

    if (decl.prop === "animation") {
      const animationName = decl.value.split(/\s+/).find((part) => !animationKeywords.has(part));

      if (animationName) {
        names.add(animationName);
      }
    }
  });
}

function isAlwaysPreservedAtRule(atRule: AtRule): boolean {
  return atRule.name === "font-face";
}

function isKeyframesAtRule(atRule: AtRule): boolean {
  return atRule.name === "keyframes" || atRule.name === "-webkit-keyframes";
}

function isInsideKeyframes(rule: Rule): boolean {
  let parent = rule.parent as Node | undefined;

  while (parent) {
    if (parent.type === "atrule" && isKeyframesAtRule(parent as AtRule)) {
      return true;
    }

    parent = parent.parent as Node | undefined;
  }

  return false;
}

function isEmptyAtRuleContainer(atRule: AtRule): boolean {
  return Array.isArray(atRule.nodes) && atRule.nodes.length === 0;
}

const animationKeywords = new Set([
  "none",
  "infinite",
  "normal",
  "reverse",
  "alternate",
  "alternate-reverse",
  "forwards",
  "backwards",
  "both",
  "running",
  "paused",
  "ease",
  "ease-in",
  "ease-out",
  "ease-in-out",
  "linear",
]);

function mergeRanges(ranges: CssCoverageRange[]): CssCoverageRange[] {
  return [...ranges]
    .sort((a, b) => a.start - b.start)
    .reduce<CssCoverageRange[]>((merged, range) => {
      const previous = merged.at(-1);

      if (!previous || range.start > previous.end) {
        merged.push({ ...range });
        return merged;
      }

      previous.end = Math.max(previous.end, range.end);
      return merged;
    }, []);
}

function dedupeCss(parts: string[]): string[] {
  const seen = new Set<string>();

  return parts
    .map((part) => part.trim())
    .filter((part) => {
      if (!part || seen.has(part)) {
        return false;
      }

      seen.add(part);
      return true;
    });
}

async function waitForLateStyles(page: import("puppeteer-core").Page): Promise<void> {
  await page.evaluate(() => document.fonts?.ready).catch(() => undefined);
  await new Promise((resolve) => setTimeout(resolve, 250));
}

async function collectAboveTheFold(page: import("puppeteer-core").Page): Promise<AboveTheFoldResult> {
  return page.evaluate(() => {
    function selectorFor(element: Element): string {
      if (element.id) {
        return `#${CSS.escape(element.id)}`;
      }

      const className = Array.from(element.classList).slice(0, 3).map((item) => `.${CSS.escape(item)}`).join("");

      return `${element.tagName.toLowerCase()}${className}`;
    }

    function imageData(element: Element) {
      const image = element as HTMLImageElement;

      return {
        selector: selectorFor(element),
        src: image.currentSrc || image.src || element.getAttribute("src") || "",
        tag: element.tagName.toLowerCase(),
      };
    }

    const viewportHeight = window.innerHeight;
    const images_above_fold = Array.from(document.images)
      .filter((image) => {
        const rect = image.getBoundingClientRect();

        return rect.bottom > 0 && rect.top < viewportHeight && rect.width > 0 && rect.height > 0;
      })
      .map(imageData);
    const largestImage = images_above_fold[0] ? [images_above_fold[0]] : [];

    return {
      lcp: largestImage,
      images_above_fold,
    };
  });
}

function normalizeHttpUrl(value: string): URL {
  const url = new URL(value);

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only HTTP and HTTPS URLs can be used for RUCSS generation");
  }

  return url;
}

function chromiumExecutablePath(): string {
  return env.RUCSS_CHROMIUM_EXECUTABLE ?? env.CPCSS_CHROMIUM_EXECUTABLE ?? "/usr/bin/chromium";
}

async function assertFetchAllowed(url: URL): Promise<void> {
  if (env.RUCSS_ALLOW_PRIVATE_NETWORKS) {
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

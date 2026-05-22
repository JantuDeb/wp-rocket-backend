import { lookup } from "node:dns/promises";
import net from "node:net";
import puppeteer from "puppeteer-core";
import { env } from "../../config/env.js";
import type {
  PerformanceIssue,
  PerformanceHandleMetadata,
  PerformanceInlineSource,
  PerformanceLcpPreloadCandidate,
  PerformanceMetrics,
  PerformanceObservability,
  PerformanceDomEvidence,
  PerformanceReport,
  PerformanceResource,
  PerformanceSourceAttribution,
  PerformanceSourceGroup,
} from "../../contracts/performance.js";

declare global {
  interface Window {
    __rocketMetrics?: {
      cls: number;
      lcp: number;
      lcpElement?: PerformanceDomEvidence;
      layoutShiftElements: PerformanceDomEvidence[];
      longTaskBlockingTime: number;
    };
  }
}

export type PerformanceAuditInput = {
  url: string;
  jobId: string;
  handles?: PerformanceHandleMetadata[];
};

export function fakePerformanceMetrics(jobId: string): PerformanceMetrics {
  return {
    report_url: `http://localhost:8080/reports/${jobId}`,
    performance_score: 90,
    largest_contentful_paint: { value: 1800 },
    total_blocking_time: { value: 80 },
    cumulative_layout_shift: { value: 0.02 },
    time_to_first_byte: { value: 240 },
  };
}

export function fakePerformanceReport(
  jobId: string,
  url = "https://example.com",
  handles: PerformanceHandleMetadata[] = [],
): PerformanceReport {
  const metrics = fakePerformanceMetrics(jobId);
  const pageUrl = new URL(url);
  const inlineSources = inlineSourcesForHandles(handles, pageUrl);

  return {
    uuid: jobId,
    url,
    generated_at: new Date(0).toISOString(),
    metrics,
    issues: [],
    resources: [],
    inline_sources: inlineSources,
    dom_evidence: [],
    lcp_preload_candidates: [],
    source_groups: buildSourceGroups([], [], inlineSources),
    observability: {
      audit_duration_ms: 0,
      resource_count: 0,
      issue_count: 0,
    },
  };
}

export async function auditPerformance(input: PerformanceAuditInput): Promise<PerformanceReport> {
  if (env.NODE_ENV === "test") {
    return fakePerformanceReport(input.jobId, input.url, input.handles);
  }

  const url = normalizeHttpUrl(input.url);
  await assertFetchAllowed(url);
  const auditStartedAt = Date.now();
  const observability: PerformanceObservability = {
    audit_duration_ms: 0,
    resource_count: 0,
    issue_count: 0,
  };
  const browserLaunchStartedAt = Date.now();
  const browser = await puppeteer.launch({
    executablePath: chromiumExecutablePath(),
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
    acceptInsecureCerts: true,
  });
  observability.browser_launch_ms = Date.now() - browserLaunchStartedAt;

  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(env.PERFORMANCE_TIMEOUT_MS);
    page.setDefaultNavigationTimeout(env.PERFORMANCE_TIMEOUT_MS);
    await page.setViewport({
      width: env.PERFORMANCE_DESKTOP_WIDTH,
      height: env.PERFORMANCE_DESKTOP_HEIGHT,
    });
    await installMetricObservers(page);
    const pageLoadStartedAt = Date.now();
    await page.goto(url.href, {
      waitUntil: "networkidle2",
      timeout: env.PERFORMANCE_TIMEOUT_MS,
    });
    await new Promise((resolve) => setTimeout(resolve, 1000));
    observability.page_load_ms = Date.now() - pageLoadStartedAt;

    const collectStartedAt = Date.now();
    const [timings, resources, lcpPreloadCandidates] = await Promise.all([
      collectMetrics(page),
      collectResources(page, url, input.handles ?? []),
      collectLcpPreloadCandidates(page, url),
    ]);
    observability.metrics_collect_ms = Date.now() - collectStartedAt;
    const metrics: PerformanceMetrics = {
      report_url: `http://localhost:${env.PORT}/reports/${input.jobId}`,
      performance_score: scoreMetrics(timings),
      largest_contentful_paint: { value: Math.round(timings.lcp) },
      total_blocking_time: { value: Math.round(timings.tbt) },
      cumulative_layout_shift: { value: Number(timings.cls.toFixed(3)) },
      time_to_first_byte: { value: Math.round(timings.ttfb) },
    };
    const issues = buildIssues(metrics, resources, url, timings.domEvidence, lcpPreloadCandidates);
    const inlineSources = inlineSourcesForHandles(input.handles ?? [], url);
    observability.audit_duration_ms = Date.now() - auditStartedAt;
    observability.resource_count = resources.length;
    observability.issue_count = issues.length;

    return {
      uuid: input.jobId,
      url: url.href,
      generated_at: new Date().toISOString(),
      metrics,
      issues,
      resources,
      inline_sources: inlineSources,
      dom_evidence: timings.domEvidence,
      lcp_preload_candidates: lcpPreloadCandidates,
      source_groups: buildSourceGroups(resources, issues, inlineSources),
      observability,
    };
  } catch (error) {
    observability.audit_duration_ms = Date.now() - auditStartedAt;
    observability.browser_error = error instanceof Error ? error.message : "Unknown browser audit failure";
    throw error;
  } finally {
    await browser.close();
  }
}

async function installMetricObservers(page: import("puppeteer-core").Page): Promise<void> {
  await page.evaluateOnNewDocument(() => {
    window.__rocketMetrics = {
      cls: 0,
      lcp: 0,
      layoutShiftElements: [],
      longTaskBlockingTime: 0,
    };

    function selectorFor(element: Element): string {
      if (element.id) {
        return `#${CSS.escape(element.id)}`;
      }

      const className = Array.from(element.classList).slice(0, 3).map((item) => `.${CSS.escape(item)}`).join("");

      return `${element.tagName.toLowerCase()}${className}`;
    }

    function elementEvidence(element: Element, kind: "lcp" | "layout_shift", value?: number): PerformanceDomEvidence {
      const image = element as HTMLImageElement;
      const text = (element.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 120);

      return {
        kind,
        selector: selectorFor(element),
        tag: element.tagName.toLowerCase(),
        text: text || undefined,
        src: image.currentSrc || image.src || element.getAttribute("src") || undefined,
        value,
      };
    }

    try {
      new PerformanceObserver((entryList) => {
        for (const entry of entryList.getEntries()) {
          const metrics = window.__rocketMetrics;
          const layoutShift = entry as PerformanceEntry & {
            hadRecentInput?: boolean;
            value?: number;
          };

          if (metrics && !layoutShift.hadRecentInput) {
            metrics.cls += layoutShift.value ?? 0;

            const sources = (layoutShift as PerformanceEntry & {
              sources?: Array<{
                node?: Element;
              }>;
            }).sources ?? [];

            for (const source of sources) {
              if (source.node && metrics.layoutShiftElements.length < 10) {
                metrics.layoutShiftElements.push(elementEvidence(source.node, "layout_shift", layoutShift.value));
              }
            }
          }
        }
      }).observe({ type: "layout-shift", buffered: true });
    } catch {
      // Browser does not support the observer type.
    }

    try {
      new PerformanceObserver((entryList) => {
        const entries = entryList.getEntries();
        const last = entries.at(-1) as PerformanceEntry & {
          element?: Element;
          url?: string;
          size?: number;
        } | undefined;
        const metrics = window.__rocketMetrics;

        if (last && metrics) {
          metrics.lcp = last.startTime;

          if (last.element) {
            metrics.lcpElement = elementEvidence(last.element, "lcp", last.startTime);
          } else if (last.url) {
            metrics.lcpElement = {
              kind: "lcp",
              selector: "",
              tag: "resource",
              src: last.url,
              value: last.startTime,
            };
          }
        }
      }).observe({ type: "largest-contentful-paint", buffered: true });
    } catch {
      // Browser does not support the observer type.
    }

    try {
      new PerformanceObserver((entryList) => {
        for (const entry of entryList.getEntries()) {
          const metrics = window.__rocketMetrics;

          if (metrics) {
            metrics.longTaskBlockingTime += Math.max(0, entry.duration - 50);
          }
        }
      }).observe({ type: "longtask", buffered: true });
    } catch {
      // Browser does not support the observer type.
    }
  });
}

async function collectMetrics(page: import("puppeteer-core").Page): Promise<{
  cls: number;
  lcp: number;
  tbt: number;
  ttfb: number;
  domEvidence: PerformanceDomEvidence[];
}> {
  return page.evaluate(() => {
    const navigation = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    const paint = performance.getEntriesByName("first-contentful-paint")[0];
    const metrics = window.__rocketMetrics ?? {
      cls: 0,
      lcp: 0,
      layoutShiftElements: [],
      longTaskBlockingTime: 0,
    };

    return {
      cls: metrics.cls,
      lcp: metrics.lcp || paint?.startTime || navigation?.loadEventEnd || 0,
      tbt: metrics.longTaskBlockingTime,
      ttfb: navigation ? navigation.responseStart - navigation.requestStart : 0,
      domEvidence: [
        ...(metrics.lcpElement ? [metrics.lcpElement] : []),
        ...metrics.layoutShiftElements,
      ],
    };
  });
}

async function collectResources(
  page: import("puppeteer-core").Page,
  pageUrl: URL,
  handles: PerformanceHandleMetadata[],
): Promise<PerformanceResource[]> {
  const resources = await page.evaluate(() =>
    performance.getEntriesByType("resource").map((entry) => {
      const resource = entry as PerformanceResourceTiming & {
        renderBlockingStatus?: string;
      };

      return {
        url: resource.name,
        type: resource.initiatorType || "resource",
        duration: Math.round(resource.duration),
        transferSize: resource.transferSize ?? 0,
        renderBlockingStatus: resource.renderBlockingStatus,
      };
    }),
  );

  return resources
    .filter((resource) => resource.url.startsWith("http://") || resource.url.startsWith("https://"))
    .map((resource) => ({
      ...resource,
      source: attributionForResource(resource, pageUrl, handles),
    }))
    .sort((a, b) => b.duration - a.duration)
    .slice(0, 100);
}

async function collectLcpPreloadCandidates(
  page: import("puppeteer-core").Page,
  pageUrl: URL,
): Promise<PerformanceLcpPreloadCandidate[]> {
  const candidates = await page.evaluate(() => {
    function selectorFor(element: Element): string {
      if (element.id) {
        return `#${CSS.escape(element.id)}`;
      }

      const className = Array.from(element.classList).slice(0, 3).map((item) => `.${CSS.escape(item)}`).join("");

      return `${element.tagName.toLowerCase()}${className}`;
    }

    function imageFromElement(element: Element | undefined): HTMLImageElement | undefined {
      if (!element) {
        return undefined;
      }

      if (element instanceof HTMLImageElement) {
        return element;
      }

      return element.querySelector("img") ?? undefined;
    }

    function srcsetUrls(value: string | null | undefined): string[] {
      return (value ?? "")
        .split(",")
        .map((part) => part.trim().split(/\s+/)[0])
        .filter(Boolean);
    }

    function imageCandidate(image: HTMLImageElement, selector: string, priority: number) {
      const rect = image.getBoundingClientRect();
      const url = image.currentSrc || image.src || image.getAttribute("src") || "";

      if (!url || rect.width <= 0 || rect.height <= 0) {
        return undefined;
      }

      return {
        url,
        selector,
        tag: image.tagName.toLowerCase(),
        current_loading: image.loading || undefined,
        srcset: image.getAttribute("srcset") || undefined,
        sizes: image.getAttribute("sizes") || undefined,
        picture_sources: Array.from(image.closest("picture")?.querySelectorAll("source") ?? [])
          .map((source) => ({
            srcset: source.getAttribute("srcset") || "",
            media: source.getAttribute("media") || undefined,
            type: source.getAttribute("type") || undefined,
          }))
          .filter((source) => source.srcset),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        priority,
      };
    }

    const metrics = window.__rocketMetrics;
    const lcpImage = imageFromElement(metrics?.lcpElement?.selector
      ? document.querySelector(metrics.lcpElement.selector) ?? undefined
      : undefined);
    const lcpCandidate = lcpImage ? imageCandidate(lcpImage, metrics?.lcpElement?.selector ?? selectorFor(lcpImage), 0) : undefined;
    const viewportHeight = window.innerHeight;
    const aboveFoldCandidates = Array.from(document.images)
      .map((image, index) => imageCandidate(image, selectorFor(image), index + 1))
      .filter((candidate): candidate is NonNullable<typeof candidate> => {
        if (!candidate) {
          return false;
        }

        const image = document.querySelector(candidate.selector) as HTMLImageElement | null;
        const rect = image?.getBoundingClientRect();

        return Boolean(rect && rect.bottom > 0 && rect.top < viewportHeight);
      })
      .sort((a, b) => b.width * b.height - a.width * a.height)
      .slice(0, 3);
    const preloadHrefs = new Set(
      Array.from(document.querySelectorAll('link[rel~="preload"][as="image"]'))
        .map((link) => (link as HTMLLinkElement).href)
        .filter(Boolean),
    );
    const preloadCandidates = Array.from(document.querySelectorAll('link[rel~="preload"][as="image"]'))
      .flatMap((link) => {
        const preload = link as HTMLLinkElement;

        return [
          preload.href,
          ...srcsetUrls(preload.getAttribute("imagesrcset")),
        ].filter(Boolean);
      });

    return [...(lcpCandidate ? [lcpCandidate] : []), ...aboveFoldCandidates]
      .filter((candidate, index, items) => items.findIndex((item) => item.url === candidate.url) === index)
      .slice(0, 3)
      .map((candidate) => {
        const candidateUrls = [
          candidate.url,
          ...srcsetUrls(candidate.srcset),
          ...candidate.picture_sources.flatMap((source) => srcsetUrls(source.srcset)),
        ];
        const matchedPreload = preloadCandidates.find((preloadUrl) =>
          candidateUrls.some((candidateUrl) => urlsMatchForPreload(candidateUrl, preloadUrl)),
        );

        return {
          ...candidate,
          already_preloaded: preloadHrefs.has(candidate.url) || Boolean(matchedPreload),
          matched_preload: matchedPreload,
        };
      });

    function urlsMatchForPreload(left: string, right: string): boolean {
      try {
        const leftUrl = new URL(left, document.baseURI);
        const rightUrl = new URL(right, document.baseURI);

        if (leftUrl.href === rightUrl.href) {
          return true;
        }

        return leftUrl.pathname === rightUrl.pathname && leftUrl.search === rightUrl.search;
      } catch {
        return left === right;
      }
    }
  });

  return candidates
    .filter((candidate) => candidate.url.startsWith("http://") || candidate.url.startsWith("https://"))
    .map(({ priority: _priority, ...candidate }) => ({
      ...candidate,
      as: "image",
      fetchpriority: "high",
      source: attributionForUrl(candidate.url, pageUrl),
    }));
}

function buildIssues(
  metrics: PerformanceMetrics,
  resources: PerformanceResource[],
  pageUrl: URL,
  domEvidence: PerformanceDomEvidence[],
  lcpPreloadCandidates: PerformanceLcpPreloadCandidate[],
): PerformanceIssue[] {
  const issues: PerformanceIssue[] = [];
  const scripts = resources.filter((resource) => resource.type === "script");
  const styles = resources.filter((resource) => resource.type === "css" || resource.type === "link");
  const thirdParty = resources.filter((resource) => resource.source.kind === "third-party");

  if (metrics.time_to_first_byte.value > 800) {
    issues.push({
      id: "slow-ttfb",
      type: "slow_ttfb",
      severity: metrics.time_to_first_byte.value > 1800 ? "high" : "medium",
      metric: "ttfb",
      title: "Slow server response time",
      description: `The page waited ${metrics.time_to_first_byte.value}ms before receiving the first byte.`,
      recommendation: "Review hosting, page caching, database queries, uncached AJAX, and server-side plugin work before the HTML response.",
      evidence: [],
    });
  }

  if (metrics.largest_contentful_paint.value > 2500) {
    issues.push({
      id: "slow-lcp",
      type: "slow_lcp",
      severity: metrics.largest_contentful_paint.value > 4000 ? "high" : "medium",
      metric: "lcp",
      title: "Largest Contentful Paint is slow",
      description: `The measured LCP was ${metrics.largest_contentful_paint.value}ms.`,
      recommendation: "Prioritize the hero image or heading, preload the LCP image when known, reduce render-blocking CSS/JS, and avoid lazy-loading above-the-fold media.",
      evidence: topResources([...styles, ...scripts], 5),
      dom_evidence: domEvidence.filter((item) => item.kind === "lcp"),
    });
  }

  const preloadCandidate = lcpPreloadCandidates.find((candidate) => !candidate.already_preloaded);

  if (preloadCandidate && metrics.largest_contentful_paint.value > 1800) {
    issues.push({
      id: `lcp-preload-${issueIdForUrl(preloadCandidate.url)}`,
      type: "lcp_preload_candidate",
      severity: metrics.largest_contentful_paint.value > 2500 ? "high" : "medium",
      metric: "lcp",
      title: "LCP image can be prioritized",
      description: `${preloadCandidate.url} appears to be a hero or LCP image and is not preloaded.`,
      recommendation: "Preload this exact image and avoid lazy-loading it so the browser can request it earlier.",
      evidence: resources.filter((resource) => resource.url === preloadCandidate.url).slice(0, 1),
      dom_evidence: domEvidence.filter((item) => item.kind === "lcp"),
      preload_candidates: [preloadCandidate],
    });
  }

  if (metrics.total_blocking_time.value > 200) {
    issues.push({
      id: "high-tbt",
      type: "high_tbt",
      severity: metrics.total_blocking_time.value > 600 ? "high" : "medium",
      metric: "tbt",
      title: "JavaScript is blocking the main thread",
      description: `Estimated Total Blocking Time was ${metrics.total_blocking_time.value}ms.`,
      recommendation: "Delay non-critical JavaScript, remove unused plugin scripts from this page, split large bundles, and defer third-party tags until interaction when possible.",
      evidence: topResources(scripts, 8),
    });
  }

  if (metrics.cumulative_layout_shift.value > 0.1) {
    issues.push({
      id: "layout-shift",
      type: "layout_shift",
      severity: metrics.cumulative_layout_shift.value > 0.25 ? "high" : "medium",
      metric: "cls",
      title: "Layout shifts were detected",
      description: `Cumulative Layout Shift was ${metrics.cumulative_layout_shift.value}.`,
      recommendation: "Reserve width and height for images, embeds, ads, and late-loading banners; avoid injecting content above existing content after load.",
      evidence: [],
      dom_evidence: domEvidence.filter((item) => item.kind === "layout_shift"),
    });
  }

  for (const resource of topResources(resources.filter(isRenderBlocking), 5)) {
    issues.push({
      id: `render-blocking-${issueIdForResource(resource)}`,
      type: "render_blocking_resource",
      severity: "medium",
      metric: "network",
      title: "Render-blocking resource",
      description: `${resource.url} was reported as render-blocking by the browser.`,
      recommendation: resource.type === "script"
        ? "Defer or delay this script if it is not required for first paint."
        : "Load only critical CSS for first paint and defer the rest of this stylesheet.",
      evidence: [resource],
    });
  }

  for (const resource of topResources(scripts.filter((resource) => resource.transferSize > 100_000), 5)) {
    issues.push({
      id: `large-js-${issueIdForResource(resource)}`,
      type: "large_javascript",
      severity: resource.transferSize > 250_000 ? "high" : "medium",
      metric: "tbt",
      title: "Large JavaScript file",
      description: `${resource.url} transferred ${formatBytes(resource.transferSize)}.`,
      recommendation: "Unload this script on pages where it is unused, delay it, or replace the plugin/theme feature that enqueues it.",
      evidence: [resource],
    });
  }

  for (const resource of topResources(styles.filter((resource) => resource.transferSize > 75_000), 5)) {
    issues.push({
      id: `large-css-${issueIdForResource(resource)}`,
      type: "large_stylesheet",
      severity: resource.transferSize > 150_000 ? "high" : "medium",
      metric: "lcp",
      title: "Large stylesheet",
      description: `${resource.url} transferred ${formatBytes(resource.transferSize)}.`,
      recommendation: "Remove unused CSS from this source, split page-specific styles, or generate critical CSS and load the full stylesheet later.",
      evidence: [resource],
    });
  }

  const thirdPartyImpact = thirdParty.reduce((total, resource) => total + resource.duration, 0);

  if (thirdPartyImpact > 500) {
    issues.push({
      id: "third-party-impact",
      type: "third_party_impact",
      severity: thirdPartyImpact > 1500 ? "high" : "medium",
      metric: "network",
      title: "Third-party resources are expensive",
      description: `Third-party resources took about ${Math.round(thirdPartyImpact)}ms of combined load time.`,
      recommendation: "Delay analytics, ads, chat widgets, and social embeds until consent, interaction, or after the main content is visible.",
      evidence: topResources(thirdParty, 10).filter((resource) => new URL(resource.url).host !== pageUrl.host),
    });
  }

  return issues.slice(0, 25);
}

function buildSourceGroups(
  resources: PerformanceResource[],
  issues: PerformanceIssue[],
  inlineSources: PerformanceInlineSource[] = [],
): PerformanceSourceGroup[] {
  const groups = new Map<string, PerformanceSourceGroup>();

  for (const inlineSource of inlineSources) {
    const key = sourceKey(inlineSource.source);
    groups.set(key, groups.get(key) ?? {
      source: inlineSource.source,
      resources_count: 0,
      total_duration: 0,
      transfer_size: 0,
      issue_ids: [],
    });
  }

  for (const resource of resources) {
    const key = sourceKey(resource.source);
    const group = groups.get(key) ?? {
      source: resource.source,
      resources_count: 0,
      total_duration: 0,
      transfer_size: 0,
      issue_ids: [],
    };

    group.resources_count += 1;
    group.total_duration += resource.duration;
    group.transfer_size += resource.transferSize;
    groups.set(key, group);
  }

  for (const issue of issues) {
    for (const resource of issue.evidence) {
      const group = groups.get(sourceKey(resource.source));

      if (group && !group.issue_ids.includes(issue.id)) {
        group.issue_ids.push(issue.id);
      }
    }
  }

  return [...groups.values()]
    .map((group) => ({
      ...group,
      total_duration: Math.round(group.total_duration),
    }))
    .sort((a, b) => b.issue_ids.length - a.issue_ids.length || b.total_duration - a.total_duration);
}

function sourceKey(source: PerformanceSourceAttribution): string {
  return [source.kind, source.slug ?? "", source.host ?? "", source.handle ?? ""].join(":");
}

export function attributionForResource(
  resource: Pick<PerformanceResource, "url" | "type">,
  pageUrl: URL,
  handles: PerformanceHandleMetadata[],
): PerformanceSourceAttribution {
  const handle = handles.find((item) => metadataMatchesResource(item, resource));
  const fallback = attributionForUrl(resource.url, pageUrl);

  if (!handle) {
    return fallback;
  }

  return {
    ...fallback,
    kind: handle.source_kind ?? fallback.kind,
    slug: handle.source_slug ?? fallback.slug,
    handle: handle.handle,
  };
}

function metadataMatchesResource(
  metadata: PerformanceHandleMetadata,
  resource: Pick<PerformanceResource, "url" | "type">,
): boolean {
  if (metadata.type && metadata.type !== resource.type) {
    return false;
  }

  if (!metadata.url) {
    return false;
  }

  return normalizeResourceUrl(metadata.url) === normalizeResourceUrl(resource.url);
}

function inlineSourcesForHandles(
  handles: PerformanceHandleMetadata[],
  pageUrl: URL,
): PerformanceInlineSource[] {
  return handles
    .filter((handle) => handle.inline || !handle.url)
    .map((handle) => {
      const source = sourceForHandle(handle, pageUrl);

      return {
        source,
        type: handle.type,
        selector: handle.selector,
        id: handle.id,
      };
    });
}

function sourceForHandle(
  handle: PerformanceHandleMetadata,
  pageUrl: URL,
): PerformanceSourceAttribution {
  return {
    kind: handle.source_kind ?? "first-party",
    slug: handle.source_slug,
    host: pageUrl.host,
    handle: handle.handle,
  };
}

function normalizeResourceUrl(value: string): string {
  try {
    const url = new URL(value);
    url.hash = "";

    return url.toString();
  } catch {
    return value;
  }
}

export function attributionForUrl(value: string, pageUrl: URL): PerformanceSourceAttribution {
  const url = new URL(value);
  const pathParts = url.pathname.split("/").filter(Boolean);
  const wpContentIndex = pathParts.indexOf("wp-content");

  if (url.host !== pageUrl.host) {
    return { kind: "third-party", host: url.host };
  }

  if (wpContentIndex >= 0) {
    const section = pathParts[wpContentIndex + 1];
    const slug = pathParts[wpContentIndex + 2];

    if (section === "plugins" && slug) {
      return { kind: "plugin", slug, host: url.host };
    }

    if (section === "themes" && slug) {
      return { kind: "theme", slug, host: url.host };
    }

    if (section === "uploads") {
      return { kind: "uploads", host: url.host };
    }
  }

  if (pathParts[0] === "wp-includes" || pathParts[0] === "wp-admin") {
    return { kind: "wordpress-core", host: url.host };
  }

  return { kind: "first-party", host: url.host };
}

function topResources(resources: PerformanceResource[], limit: number): PerformanceResource[] {
  return [...resources]
    .sort((a, b) => b.duration + b.transferSize / 1000 - (a.duration + a.transferSize / 1000))
    .slice(0, limit);
}

function isRenderBlocking(resource: PerformanceResource): boolean {
  return resource.renderBlockingStatus === "blocking";
}

function issueIdForResource(resource: PerformanceResource): string {
  return issueIdForUrl(resource.url);
}

function issueIdForUrl(url: string): string {
  return Buffer.from(url).toString("base64url").slice(0, 16);
}

function formatBytes(bytes: number): string {
  if (bytes >= 1_000_000) {
    return `${(bytes / 1_000_000).toFixed(1)} MB`;
  }

  return `${Math.round(bytes / 1000)} KB`;
}

function scoreMetrics(metrics: { cls: number; lcp: number; tbt: number; ttfb: number }): number {
  const penalties = [
    penalty(metrics.lcp, 2500, 4000, 35),
    penalty(metrics.tbt, 200, 600, 30),
    penalty(metrics.cls, 0.1, 0.25, 20),
    penalty(metrics.ttfb, 800, 1800, 15),
  ];

  return Math.max(0, Math.min(100, Math.round(100 - penalties.reduce((total, value) => total + value, 0))));
}

function penalty(value: number, good: number, poor: number, weight: number): number {
  if (value <= good) {
    return 0;
  }

  if (value >= poor) {
    return weight;
  }

  return ((value - good) / (poor - good)) * weight;
}

function normalizeHttpUrl(value: string): URL {
  const url = new URL(value);

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only HTTP and HTTPS URLs can be used for performance audits");
  }

  return url;
}

function chromiumExecutablePath(): string {
  return env.PERFORMANCE_CHROMIUM_EXECUTABLE ?? env.CPCSS_CHROMIUM_EXECUTABLE ?? "/usr/bin/chromium";
}

async function assertFetchAllowed(url: URL): Promise<void> {
  if (env.PERFORMANCE_ALLOW_PRIVATE_NETWORKS) {
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

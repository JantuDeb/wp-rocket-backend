import type { PerformanceIssue, PerformanceMetrics, PerformanceReport, PerformanceResource } from "../../contracts/performance.js";
import type { Recommendation } from "../../contracts/recommendations.js";

type RecommendationsInput = {
  lcp?: number;
  ttfb?: number;
  cls?: number;
  tbt?: number;
  globalScore?: number;
  enabledOptions?: string[];
  limit?: number;
  units?: "seconds" | "milliseconds" | "auto";
};

type RecommendationSeed = Omit<Recommendation, "priority"> & {
  priority: number;
};

export function recommendationsForInput(input: RecommendationsInput = {}): Recommendation[] {
  const recommendations: RecommendationSeed[] = [];
  const metrics = normalizeMetricInput(input);

  if (metrics.tbt > 200 && !input.enabledOptions?.includes("delay_js")) {
    recommendations.push(delayJsRecommendation({
      priority: metrics.tbt > 600 ? 100 : 80,
      description: "Total Blocking Time is elevated. Delay non-critical JavaScript to reduce main-thread work during page load.",
      tbtImpact: "high",
    }));
  }

  if (metrics.lcp > 2500) {
    recommendations.push(removeUnusedCssRecommendation({
      priority: metrics.lcp > 4000 ? 90 : 70,
      description: "Largest Contentful Paint is slow. Remove unused CSS and reduce render-blocking styles before the hero content paints.",
      lcpImpact: "high",
    }));
  }

  if (metrics.cls > 0.1) {
    recommendations.push(layoutShiftRecommendation({
      priority: metrics.cls > 0.25 ? 85 : 65,
      description: "Layout shifts were detected. Reserve space for images, embeds, ads, and late-loading banners.",
    }));
  }

  if (metrics.ttfb > 800) {
    recommendations.push(cacheRecommendation({
      priority: metrics.ttfb > 1800 ? 95 : 75,
      description: "Server response time is slow. Check page caching, hosting, database queries, and server-side plugin work.",
    }));
  }

  if (recommendations.length === 0) {
    recommendations.push(delayJsRecommendation({
      priority: 10,
      description: "Delay non-critical JavaScript to improve Total Blocking Time.",
      tbtImpact: "high",
      lcpImpact: "medium",
    }));
  }

  return sortedLimited(recommendations, input.limit);
}

export function recommendationsForReport(report: PerformanceReport, limit?: number): Recommendation[] {
  const recommendations = report.issues.flatMap((issue) => recommendationsForIssue(issue, report.metrics));

  if (recommendations.length === 0) {
    return recommendationsForInput({
      lcp: report.metrics.largest_contentful_paint.value,
      tbt: report.metrics.total_blocking_time.value,
      cls: report.metrics.cumulative_layout_shift.value,
      ttfb: report.metrics.time_to_first_byte.value,
      globalScore: report.metrics.performance_score,
      limit,
      units: "milliseconds",
    });
  }

  return sortedLimited(dedupeRecommendations(recommendations), limit);
}

function recommendationsForIssue(issue: PerformanceIssue, metrics: PerformanceMetrics): RecommendationSeed[] {
  const evidence = issue.evidence[0];
  const source = evidence?.source;
  const sourceName = source?.slug ?? source?.host;

  switch (issue.type) {
    case "high_tbt":
    case "large_javascript":
      return [
        delayJsRecommendation({
          priority: issue.severity === "high" ? 100 : 80,
          description: sourceName
            ? `${sourceLabel(evidence)} is contributing JavaScript work. Delay it, unload it on pages where it is unused, or replace the feature that enqueues it.`
            : issue.recommendation,
          tbtImpact: "high",
          issue,
          evidence,
        }),
      ];

    case "render_blocking_resource":
      return [
        evidence?.type === "script"
          ? delayJsRecommendation({
              priority: 75,
              description: `${sourceLabel(evidence)} is render-blocking. Defer or delay it unless it is required for initial rendering.`,
              tbtImpact: "medium",
              lcpImpact: "medium",
              issue,
              evidence,
            })
          : removeUnusedCssRecommendation({
              priority: 75,
              description: `${sourceLabel(evidence)} is render-blocking. Generate critical CSS and defer non-critical stylesheet rules.`,
              lcpImpact: "high",
              issue,
              evidence,
            }),
      ];

    case "large_stylesheet":
    case "slow_lcp":
      return [
        removeUnusedCssRecommendation({
          priority: issue.severity === "high" ? 90 : 70,
          description: evidence
            ? `${sourceLabel(evidence)} is affecting first render. Remove unused CSS, split page-specific styles, or defer non-critical CSS.`
            : issue.recommendation,
          lcpImpact: "high",
          issue,
          evidence,
        }),
      ];

    case "layout_shift":
      return [
        layoutShiftRecommendation({
          priority: issue.severity === "high" ? 85 : 65,
          description: issue.recommendation,
          issue,
          evidence,
        }),
      ];

    case "slow_ttfb":
      return [
        cacheRecommendation({
          priority: metrics.time_to_first_byte.value > 1800 ? 95 : 75,
          description: issue.recommendation,
          issue,
          evidence,
        }),
      ];

    case "third_party_impact":
      return [
        delayJsRecommendation({
          priority: issue.severity === "high" ? 90 : 70,
          description: "Third-party scripts are expensive. Delay analytics, ads, chat widgets, and social embeds until consent, interaction, or after main content is visible.",
          tbtImpact: "high",
          lcpImpact: "medium",
          issue,
          evidence,
        }),
      ];
  }
}

function delayJsRecommendation(input: {
  priority: number;
  description: string;
  tbtImpact?: string;
  lcpImpact?: string;
  issue?: PerformanceIssue;
  evidence?: PerformanceResource;
}): RecommendationSeed {
  return withEvidence({
    option_slug: "delay_js",
    priority: input.priority,
    title: "Delay JavaScript causing main-thread work",
    description: input.description,
    learn_more_url: "https://docs.wp-rocket.me/article/1349-delay-javascript-execution",
    icon_slug: "delay_js",
    lcp_impact: input.lcpImpact ?? null,
    ttfb_impact: null,
    cls_impact: null,
    tbt_impact: input.tbtImpact ?? "medium",
    fix_steps: [
      "Enable Delay JavaScript Execution.",
      "Exclude only scripts needed for first paint or above-the-fold interaction.",
      "Unload plugin scripts on page types where the plugin feature is unused.",
    ],
  }, input.issue, input.evidence);
}

function removeUnusedCssRecommendation(input: {
  priority: number;
  description: string;
  lcpImpact?: string;
  issue?: PerformanceIssue;
  evidence?: PerformanceResource;
}): RecommendationSeed {
  return withEvidence({
    option_slug: "remove_unused_css",
    priority: input.priority,
    title: "Reduce render-blocking and unused CSS",
    description: input.description,
    learn_more_url: "https://docs.wp-rocket.me/article/1529-remove-unused-css",
    icon_slug: "remove_unused_css",
    lcp_impact: input.lcpImpact ?? "medium",
    ttfb_impact: null,
    cls_impact: null,
    tbt_impact: null,
    fix_steps: [
      "Enable Remove Unused CSS or Critical CSS generation.",
      "Review theme and plugin stylesheets that load globally.",
      "Move page-specific styles to the templates that actually need them.",
    ],
  }, input.issue, input.evidence);
}

function layoutShiftRecommendation(input: {
  priority: number;
  description: string;
  issue?: PerformanceIssue;
  evidence?: PerformanceResource;
}): RecommendationSeed {
  return withEvidence({
    option_slug: "optimize_media_dimensions",
    priority: input.priority,
    title: "Reserve space for shifting content",
    description: input.description,
    learn_more_url: "https://web.dev/articles/optimize-cls",
    icon_slug: "layout_shift",
    lcp_impact: null,
    ttfb_impact: null,
    cls_impact: "high",
    tbt_impact: null,
    fix_steps: [
      "Add explicit width and height to images and embeds.",
      "Reserve fixed space for ads, banners, notices, and injected widgets.",
      "Avoid inserting content above existing content after page load.",
    ],
  }, input.issue, input.evidence);
}

function cacheRecommendation(input: {
  priority: number;
  description: string;
  issue?: PerformanceIssue;
  evidence?: PerformanceResource;
}): RecommendationSeed {
  return withEvidence({
    option_slug: "page_cache",
    priority: input.priority,
    title: "Improve server response time",
    description: input.description,
    learn_more_url: "https://docs.wp-rocket.me/article/78-the-cache-tab",
    icon_slug: "cache",
    lcp_impact: "medium",
    ttfb_impact: "high",
    cls_impact: null,
    tbt_impact: null,
    fix_steps: [
      "Confirm page caching is enabled and the tested URL is cacheable.",
      "Check slow database queries and server-side plugin hooks.",
      "Review hosting CPU, object cache, and uncached personalized fragments.",
    ],
  }, input.issue, input.evidence);
}

function withEvidence(
  recommendation: RecommendationSeed,
  issue?: PerformanceIssue,
  evidence?: PerformanceResource,
): RecommendationSeed {
  if (issue) {
    recommendation.issue_id = issue.id;
  }

  if (evidence) {
    recommendation.source_kind = evidence.source.kind;
    recommendation.source_slug = evidence.source.slug ?? evidence.source.host;
    recommendation.source_url = evidence.url;
  }

  return recommendation;
}

function normalizeMetricInput(input: RecommendationsInput): {
  lcp: number;
  ttfb: number;
  cls: number;
  tbt: number;
  globalScore: number;
} {
  return {
    lcp: secondsOrMilliseconds(input.lcp, input.units ?? "auto"),
    ttfb: secondsOrMilliseconds(input.ttfb, input.units ?? "auto"),
    cls: toNumber(input.cls),
    tbt: toNumber(input.tbt),
    globalScore: toNumber(input.globalScore),
  };
}

function secondsOrMilliseconds(value: unknown, units: "seconds" | "milliseconds" | "auto"): number {
  const number = toNumber(value);

  if (units === "seconds") {
    return number * 1000;
  }

  if (units === "milliseconds") {
    return number;
  }

  return number > 0 && number < 100 ? number * 1000 : number;
}

function toNumber(value: unknown): number {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }

  if (typeof value === "string") {
    const parsed = Number(value);

    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}

function sourceLabel(resource: PerformanceResource | undefined): string {
  if (!resource) {
    return "A resource";
  }

  if (resource.source.kind === "plugin" && resource.source.slug) {
    return `Plugin "${resource.source.slug}"`;
  }

  if (resource.source.kind === "theme" && resource.source.slug) {
    return `Theme "${resource.source.slug}"`;
  }

  if (resource.source.kind === "third-party" && resource.source.host) {
    return `Third-party host "${resource.source.host}"`;
  }

  return resource.url;
}

function dedupeRecommendations(recommendations: RecommendationSeed[]): RecommendationSeed[] {
  const seen = new Set<string>();

  return recommendations.filter((recommendation) => {
    const key = [
      recommendation.option_slug,
      recommendation.issue_id,
      recommendation.source_slug,
      recommendation.source_url,
    ].filter(Boolean).join("|");

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function sortedLimited(recommendations: RecommendationSeed[], limit = 20): Recommendation[] {
  return recommendations
    .sort((a, b) => b.priority - a.priority)
    .slice(0, Math.max(1, limit));
}

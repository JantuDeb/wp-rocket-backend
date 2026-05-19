import type { Recommendation } from "../../contracts/recommendations.js";

export function recommendationsForInput(): Recommendation[] {
  return [
    {
      option_slug: "delay_js",
      priority: 10,
      title: "Enable Delay JavaScript Execution",
      description: "Delay non-critical JavaScript to improve Total Blocking Time.",
      learn_more_url: "https://docs.wp-rocket.me/article/1349-delay-javascript-execution",
      icon_slug: "delay_js",
      lcp_impact: "medium",
      ttfb_impact: null,
      cls_impact: null,
      tbt_impact: "high",
    },
  ];
}

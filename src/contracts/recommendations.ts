export type Recommendation = {
  option_slug: string;
  priority: number;
  title: string;
  description: string;
  learn_more_url: string;
  icon_slug: string;
  lcp_impact: string | null;
  ttfb_impact: string | null;
  cls_impact: string | null;
  tbt_impact: string | null;
};

export type PerformanceStatus = "pending" | "completed" | "failed";

export type PerformanceMetrics = {
  report_url: string;
  performance_score: number;
  largest_contentful_paint: { value: number };
  total_blocking_time: { value: number };
  cumulative_layout_shift: { value: number };
  time_to_first_byte: { value: number };
};

export type PerformanceSourceAttribution = {
  kind: "plugin" | "theme" | "wordpress-core" | "uploads" | "first-party" | "third-party" | "unknown";
  slug?: string;
  host?: string;
  handle?: string;
};

export type PerformanceHandleMetadata = {
  url?: string;
  handle: string;
  type?: string;
  source_kind?: PerformanceSourceAttribution["kind"];
  source_slug?: string;
};

export type PerformanceResource = {
  url: string;
  type: string;
  duration: number;
  transferSize: number;
  renderBlockingStatus?: string;
  source: PerformanceSourceAttribution;
};

export type PerformanceDomEvidence = {
  kind: "lcp" | "layout_shift";
  selector: string;
  tag: string;
  text?: string;
  src?: string;
  value?: number;
};

export type PerformanceLcpPreloadCandidate = {
  url: string;
  selector: string;
  tag: string;
  as: "image";
  fetchpriority: "high";
  source: PerformanceSourceAttribution;
  already_preloaded: boolean;
  current_loading?: string;
  width?: number;
  height?: number;
};

export type PerformanceIssue = {
  id: string;
  type:
    | "slow_ttfb"
    | "slow_lcp"
    | "lcp_preload_candidate"
    | "high_tbt"
    | "layout_shift"
    | "render_blocking_resource"
    | "large_javascript"
    | "large_stylesheet"
    | "third_party_impact";
  severity: "low" | "medium" | "high";
  metric: "ttfb" | "lcp" | "tbt" | "cls" | "network";
  title: string;
  description: string;
  recommendation: string;
  evidence: PerformanceResource[];
  dom_evidence?: PerformanceDomEvidence[];
  preload_candidates?: PerformanceLcpPreloadCandidate[];
};

export type PerformanceSourceGroup = {
  source: PerformanceSourceAttribution;
  resources_count: number;
  total_duration: number;
  transfer_size: number;
  issue_ids: string[];
};

export type PerformanceReport = {
  uuid: string;
  url: string;
  generated_at: string;
  metrics: PerformanceMetrics;
  issues: PerformanceIssue[];
  resources: PerformanceResource[];
  dom_evidence: PerformanceDomEvidence[];
  lcp_preload_candidates: PerformanceLcpPreloadCandidate[];
  source_groups: PerformanceSourceGroup[];
};

export type PerformanceJobResult = {
  uuid: string;
  status: "completed" | "failed";
  message?: string;
  data: {
    data: PerformanceMetrics;
  };
  report?: PerformanceReport;
};

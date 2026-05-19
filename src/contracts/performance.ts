export type PerformanceStatus = "pending" | "completed" | "failed";

export type PerformanceMetrics = {
  report_url: string;
  performance_score: number;
  largest_contentful_paint: { value: number };
  total_blocking_time: { value: number };
  cumulative_layout_shift: { value: number };
  time_to_first_byte: { value: number };
};

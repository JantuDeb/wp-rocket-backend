import type { PerformanceMetrics } from "../../contracts/performance.js";

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

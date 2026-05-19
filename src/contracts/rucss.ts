export type RucssQueueName = "rucss" | "performance_hints";

export type AboveTheFoldResult = {
  lcp: unknown[];
  images_above_fold: unknown[];
};

export type RucssReturnValue = {
  code: number;
  status: "completed" | "pending" | "failed";
  message: string;
  contents: {
    success: boolean;
    shakedCSS: string;
    shakedCSS_size: number;
    above_the_fold_result: AboveTheFoldResult;
  };
};

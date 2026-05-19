export type CpcssState = "pending" | "complete" | "failed";

export type CpcssStatusResponse = {
  status: number;
  message?: string;
  data: {
    state: CpcssState;
    critical_path?: string;
  };
};

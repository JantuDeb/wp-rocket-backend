import { env } from "./env.js";

export const logger =
  env.NODE_ENV === "test"
    ? false
    : {
        level: env.NODE_ENV === "development" ? "debug" : "info",
      };

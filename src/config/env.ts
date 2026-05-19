import { z } from "zod";

const envSchema = z.object({
  HOST: z.string().default("0.0.0.0"),
  PORT: z.coerce.number().int().positive().default(8080),
  NODE_ENV: z.string().default("development"),
  JOB_COMPLETE_AFTER_MS: z.coerce.number().int().nonnegative().default(1000),
  CPCSS_TIMEOUT_MS: z.coerce.number().int().positive().default(30000),
  CPCSS_FETCH_TIMEOUT_MS: z.coerce.number().int().positive().default(10000),
  CPCSS_MAX_CSS_BYTES: z.coerce.number().int().positive().default(2_000_000),
  CPCSS_DESKTOP_WIDTH: z.coerce.number().int().positive().default(1300),
  CPCSS_DESKTOP_HEIGHT: z.coerce.number().int().positive().default(900),
  CPCSS_MOBILE_WIDTH: z.coerce.number().int().positive().default(390),
  CPCSS_MOBILE_HEIGHT: z.coerce.number().int().positive().default(844),
  CPCSS_ALLOW_PRIVATE_NETWORKS: z.coerce.boolean().default(false),
  CPCSS_CHROMIUM_EXECUTABLE: z.string().optional(),
});

export const env = envSchema.parse(process.env);

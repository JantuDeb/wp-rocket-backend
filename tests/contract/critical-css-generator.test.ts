import { describe, expect, it } from "vitest";
import { generateCriticalCss } from "../../src/services/css/critical-css.js";

describe("Critical CSS generator", () => {
  it("keeps deterministic test CSS for contract tests", async () => {
    process.env.NODE_ENV = "test";

    await expect(
      generateCriticalCss({
        url: "https://example.com",
      }),
    ).resolves.toContain(":where(.hero)");
  });
});

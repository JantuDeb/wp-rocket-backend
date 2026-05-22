import { describe, expect, it } from "vitest";
import { auditPerformance, attributionForResource, fakePerformanceReport, preloadUrlsMatch } from "../../src/services/lighthouse/audit.js";

describe("Performance resource attribution", () => {
  it("uses WordPress handle metadata when resource URLs match", () => {
    const source = attributionForResource(
      {
        url: "https://example.com/wp-content/plugins/shop/assets/cart.js?ver=1.2.3",
        type: "script",
      },
      new URL("https://example.com/product/"),
      [
        {
          url: "https://example.com/wp-content/plugins/shop/assets/cart.js?ver=1.2.3",
          handle: "shop-cart",
          type: "script",
          source_kind: "plugin",
          source_slug: "shop",
        },
      ],
    );

    expect(source).toEqual({
      kind: "plugin",
      slug: "shop",
      host: "example.com",
      handle: "shop-cart",
    });
  });

  it("falls back to URL attribution when handle metadata does not match", () => {
    const source = attributionForResource(
      {
        url: "https://example.com/wp-content/themes/storefront/style.css",
        type: "css",
      },
      new URL("https://example.com/"),
      [
        {
          url: "https://example.com/wp-content/plugins/shop/assets/cart.js",
          handle: "shop-cart",
          type: "script",
        },
      ],
    );

    expect(source).toEqual({
      kind: "theme",
      slug: "storefront",
      host: "example.com",
    });
  });

  it("preserves inline WordPress handles as source groups", async () => {
    const report = await auditPerformance({
      url: "https://example.com/",
      jobId: "perf_inline",
      handles: [
        {
          handle: "theme-inline-critical",
          type: "style",
          source_kind: "theme",
          source_slug: "storefront",
          inline: true,
          id: "storefront-inline-css",
        },
      ],
    });

    expect(report.inline_sources).toEqual([
      {
        source: {
          kind: "theme",
          slug: "storefront",
          host: "example.com",
          handle: "theme-inline-critical",
        },
        type: "style",
        id: "storefront-inline-css",
      },
    ]);
    expect(report.source_groups).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: expect.objectContaining({
            handle: "theme-inline-critical",
          }),
          resources_count: 0,
        }),
      ]),
    );
  });

  it("includes report observability fields", () => {
    const report = fakePerformanceReport("perf_observe");

    expect(report.observability).toMatchObject({
      audit_duration_ms: expect.any(Number),
      resource_count: expect.any(Number),
      issue_count: expect.any(Number),
    });
  });

  it("matches responsive preload candidates across CDN host rewrites", () => {
    expect(preloadUrlsMatch(
      "https://cdn.example.com/wp-content/uploads/hero-1200.jpg?fit=1200",
      "https://example.com/wp-content/uploads/hero-1200.jpg?fit=1200",
    )).toBe(true);
    expect(preloadUrlsMatch(
      "/wp-content/uploads/hero-800.jpg",
      "https://example.com/wp-content/uploads/hero-800.jpg",
    )).toBe(true);
  });
});

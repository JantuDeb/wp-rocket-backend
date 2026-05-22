import { describe, expect, it } from "vitest";
import { buildUsedCss, type CssCoverageEntry } from "../../src/services/css/used-css.js";

describe("RUCSS production CSS corpus", () => {
  it("keeps block theme layers, container queries, dynamic WooCommerce classes, and registered properties", () => {
    const css = [
      "@layer reset,theme,plugins;",
      "@property --progress{syntax:'<number>';initial-value:0;inherits:false}",
      "@layer theme{.wp-site-blocks{min-height:100vh}.wp-block-button__link{color:white}.unused-block{display:none}}",
      "@container card (min-width: 420px){.product-card.is-visible{display:grid}.product-card.is-hidden{display:none}}",
      ".woocommerce div.product .price{font-weight:700}.woocommerce div.product .legacy{opacity:.5}",
      ".elementor-element-abc123 .elementor-widget-container{padding:20px}",
      ".swiper-slide-active{opacity:1}.swiper-slide-duplicate-active{opacity:1}.swiper-slide-unused{opacity:.2}",
    ].join("");
    const coverage: CssCoverageEntry[] = [
      {
        text: css,
        ranges: [
          rangeFor(css, "min-height:100vh"),
          rangeFor(css, "display:grid"),
          rangeFor(css, "font-weight:700"),
        ],
      },
    ];

    const result = buildUsedCss(coverage, [
      ".elementor-element-*",
      ".swiper-slide-*-active",
    ]);

    expect(result).toContain("@property --progress{syntax:'<number>';initial-value:0;inherits:false}");
    expect(result).toContain("@layer theme{.wp-site-blocks{min-height:100vh}}");
    expect(result).toContain("@container card (min-width: 420px){.product-card.is-visible{display:grid}}");
    expect(result).toContain(".woocommerce div.product .price{font-weight:700}");
    expect(result).toContain(".elementor-element-abc123 .elementor-widget-container{padding:20px}");
    expect(result).toContain(".swiper-slide-duplicate-active{opacity:1}");
    expect(result).not.toContain(".unused-block");
    expect(result).not.toContain(".product-card.is-hidden");
    expect(result).not.toContain(".legacy");
    expect(result).not.toContain(".swiper-slide-unused");
  });

  it("keeps multiple animation keyframes from slider and popup styles", () => {
    const css = [
      "@keyframes fadeIn{from{opacity:0}to{opacity:1}}",
      "@keyframes zoomIn{from{transform:scale(.9)}to{transform:scale(1)}}",
      "@keyframes unusedSpin{to{transform:rotate(1turn)}}",
      ".modal.is-open{animation:160ms ease-out fadeIn, 220ms cubic-bezier(.2,.8,.2,1) zoomIn}",
      ".modal.is-closed{animation:unusedSpin 1s linear}",
    ].join("");
    const coverage: CssCoverageEntry[] = [
      {
        text: css,
        ranges: [rangeFor(css, "animation:160ms")],
      },
    ];
    const result = buildUsedCss(coverage, []);

    expect(result).toContain("@keyframes fadeIn");
    expect(result).toContain("@keyframes zoomIn");
    expect(result).not.toContain("@keyframes unusedSpin");
    expect(result).not.toContain(".modal.is-closed");
  });
});

function rangeFor(css: string, needle: string): { start: number; end: number } {
  const start = css.indexOf(needle);

  if (start === -1) {
    throw new Error(`Unable to find CSS test needle: ${needle}`);
  }

  return {
    start,
    end: start + needle.length,
  };
}

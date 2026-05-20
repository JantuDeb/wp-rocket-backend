import { describe, expect, it } from "vitest";
import { buildUsedCss, type CssCoverageEntry } from "../../src/services/css/used-css.js";

describe("Used CSS extractor", () => {
  it("keeps complete used rules inside nested at-rules", () => {
    const css = [
      ":root{--brand:red}",
      ".unused{color:blue}",
      "@media (min-width: 700px){.used{color:red}.unused-media{color:blue}}",
      "@supports (display:grid){@layer components{.safe-card{display:grid}.unused-layer{display:block}}}",
      "@font-face{font-family:Rocket;src:url(rocket.woff2)}",
      "@keyframes fade{from{opacity:0}to{opacity:1}}",
      "@keyframes spin{to{transform:rotate(1turn)}}",
      ".animated{animation:fade 1s ease}",
      ".not-animated{animation:spin 1s ease}",
    ].join("");
    const coverage: CssCoverageEntry[] = [
      {
        text: css,
        ranges: [
          rangeFor(css, "color:red"),
          rangeFor(css, "animation:fade"),
        ],
      },
    ];

    const result = buildUsedCss(coverage, [".safe-card"]);

    expect(result).toContain(":root{--brand:red}");
    expect(result).toContain("@media (min-width: 700px){.used{color:red}}");
    expect(result).toContain("@supports (display:grid){@layer components{.safe-card{display:grid}}}");
    expect(result).toContain("@font-face{font-family:Rocket;src:url(rocket.woff2)}");
    expect(result).toContain("@keyframes fade{from{opacity:0}to{opacity:1}}");
    expect(result).toContain(".animated{animation:fade 1s ease}");
    expect(result).not.toContain(".unused{color:blue}");
    expect(result).not.toContain(".unused-media");
    expect(result).not.toContain(".unused-layer");
    expect(result).not.toContain("@keyframes spin");
    expect(result).not.toContain(".not-animated");
  });

  it("accepts regex-style safelist entries", () => {
    const css = ".keep-me{color:red}.drop-me{color:blue}";
    const result = buildUsedCss([{ text: css, ranges: [] }], ["/keep-.*/"]);

    expect(result).toContain(".keep-me{color:red}");
    expect(result).not.toContain(".drop-me");
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

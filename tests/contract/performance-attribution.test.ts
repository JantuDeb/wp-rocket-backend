import { describe, expect, it } from "vitest";
import { attributionForResource } from "../../src/services/lighthouse/audit.js";

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
});


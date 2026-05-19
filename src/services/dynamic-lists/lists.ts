import { createHash } from "node:crypto";
import defaultLists from "../../fixtures/dynamic-lists.json" with { type: "json" };
import delayJsLists from "../../fixtures/dynamic-lists-delayjs.json" with { type: "json" };
import incompatiblePluginsLists from "../../fixtures/dynamic-lists-incompatible-plugins.json" with { type: "json" };
import type { DynamicListName } from "../../contracts/dynamic-lists.js";

const lists = {
  default: defaultLists,
  "delay-js": delayJsLists,
  "incompatible-plugins": incompatiblePluginsLists,
} satisfies Record<DynamicListName, unknown>;

export function getDynamicList(name: DynamicListName): unknown {
  return lists[name];
}

export function getDynamicListHash(name: DynamicListName): string {
  return createHash("md5").update(JSON.stringify(lists[name])).digest("hex");
}

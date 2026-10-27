import { describe, expect, it } from "vitest";

import en from "../../i18n/en.json";
import la from "../../i18n/la.json";

function leafKeys(node: unknown, prefix = ""): string[] {
  if (node === null || typeof node !== "object") return [prefix];
  return Object.entries(node as Record<string, unknown>).flatMap(([key, value]) =>
    leafKeys(value, prefix ? `${prefix}.${key}` : key)
  );
}

describe("i18n message files", () => {
  it("en.json and la.json have exactly the same keys (every key must exist in BOTH)", () => {
    const enKeys = new Set(leafKeys(en));
    const laKeys = new Set(leafKeys(la));
    expect([...enKeys].filter((k) => !laKeys.has(k))).toEqual([]);
    expect([...laKeys].filter((k) => !enKeys.has(k))).toEqual([]);
  });

  it("no string is left empty and nothing is marked as still to translate", () => {
    for (const [name, messages] of [["en", en], ["la", la]] as const) {
      const text = JSON.stringify(messages);
      expect(text, name).not.toContain("_todoTranslate");
      const empty = leafKeys(messages).filter((k) => k.split(".").reduce<unknown>((n, p) => (n as Record<string, unknown>)[p], messages) === "");
      expect(empty, name).toEqual([]);
    }
  });
});

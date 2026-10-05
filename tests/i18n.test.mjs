import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { errorNotice, requestLocale } from "../bin/i18n.mjs";

const i18n = JSON.parse(readFileSync(new URL("../plugin.json", import.meta.url), "utf8")).extensions.openagent.i18n;

test("Chat Groups translations cover all metadata and notices", () => {
  expect(i18n.supported_locales).toEqual(["en", "zh"]);
  const baseline = Object.keys(i18n.translations.en).sort();
  const placeholders = (text) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
  for (const locale of i18n.supported_locales) {
    expect(Object.keys(i18n.translations[locale]).sort()).toEqual(baseline);
    for (const key of baseline) {
      expect(i18n.translations[locale][key].trim()).not.toBe("");
      expect(placeholders(i18n.translations[locale][key])).toEqual(placeholders(i18n.translations.en[key]));
    }
  }
});

test("Chat Groups formats errors in the live host locale", async () => {
  const host = { locale: { get: async () => "zh-CN" } };
  expect(await requestLocale({}, host)).toBe("zh");
  expect(await requestLocale({ _openagent: { locale: "en" } }, host)).toBe("en");
  expect(errorNotice(new Error("Unknown role 'planner'"), "zh")).toBe("未知角色“planner”");
});

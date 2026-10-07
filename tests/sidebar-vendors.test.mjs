import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
test("the installable sidebar embeds the verified vendor sources without external fetches", () => {
  const check = spawnSync(process.execPath, ["scripts/embed-sidebar-vendors.mjs", "--check"], {
    cwd: root,
  });
  expect(check.status).toBe(0);
  const html = readFileSync(resolve(root, "ui/groups.html"), "utf8");
  const globals = {};
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1]);
  expect(scripts.length).toBe(3);
  runInNewContext(scripts[0], globals);
  expect(
    globals.marked.parse(
      "## Title\n\n**Bold**\n\n- One\n- Two\n\n| A | B |\n| - | - |\n| 1 | 2 |\n",
    ),
  ).toContain("<table>");
  expect(globals.marked.parse("```js\nconst x = 1;\n```")).toContain("<pre><code");
  expect(html).not.toMatch(/<script[^>]+src=/i);
});

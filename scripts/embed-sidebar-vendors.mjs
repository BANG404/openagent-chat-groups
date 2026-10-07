import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const vendors = JSON.parse(readFileSync(resolve(root, "ui/vendor/sources.json"), "utf8"));
const scripts = vendors
  .map(({ file, sha256 }) => {
    const bytes = readFileSync(resolve(root, "ui/vendor", file));
    if (createHash("sha256").update(bytes).digest("hex") !== sha256)
      throw new Error(`Unexpected vendor bytes: ${file}`);
    const source = bytes
      .toString("utf8")
      .replace(/\r\n/g, "\n")
      .replace(/^\/\/# sourceMappingURL=.*$/gm, "")
      .replace(/<\/script/gi, "<\\/script");
    return `    <!-- prettier-ignore -->\n    <script>\n${source.trim()}\n    </script>`;
  })
  .join("\n");
const entry = resolve(root, "ui/groups.html");
const current = readFileSync(entry, "utf8").replace(/\r\n/g, "\n");
const pattern = /<!-- sidebar-vendors:start -->[\s\S]*?<!-- sidebar-vendors:end -->/;
if (!pattern.test(current)) throw new Error("Sidebar vendor slot is missing");
const next = current.replace(
  pattern,
  () => `<!-- sidebar-vendors:start -->\n${scripts}\n    <!-- sidebar-vendors:end -->`,
);
if (process.argv.includes("--check")) {
  if (next !== current) throw new Error("Run bun scripts/embed-sidebar-vendors.mjs");
} else if (next !== current) writeFileSync(entry, next);

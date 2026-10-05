import { expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const server = path.resolve(import.meta.dirname, "../bin/chat-groups-mcp.mjs");

test("MCP validation feedback follows the transient host locale", async () => {
  const dataRoot = mkdtempSync(path.join(tmpdir(), "chat-groups-locale-"));
  const child = spawn(process.execPath, [server], {
    env: {
      ...process.env,
      PLUGIN_DATA: dataRoot,
      OPENAGENT_PLUGIN_ID: "chat-groups",
      OPENAGENT_PLUGIN_HOST_URL: "http://127.0.0.1:1/host",
      OPENAGENT_PLUGIN_HOST_TOKEN: "test-token",
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  try {
    const response = new Promise((resolve, reject) => {
      let buffer = "";
      child.stdout.setEncoding("utf8").on("data", (chunk) => {
        buffer += chunk;
        let index = buffer.indexOf("\n");
        while (index !== -1) {
          const line = buffer.slice(0, index).trim();
          buffer = buffer.slice(index + 1);
          if (line) {
            const message = JSON.parse(line);
            if (message.id === 1) resolve(message);
          }
          index = buffer.indexOf("\n");
        }
      });
      child.once("error", reject);
      child.once("close", (code) => reject(new Error("MCP exited before replying: " + code)));
    });
    child.stdin.write(JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "chat_group_create",
        arguments: { title: " ", _openagent: { locale: "zh" } },
      },
    }) + "\n");
    const result = await response;
    expect(result.result.isError).toBe(true);
    expect(result.result.content[0].text).toBe("标题不能为空");
  } finally {
    child.kill();
    await new Promise((resolve) => child.once("close", resolve));
    rmSync(dataRoot, { recursive: true, force: true });
  }
});

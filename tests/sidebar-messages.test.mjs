import { expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadState, saveState, newGroup } from "../bin/chat-groups-state.mjs";

test("a user sidebar mention materializes a saved role and wakes that member", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "chat-group-sidebar-"));
  const wakes = [];
  const host = Bun.serve({
    port: 0,
    async fetch(request) {
      const { operation, args } = await request.json();
      if (operation === "conversation.create")
        return Response.json({ ok: true, result: { conv_id: "new-member", branch_id: "branch" } });
      if (operation === "agent.wake") wakes.push(args);
      return Response.json({ ok: true, result: { accepted: true } });
    },
  });
  const state = loadState(root),
    group = newGroup("workspace", "Existing group");
  state.groups.push(group);
  state.rosters[group.id] = [{ role_id: "reviewer", role_name: "Reviewer" }];
  saveState(root, state);
  const child = spawn(
    process.execPath,
    [path.resolve(import.meta.dirname, "../bin/chat-groups-mcp.mjs")],
    {
      env: {
        ...process.env,
        PLUGIN_DATA: root,
        OPENAGENT_PLUGIN_ID: "chat-groups",
        OPENAGENT_PLUGIN_HOST_URL: `http://127.0.0.1:${host.port}`,
        OPENAGENT_PLUGIN_HOST_TOKEN: "fixture",
      },
    },
  );
  try {
    const reply = new Promise((resolve, reject) => {
      let buffer = "";
      child.stdout.on("data", (chunk) => {
        buffer += chunk;
        if (buffer.includes("\n")) resolve(JSON.parse(buffer.split("\n")[0]));
      });
      child.on("error", reject);
    });
    child.stdin.write(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "chat_group_send_message",
          arguments: {
            group_id: group.id,
            content: "@Reviewer Please review",
            _openagent: { workspace: "workspace", conversation_id: "", locale: "en" },
          },
        },
      }) + "\n",
    );
    const response = await reply;
    expect(response.result.isError).toBe(false);
    const message = JSON.parse(response.result.content[0].text);
    expect(message.sender_type).toBe("user");
    expect(message.sender_id).toBeNull();
    const stored = loadState(root);
    expect(stored.groups[0].id).toBe(group.id);
    expect(stored.members[0].conversation_id).toBe("new-member");
    expect(message.mentions).toEqual([stored.members[0].id]);
    for (let attempt = 0; attempt < 100 && !wakes.length; attempt++) await Bun.sleep(10);
    expect(wakes).toHaveLength(1);
  } finally {
    child.kill();
    await new Promise((resolve) => child.once("close", resolve));
    host.stop(true);
    rmSync(root, { recursive: true, force: true });
  }
});

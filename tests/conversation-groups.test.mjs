import { expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { groupsForConversation, loadState, saveState } from "../bin/chat-groups-state.mjs";

test("creator, member and persisted sender associations exclude unrelated groups", () => {
  const state = {
    groups: [
      { id: "created", created_by_conversation_id: "a" },
      { id: "member" },
      { id: "sent" },
      { id: "legacy-agent" },
      { id: "other" },
    ],
    members: [{ group_id: "member", conversation_id: "a", branch_id: "old-branch" }],
    messages: [
      { group_id: "sent", sender_type: "conversation", sender_id: "a" },
      { group_id: "legacy-agent", sender_type: "agent", sender_id: "a" },
      { group_id: "other", sender_type: "user", sender_id: "a" },
    ],
  };
  expect(groupsForConversation(state, "a").map((group) => group.id)).toEqual([
    "created",
    "member",
    "sent",
    "legacy-agent",
  ]);
  expect(groupsForConversation(state, "unrelated")).toEqual([]);
});

test("MCP conversation filtering respects workspace and persists a creator as the owner member", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "chat-groups-conversation-"));
  const host = Bun.serve({
    port: 0,
    async fetch(request) {
      const { operation } = await request.json();
      return Response.json({
        ok: true,
        result:
          operation === "conversation.state"
            ? {
                conv_id: "conversation",
                workspace: "workspace",
                branch_id: "branch",
                title: "Unrelated title",
                role_id: null,
              }
            : { accepted: true },
      });
    },
  });
  saveState(root, {
    groups: [
      { id: "joined", workspace: "workspace", updated_at: 2 },
      { id: "other", workspace: "workspace", updated_at: 1 },
      {
        id: "foreign",
        workspace: "foreign",
        created_by_conversation_id: "conversation",
        updated_at: 3,
      },
    ],
    members: [{ group_id: "joined", conversation_id: "conversation" }],
    messages: [],
    rosters: {},
  });
  const originalBytes = readFileSync(path.join(root, "chat-groups.json"), "utf8");
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
  let serial = 0,
    buffer = "";
  const pending = new Map();
  child.stdout.on("data", (chunk) => {
    buffer += chunk;
    while (buffer.includes("\n")) {
      const end = buffer.indexOf("\n"),
        message = JSON.parse(buffer.slice(0, end));
      buffer = buffer.slice(end + 1);
      pending.get(message.id)?.(message.result);
      pending.delete(message.id);
    }
  });
  function call(name, args = {}) {
    const id = ++serial;
    const reply = new Promise((resolve) => pending.set(id, resolve));
    child.stdin.write(
      JSON.stringify({
        jsonrpc: "2.0",
        id,
        method: "tools/call",
        params: {
          name,
          arguments: {
            ...args,
            _openagent: { workspace: "workspace", conversation_id: "conversation", locale: "en" },
          },
        },
      }) + "\n",
    );
    return reply.then((result) => {
      expect(result.isError).toBe(false);
      return JSON.parse(result.content[0].text);
    });
  }
  try {
    expect(
      (await call("chat_group_list", { conversation_id: "conversation" })).map((group) => group.id),
    ).toEqual(["joined"]);
    expect((await call("chat_group_list")).map((group) => group.id)).toEqual(["joined", "other"]);
    expect(await call("chat_group_list", { conversation_id: "unrelated" })).toEqual([]);
    expect(readFileSync(path.join(root, "chat-groups.json"), "utf8")).toBe(originalBytes);
    const created = await call("chat_group_create", { title: "Created here" });
    expect(created.created_by_conversation_id).toBe("conversation");
    const restored = loadState(root);
    expect(
      restored.groups.find((group) => group.id === created.id).created_by_conversation_id,
    ).toBe("conversation");
    expect(restored.members).toHaveLength(2);
    expect(restored.members.find((member) => member.group_id === created.id)).toMatchObject({
      member_type: "owner",
      role_name: "Group owner",
      conversation_id: "conversation",
    });
    expect(
      (await call("chat_group_list", { conversation_id: "conversation" })).map((group) => group.id),
    ).toContain(created.id);
  } finally {
    child.kill();
    await new Promise((resolve) => child.once("close", resolve));
    host.stop(true);
    rmSync(root, { recursive: true, force: true });
  }
});

import { expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadState } from "../bin/chat-groups-state.mjs";

const roleList = [
  { id: "product", name: "互联网产品经理" },
  { id: "developer", name: "开发者生态观察员" },
  { id: "research", name: "科技行业研究员" },
];

async function fixture({
  legacy,
  raw,
  ownerRole = null,
  busyWakes = false,
  failedCancellation = null,
} = {}) {
  const root = mkdtempSync(path.join(tmpdir(), "chat-groups-lifecycle-"));
  const file = path.join(root, "chat-groups.json");
  if (legacy || raw) writeFileSync(file, raw ?? JSON.stringify(legacy));
  const conversations = new Map([
    [
      "creator",
      {
        conv_id: "creator",
        branch_id: "owner-branch",
        workspace: "workspace",
        title: "创建聊天组讨论今日科技新闻",
        role_id: ownerRole,
      },
    ],
  ]);
  const wakes = [],
    cancellations = [],
    created = [],
    events = [],
    pending = new Map();
  let failRole = null;
  const host = Bun.serve({
    port: 0,
    async fetch(request) {
      const { operation, args } = await request.json();
      let result = { accepted: true };
      if (operation === "roles.list") result = roleList;
      if (operation === "conversation.state") result = conversations.get(args.conv_id);
      if (operation === "conversation.create") {
        if (args.role_id === failRole)
          return Response.json({ ok: false, error: "fixture creation failed" });
        result = { conv_id: `child-${created.length}`, branch_id: `branch-${created.length}` };
        created.push(args);
        conversations.set(result.conv_id, { ...result, ...args });
      }
      if (operation === "event.emit") events.push(args);
      if (operation === "agent.wake") {
        wakes.push(args);
        if (busyWakes)
          return Response.json({ ok: false, error: "already active for this conversation" });
      }
      if (operation === "conversation.cancel") {
        cancellations.push(args.conv_id);
        if (args.conv_id === failedCancellation)
          return Response.json({ ok: false, error: "fixture cancel failed" });
      }
      return Response.json({ ok: true, result });
    },
  });
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
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  let buffer = "",
    serial = 0;
  child.stdout.on("data", (chunk) => {
    buffer += chunk;
    let index;
    while ((index = buffer.indexOf("\n")) !== -1) {
      const message = JSON.parse(buffer.slice(0, index));
      buffer = buffer.slice(index + 1);
      pending.get(message.id)?.(message.result);
    }
  });
  async function call(name, args = {}, context = {}) {
    const id = ++serial;
    const result = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`MCP ${name} timed out`));
      }, 4000);
      pending.set(id, (value) => {
        clearTimeout(timeout);
        pending.delete(id);
        resolve(value);
      });
    });
    child.stdin.write(
      JSON.stringify({
        jsonrpc: "2.0",
        id,
        method: "tools/call",
        params: {
          name,
          arguments: {
            ...args,
            _openagent: {
              workspace: "workspace",
              conversation_id: "creator",
              locale: "zh",
              ...context,
            },
          },
        },
      }) + "\n",
    );
    return result;
  }
  async function ok(name, args, context) {
    const result = await call(name, args, context);
    expect(result.isError).toBe(false);
    return JSON.parse(result.content[0].text);
  }
  async function waitWakes(count) {
    for (let i = 0; i < 100 && wakes.length < count; i++) await Bun.sleep(10);
    expect(wakes).toHaveLength(count);
  }
  async function close() {
    const closed = new Promise((resolve) => child.once("close", resolve));
    child.kill();
    await closed;
    host.stop(true);
    rmSync(root, { recursive: true, force: true });
  }
  return {
    root,
    file,
    call,
    ok,
    wakes,
    cancellations,
    created,
    events,
    conversations,
    waitWakes,
    close,
    failCreationFor: (id) => {
      failRole = id;
    },
  };
}

test("create immediately joins the creator as localized owner, with no conversation title or message", async () => {
  const f = await fixture();
  try {
    const group = await f.ok("chat_group_create", { title: "News" });
    expect(group.owner_conversation_id).toBe("creator");
    const zh = await f.ok("chat_group_list_members", { group_id: group.id });
    expect(zh).toHaveLength(1);
    expect(zh[0]).toMatchObject({
      member_type: "owner",
      role_name: "群主",
      conversation_id: "creator",
      branch_id: "owner-branch",
    });
    const en = await f.ok("chat_group_list_members", { group_id: group.id }, { locale: "en" });
    expect(en[0].role_name).toBe("Group owner");
    const added = await f.ok("chat_group_add_member", {
      group_id: group.id,
      conversation_id: "creator",
      role_name: "Wrong title",
    });
    expect(added.id).toBe(zh[0].id);
    expect(added.role_name).toBe("群主");
    expect(loadState(f.root).messages).toHaveLength(0);
    expect(f.wakes).toHaveLength(0);
  } finally {
    await f.close();
  }
});

test("Stop cancels the selected group's owner and members, preserving data and later user wakes", async () => {
  const f = await fixture();
  try {
    const started = await f.ok("chat_group_start", {
      title: "News",
      content: "Start",
      roles: ["product", "research"],
    });
    await f.waitWakes(2);
    const other = await f.ok("chat_group_start", {
      title: "Other",
      content: "Separate",
      roles: ["developer"],
      start_discussion: false,
    });
    const before = loadState(f.root);
    const stopped = await f.ok("chat_group_stop", { group_id: started.group.id });
    expect(stopped.stopped).toBe(true);
    expect(f.cancellations.sort()).toEqual(["creator", "child-0", "child-1"].sort());
    expect(f.cancellations).not.toContain("child-2");
    const after = loadState(f.root);
    expect(after.messages).toEqual(before.messages);
    expect(after.members).toEqual(before.members);
    expect(after.groups.find((g) => g.id === other.group.id).discussion_stopped).toBeUndefined();
    await f.ok(
      "chat_group_send_message",
      { group_id: started.group.id, content: "Late reply", mentions: ["all"] },
      { conversation_id: "child-0" },
    );
    await Bun.sleep(30);
    expect(f.wakes).toHaveLength(2);
    await f.ok(
      "chat_group_send_message",
      { group_id: started.group.id, content: "@互联网产品经理 Continue" },
      { conversation_id: "" },
    );
    await f.waitWakes(3);
    expect(f.wakes[2].hidden).toBe(false);
    expect(f.wakes[2].text).toBe("@互联网产品经理 Continue");
    expect(loadState(f.root).groups.find((g) => g.id === started.group.id).discussion_stopped).toBe(
      false,
    );
    await f.ok("chat_group_stop", { group_id: started.group.id });
    await f.ok("chat_group_start", {
      group_id: started.group.id,
      title: "News",
      content: "Join only",
      start_discussion: false,
    });
    expect(loadState(f.root).groups.find((g) => g.id === started.group.id).discussion_stopped).toBe(
      true,
    );
    await f.ok("chat_group_start", {
      group_id: started.group.id,
      title: "News",
      content: "Restart",
    });
    await f.waitWakes(5);
    expect(f.wakes.slice(3).every((wake) => wake.hidden === false && wake.text === "Restart")).toBe(
      true,
    );
  } finally {
    await f.close();
  }
});

test("Stop invalidates busy wake retries even after immediate resume", async () => {
  const f = await fixture({ busyWakes: true });
  try {
    const started = await f.ok("chat_group_start", {
      title: "News",
      content: "Old discussion",
      roles: ["product"],
    });
    await f.waitWakes(1);
    await f.ok("chat_group_stop", { group_id: started.group.id });
    await f.ok(
      "chat_group_send_message",
      { group_id: started.group.id, content: "New user message" },
      { conversation_id: "" },
    );
    await Bun.sleep(350);
    expect(f.wakes).toHaveLength(1);
  } finally {
    await f.close();
  }
});

test("Stop attempts every member and localizes partial cancellation failure", async () => {
  const f = await fixture({ failedCancellation: "creator" });
  try {
    const started = await f.ok("chat_group_start", {
      title: "News",
      content: "Start",
      roles: ["product"],
      start_discussion: false,
    });
    const result = await f.call("chat_group_stop", { group_id: started.group.id });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe("无法终止 1 个群组成员会话，请重试终止");
    expect(f.cancellations.sort()).toEqual(["child-0", "creator"]);
    expect(loadState(f.root).groups[0].discussion_stopped).toBe(true);
    const invalid = await f.call(
      "chat_group_stop",
      { group_id: started.group.id },
      { workspace: "other" },
    );
    expect(invalid.isError).toBe(true);
    expect(f.cancellations).toHaveLength(2);
  } finally {
    await f.close();
  }
});

test("Stop is not delayed by an incremental long-poll read", async () => {
  const f = await fixture();
  try {
    const group = await f.ok("chat_group_create", { title: "News" });
    const read = f.ok("chat_group_read_messages", { group_id: group.id, wait_secs: 2 });
    const started = Date.now();
    await f.ok("chat_group_stop", { group_id: group.id });
    expect(Date.now() - started).toBeLessThan(1000);
    await read;
  } finally {
    await f.close();
  }
});

test("start joins all selected roles and wakes them once; create then start reuses the group", async () => {
  const f = await fixture();
  try {
    const group = await f.ok("chat_group_create", { title: "News" });
    const started = await f.ok("chat_group_start", {
      group_id: group.id,
      title: "News",
      content: "请开始讨论",
      roles: ["product", "开发者生态观察员", "research"],
    });
    expect(started.group.id).toBe(group.id);
    expect(started.members).toHaveLength(4);
    expect(started.members[0].member_type).toBe("owner");
    expect(
      started.members
        .slice(1)
        .map((m) => m.role_name)
        .sort(),
    ).toEqual(roleList.map((r) => r.name).sort());
    expect(started.message.mentions).toHaveLength(3);
    expect(f.created.every((request) => request.parent_conv_id === "creator")).toBe(true);
    expect(f.created.map((request) => request.role_id).sort()).toEqual([
      "developer",
      "product",
      "research",
    ]);
    const children = f.events.filter((item) => item.name === "subagent-started");
    expect(children).toHaveLength(3);
    expect(
      children.every(
        ({ payload }) =>
          payload.parent_conv_id === "creator" && payload.started === false && payload.hidden_task,
      ),
    ).toBe(true);
    expect(started.discussion_started).toBe(true);
    await f.waitWakes(3);
    expect(
      f.wakes.every(
        (w) =>
          w.conv_id !== "creator" &&
          w.hidden &&
          w.wait === false &&
          w.parent_checkpoint_id === null,
      ),
    ).toBe(true);
    expect(loadState(f.root).groups).toHaveLength(1);
    await f.ok("chat_group_list_members", { group_id: group.id });
    expect(f.created).toHaveLength(3);
  } finally {
    await f.close();
  }
});

test("join-only ignores textual Agent mentions; explicit owner mentions work across languages and never self-wake", async () => {
  const f = await fixture();
  try {
    const started = await f.ok("chat_group_start", {
      title: "News",
      content: "@互联网产品经理 欢迎",
      roles: ["product"],
      start_discussion: false,
    });
    expect(started.members).toHaveLength(2);
    expect(started.message.mentions).toEqual([]);
    expect(started.discussion_started).toBe(false);
    const group_id = started.group.id;
    await f.ok("chat_group_send_message", { group_id, content: "@互联网产品经理 欢迎" });
    await Bun.sleep(50);
    expect(f.wakes).toHaveLength(0);
    await f.ok("chat_group_send_message", { group_id, content: "Reply", mentions: ["owner"] });
    await Bun.sleep(50);
    expect(f.wakes).toHaveLength(0);
    const userMessage = await f.ok(
      "chat_group_send_message",
      { group_id, content: "@群主 请回复" },
      { conversation_id: "", locale: "en" },
    );
    expect(userMessage.mentions).toEqual([started.members[0].id]);
    await f.waitWakes(1);
    expect(f.wakes[0].conv_id).toBe("creator");
  } finally {
    await f.close();
  }
});

test("an owner with a saved role retains that role while keeping owner identity", async () => {
  const f = await fixture({ ownerRole: "product" });
  try {
    const group = await f.ok("chat_group_create", { title: "News" });
    const members = await f.ok("chat_group_list_members", { group_id: group.id });
    expect(members[0]).toMatchObject({
      member_type: "owner",
      role_id: "product",
      role_name: "互联网产品经理",
    });
  } finally {
    await f.close();
  }
});

test("invalid roles and start parameters fail before creating any group", async () => {
  const f = await fixture();
  try {
    for (const args of [
      { roles: ["tech-analyst"] },
      { roles: "product" },
      { roles: [""] },
      { start_discussion: "false" },
    ]) {
      const result = await f.call("chat_group_start", { title: "News", content: "Hello", ...args });
      expect(result.isError).toBe(true);
    }
    expect(loadState(f.root).groups).toHaveLength(0);
    expect(f.created).toHaveLength(0);
  } finally {
    await f.close();
  }
});

test("partial role creation persists joined members so retrying the saved group does not duplicate conversations", async () => {
  const f = await fixture();
  try {
    f.failCreationFor("research");
    const args = {
      title: "News",
      content: "Hello",
      roles: ["product", "research"],
      start_discussion: false,
    };
    expect((await f.call("chat_group_start", args)).isError).toBe(true);
    const state = loadState(f.root);
    expect(state.groups).toHaveLength(1);
    expect(state.members).toHaveLength(2);
    f.failCreationFor(null);
    const restarted = await f.ok("chat_group_start", { ...args, group_id: state.groups[0].id });
    expect(restarted.members).toHaveLength(3);
    expect(f.created).toHaveLength(2);
  } finally {
    await f.close();
  }
});

test("legacy owner and rosters recover with an exact backup, stable IDs and no automatic wakes", async () => {
  const legacy = {
    groups: [{ id: "old", workspace: "workspace", title: "News" }],
    members: [
      {
        id: "old-owner",
        group_id: "old",
        conversation_id: "creator",
        role_id: null,
        role_name: "创建聊天组讨论今日科技新闻",
        joined_at: 1,
      },
    ],
    messages: [
      {
        id: "opening",
        group_id: "old",
        seq: 1,
        sender_type: "conversation",
        sender_id: "creator",
        content: "hello",
        mentions: [],
      },
    ],
    rosters: { old: [{ role_id: "product", role_name: "互联网产品经理" }] },
  };
  const f = await fixture({ legacy });
  try {
    const original = readFileSync(f.file, "utf8");
    const members = await f.ok("chat_group_list_members", { group_id: "old" });
    expect(members).toHaveLength(2);
    expect(members[0]).toMatchObject({ id: "old-owner", member_type: "owner", role_name: "群主" });
    expect(readFileSync(`${f.file}.v1.bak`, "utf8")).toBe(original);
    expect(loadState(f.root).messages).toEqual(legacy.messages);
    await f.ok("chat_group_list_members", { group_id: "old" });
    expect(f.created).toHaveLength(1);
    expect(f.wakes).toHaveLength(0);
  } finally {
    await f.close();
  }
});

test("a recorded legacy creator joins as owner without requiring an opening message", async () => {
  const f = await fixture({
    legacy: {
      groups: [{ id: "old", workspace: "workspace", created_by_conversation_id: "creator" }],
      members: [],
      messages: [],
      rosters: {},
    },
    ownerRole: "product",
  });
  try {
    const original = readFileSync(f.file, "utf8");
    const members = await f.ok("chat_group_list_members", { group_id: "old" });
    expect(members).toHaveLength(1);
    expect(members[0]).toMatchObject({
      member_type: "owner",
      conversation_id: "creator",
      role_id: "product",
      role_name: "互联网产品经理",
    });
    expect(loadState(f.root).groups[0].owner_conversation_id).toBe("creator");
    expect(readFileSync(`${f.file}.v1.bak`, "utf8")).toBe(original);
    expect(f.wakes).toHaveLength(0);
  } finally {
    await f.close();
  }
});

test("a failed upgrade backup preserves the original state and permits retry after repair", async () => {
  const f = await fixture({ legacy: { groups: [], members: [], messages: [], rosters: {} } });
  try {
    const original = readFileSync(f.file, "utf8");
    mkdirSync(`${f.file}.v1.bak`);
    const result = await f.call("chat_group_create", { title: "News" });
    expect(result.isError).toBe(true);
    expect(readFileSync(f.file, "utf8")).toBe(original);
    rmSync(`${f.file}.v1.bak`, { recursive: true });
    await f.ok("chat_group_create", { title: "News" });
    expect(readFileSync(`${f.file}.v1.bak`, "utf8")).toBe(original);
    expect(loadState(f.root).groups).toHaveLength(1);
  } finally {
    await f.close();
  }
});

test("corrupt, malformed or unsupported data cannot be overwritten by creating a group", async () => {
  for (const raw of [
    "{broken",
    "{}",
    JSON.stringify({ version: 999, groups: [], members: [], messages: [], rosters: {} }),
  ]) {
    const f = await fixture({ raw });
    try {
      expect((await f.call("chat_group_create", { title: "News" })).isError).toBe(true);
      expect(readFileSync(f.file, "utf8")).toBe(raw);
      expect(existsSync(`${f.file}.v1.bak`)).toBe(false);
    } finally {
      await f.close();
    }
  }
});

test("Runtime child tasks cannot auto-join by sending or by appearing in historical messages", async () => {
  const f = await fixture();
  try {
    const started = await f.ok("chat_group_start", {
      title: "News",
      content: "Discuss",
      roles: ["product"],
      start_discussion: false,
    });
    const participant = started.members[1];
    f.conversations.set("worker", {
      conv_id: "worker",
      branch_id: "worker-branch",
      workspace: "workspace",
      parent_conv_id: participant.conversation_id,
      role_id: "product",
      flow_kind: "subagent_v2",
    });
    const result = await f.call(
      "chat_group_send_message",
      {
        group_id: started.group.id,
        content: "Delegated reply",
      },
      { conversation_id: "worker" },
    );
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe("该会话不是此聊天组的成员");
    expect(loadState(f.root).members).toHaveLength(2);
    expect(loadState(f.root).messages).toHaveLength(1);
    const state = loadState(f.root);
    state.messages.push({
      group_id: started.group.id,
      sender_type: "conversation",
      sender_id: "worker",
      seq: 2,
      content: "Historical reply",
    });
    writeFileSync(f.file, JSON.stringify(state));
    expect(await f.ok("chat_group_list_members", { group_id: started.group.id })).toHaveLength(2);
    const reply = await f.ok(
      "chat_group_send_message",
      { group_id: started.group.id, content: "Participant reply" },
      { conversation_id: participant.conversation_id },
    );
    expect(reply.sender_id).toBe(participant.conversation_id);
    expect(loadState(f.root).members).toHaveLength(2);
  } finally {
    await f.close();
  }
});

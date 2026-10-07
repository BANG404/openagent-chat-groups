#!/usr/bin/env node

import { randomUUID } from "node:crypto";

import { readFileSync } from "node:fs";
import {
  agent,
  context,
  conversation,
  event,
  locale as hostLocale,
  roles as hostRoles,
} from "./chat-groups-host.mjs";
import {
  appendMessage,
  dataRoot,
  groupFor,
  groupsForConversation,
  loadState,
  membersFor,
  memberFor,
  messagesFor,
  newGroup,
  newMember,
  newMessage,
  saveState,
} from "./chat-groups-state.mjs";
import { defaultLocale, errorNotice, noticeText, requestLocale } from "./i18n.mjs";

const PROTOCOL_VERSION = "2024-11-05";
const root = dataRoot();
let mutation = Promise.resolve();

const TOOLS = [
  {
    name: "chat_group_list",
    description:
      "List collaboration groups in the requested workspace. Optionally filter by the conversation that created, joined or posted in a group.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: { workspace: { type: "string" }, conversation_id: { type: "string" } },
    },
  },
  {
    name: "chat_group_start",
    description:
      "Create a group (or use group_id from chat_group_create), join the creator as owner, add saved roles and post the opening message. By default wake the selected roles to begin discussion. Set start_discussion=false to join without waking. Use exact saved role names or IDs; resolve or create roles before calling. Check returned members rather than claiming roster entries have joined.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["title", "content"],
      properties: {
        title: { type: "string" },
        group_id: {
          type: "string",
          description: "Reuse an existing group instead of creating another one.",
        },
        roles: {
          type: "array",
          items: { type: "string" },
          description: "Exact saved role names or IDs to join.",
        },
        start_discussion: { type: "boolean", default: true },
        content: { type: "string" },
      },
    },
  },
  {
    name: "chat_group_create",
    description:
      "Create a durable group and join the calling conversation as group owner, without sending a message. Use the returned id as group_id when calling chat_group_start for this group.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["title"],
      properties: { title: { type: "string" } },
    },
  },
  {
    name: "chat_group_add_member",
    description: "Add an existing conversation to a collaboration group.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["group_id", "conversation_id"],
      properties: {
        group_id: { type: "string" },
        conversation_id: { type: "string" },
        role_id: { type: "string" },
        role_name: { type: "string" },
      },
    },
  },
  {
    name: "chat_group_list_members",
    description: "List conversations currently joined to a collaboration group.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["group_id"],
      properties: { group_id: { type: "string" } },
    },
  },
  {
    name: "chat_group_send_message",
    description:
      "Record a group message from an already joined member conversation; sending never joins another conversation. Agent messages wake only explicit mentions (member IDs, exact role names, owner/群主 or all); textual @names alone do not wake agents. User messages also resolve @names. The sender is never woken by its own message.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["group_id", "content"],
      properties: {
        group_id: { type: "string" },
        content: { type: "string" },
        mentions: { type: "array", items: { type: "string" } },
      },
    },
  },
  {
    name: "chat_group_read_messages",
    description: "Read durable group messages incrementally.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["group_id"],
      properties: {
        group_id: { type: "string" },
        from_seq: { type: "integer", minimum: 0 },
        wait_secs: { type: "integer", minimum: 0, maximum: 60 },
        limit: { type: "integer", minimum: 1, maximum: 200 },
      },
    },
  },
  {
    name: "chat_send_message",
    description: "Send a private message to an existing conversation.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["conversation_id", "content"],
      properties: { conversation_id: { type: "string" }, content: { type: "string" } },
    },
  },
];

function runMutation(fn) {
  const previous = mutation;
  let release;
  mutation = new Promise((resolve) => {
    release = resolve;
  });
  return previous.then(fn).finally(() => release());
}

function emit(name, payload) {
  void event.emit(name, payload).catch(() => {});
}

async function roles(workspace) {
  return (await hostRoles.list({ workspace })) ?? [];
}

async function roleByName(name, workspace) {
  const wanted = String(name).trim().toLocaleLowerCase();
  return (await roles(workspace)).find(
    (role) => String(role.name ?? "").toLocaleLowerCase() === wanted,
  );
}

async function roleById(id, workspace) {
  return (await roles(workspace)).find((role) => String(role.id ?? "") === String(id));
}

async function ensureMemberFromConversation(state, groupId, conversationId, workspace) {
  let member = state.members.find(
    (candidate) => candidate.group_id === groupId && candidate.conversation_id === conversationId,
  );
  if (member) return member;
  const detail = await conversation.state(conversationId);
  if (detail.workspace !== workspace)
    throw new Error("Conversation is outside the current workspace");
  const role = detail.role_id ? await roleById(detail.role_id, workspace) : null;
  const owner =
    state.groups.find((group) => group.id === groupId)?.owner_conversation_id === conversationId;
  member = newMember(
    groupId,
    conversationId,
    detail.role_id ?? null,
    role?.name ?? (owner ? "Group owner" : "Agent"),
    detail.branch_id ?? null,
    owner ? "owner" : "member",
  );
  state.members.push(member);
  return member;
}

async function materializeRoster(state, group, requested, workspace) {
  const roster = state.rosters[group.id] ?? [];
  const wanted = requested.includes("all") ? roster.map((item) => item.role_name) : requested;
  for (const name of wanted) {
    const role = roster.find(
      (item) => item.role_name.toLocaleLowerCase() === String(name).toLocaleLowerCase(),
    );
    if (!role) continue;
    if (
      state.members.some(
        (member) => member.group_id === group.id && member.role_id === role.role_id,
      )
    )
      continue;
    const created = await conversation.create({
      title: `${group.title}: ${role.role_name}`,
      workspace,
      parentConvId: group.owner_conversation_id ?? null,
      roleId: role.role_id,
    });
    state.members.push(
      newMember(group.id, created.conv_id, role.role_id, role.role_name, created.branch_id),
    );
    // Persist each successful creation before another host operation can fail.
    saveState(root, state);
    await event.emit("subagent-started", {
      plugin_id: "chat-groups",
      parent_conv_id: group.owner_conversation_id ?? null,
      sub_conv_id: created.conv_id,
      branch_id: created.branch_id,
      title: `${group.title}: ${role.role_name}`,
      role_id: role.role_id,
      workspace,
      task: "",
      task_msg_id: randomUUID(),
      hidden_task: true,
      started: false,
    });
  }
}

function resolveMentions(state, group, requested, userContent) {
  const members = membersFor(state, group.id);
  const result = [];
  const push = (id) => {
    if (!result.includes(id)) result.push(id);
  };
  for (const value of requested) {
    if (value === "all") {
      for (const member of members) push(member.id);
    } else if (members.some((member) => member.id === value)) {
      push(value);
    } else {
      const byName = members.find((member) => matchesMember(member, value));
      if (byName) push(byName.id);
    }
  }
  if (userContent) {
    for (const match of userContent.matchAll(/@(?:"([^"]+)"|([\p{L}\p{N}_-]+))/gu)) {
      const name = (match[1] ?? match[2] ?? "").trim().toLocaleLowerCase();
      if (name === "all") {
        for (const member of members) push(member.id);
        continue;
      }
      const member = members.find((item) => matchesMember(item, name));
      if (member) push(member.id);
    }
  }
  return result;
}

function matchesMember(member, name) {
  const wanted = String(name).trim().toLocaleLowerCase();
  return (
    (member.member_type === "owner" && ["owner", "群主", "group owner"].includes(wanted)) ||
    member.role_name.toLocaleLowerCase() === wanted
  );
}

async function presentMembers(state, groupId, args) {
  const locale = await requestLocale(args, { locale: hostLocale });
  return membersFor(state, groupId).map((member) => ({
    ...member,
    ...(!member.role_id && member.role_name === "Group owner"
      ? { role_name: noticeText("notice.memberOwner", {}, locale) }
      : !member.role_id && member.role_name === "Agent"
        ? { role_name: noticeText("notice.memberAgent", {}, locale) }
        : {}),
  }));
}

async function ensureBranch(member) {
  if (member.branch_id) return member.branch_id;
  const detail = await conversation.state(member.conversation_id);
  member.branch_id = detail.branch_id ?? null;
  return member.branch_id;
}

function wakePrompt(group, message) {
  return [
    `[chat_group:${group.id} message:${message.id}] You were selected in a Chat Groups message.`,
    "Read the latest group messages with chat_group_read_messages when context is needed.",
    "If you have a substantive response, publish one concise reply with chat_group_send_message using this group_id before finishing. The private final answer is not visible in the group.",
    "Publish from this member conversation directly. If tools are relay-mounted, load plugin:chat-groups:chat-groups with load_tool. Do not spawn a child agent to send a group reply; Runtime child tasks are not group members.",
    "Do not create another group or wake additional roles unless the message explicitly asks you to.",
    "",
    `Group message:\n${message.content}`,
  ].join("\n");
}

async function wakeMember(group, message, member, attempt = 0) {
  const branchId = await ensureBranch(member);
  try {
    await agent.wake(
      {
        convId: member.conversation_id,
        branchId,
        text: wakePrompt(group, message),
        // Resolve the branch head in the bridge immediately before the
        // submission. A checkpoint read here would be stale if another turn
        // finishes while this wake is queued.
        parent_checkpoint_id: null,
        attachments: [],
        contexts: [],
        model_binding: null,
        user_message_id: null,
        assistant_message_id: null,
      },
      { wait: false, hidden: true },
    );
  } catch (error) {
    const text = String(error?.message ?? error);
    if (text.includes("already active for this conversation") && attempt < 5) {
      setTimeout(() => void wakeMember(group, message, member, attempt + 1), 150 * (attempt + 1));
    } else {
      emit("chat-group-wake-failed", {
        group_id: group.id,
        member_id: member.id,
        attempts: attempt + 1,
        error: text,
      });
    }
  }
}

async function createGroup(args) {
  const { workspace, conversationId } = context(args);
  const title = String(args.title ?? "").trim();
  if (!title) throw new Error("title is empty");
  const state = loadState(root);
  const group = newGroup(workspace, title, conversationId || null);
  if (conversationId) group.created_by_conversation_id = conversationId;
  state.groups.push(group);
  if (conversationId)
    await ensureMemberFromConversation(state, group.id, conversationId, workspace);
  saveState(root, state);
  emit("chat-group-updated", group);
  return group;
}

async function listGroups(args) {
  const { workspace } = context(args);
  const state = loadState(root);
  const conversationId = String(args.conversation_id ?? "").trim();
  return (conversationId ? groupsForConversation(state, conversationId) : state.groups)
    .filter((group) => !workspace || group.workspace === workspace)
    .sort((a, b) => b.updated_at - a.updated_at || b.id.localeCompare(a.id));
}

async function addMember(args) {
  const { workspace } = context(args);
  const state = loadState(root);
  const group = groupFor(state, String(args.group_id), workspace);
  const detail = await conversation.state(String(args.conversation_id));
  if (detail.workspace !== workspace)
    throw new Error("Conversation is outside the current workspace");
  const roleId = args.role_id ?? detail.role_id;
  const role = roleId ? await roleById(roleId, workspace) : null;
  if (args.role_id && !role) throw new Error(`Unknown role '${args.role_id}'`);
  const existing = state.members.find(
    (member) => member.group_id === group.id && member.conversation_id === detail.conv_id,
  );
  const owner = group.owner_conversation_id === detail.conv_id;
  const member =
    existing ??
    newMember(
      group.id,
      detail.conv_id,
      args.role_id ?? detail.role_id ?? null,
      String(owner && !detail.role_id ? "Group owner" : (args.role_name ?? role?.name ?? "Agent")),
      detail.branch_id ?? null,
      owner ? "owner" : "member",
    );
  if (!existing) state.members.push(member);
  else Object.assign(existing, member);
  saveState(root, state);
  emit("chat-group-member-changed", member);
  return (await presentMembers(state, group.id, args)).find((item) => item.id === member.id);
}

async function listMembers(args) {
  const { workspace } = context(args);
  const state = loadState(root);
  const group = groupFor(state, String(args.group_id), workspace);
  if (group.owner_conversation_id)
    await ensureMemberFromConversation(state, group.id, group.owner_conversation_id, workspace);
  // Recover legacy rosters as visible joined members, without sending a wake.
  await materializeRoster(state, group, ["all"], workspace);
  saveState(root, state);
  return presentMembers(state, group.id, args);
}

async function sendGroupMessage(args) {
  const { conversationId, workspace } = context(args);
  const state = loadState(root);
  const group = groupFor(state, String(args.group_id), workspace);
  const content = String(args.content ?? "").trim();
  if (!content) throw new Error("content is empty");
  if (
    conversationId &&
    !state.members.some(
      (member) => member.group_id === group.id && member.conversation_id === conversationId,
    )
  )
    throw new Error("Conversation is not a member of this chat group");
  const user = !conversationId;
  const requested = Array.isArray(args.mentions) ? args.mentions.map(String) : [];
  const namedMentions = user
    ? [...content.matchAll(/@(?:"([^"]+)"|([\p{L}\p{N}_-]+))/gu)].map(
        (match) => match[1] ?? match[2],
      )
    : [];
  await materializeRoster(state, group, [...requested, ...namedMentions], workspace);
  const mentions = resolveMentions(state, group, requested, user ? content : "");
  const message = appendMessage(
    state,
    newMessage(group.id, user ? "user" : "conversation", conversationId, content, mentions),
  );
  saveState(root, state);
  emit("chat-group-message", message);
  const members = membersFor(state, group.id);
  for (const id of mentions) {
    const member = members.find((candidate) => candidate.id === id);
    if (!member || member.conversation_id === conversationId) continue;
    void wakeMember(group, message, member);
  }
  return message;
}

async function readMessages(args) {
  const { workspace } = context(args);
  const state = loadState(root);
  groupFor(state, String(args.group_id), workspace);
  const fromSeq = Math.max(0, Number(args.from_seq ?? 0));
  const limit = Math.max(1, Math.min(200, Number(args.limit ?? 50)));
  const waitSecs = Math.max(0, Math.min(60, Number(args.wait_secs ?? 10)));
  const deadline = Date.now() + waitSecs * 1000;
  let messages = messagesFor(state, String(args.group_id), fromSeq, limit);
  while (messages.length === 0 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    messages = messagesFor(loadState(root), String(args.group_id), fromSeq, limit);
  }
  return { messages, next_seq: messages.at(-1)?.seq ?? fromSeq, temporary: waitSecs > 0 };
}

async function startGroup(args) {
  const { workspace } = context(args);
  const title = String(args.title ?? "").trim();
  const content = String(args.content ?? "").trim();
  if (!title || !content) throw new Error("title and content are required");
  if (args.start_discussion !== undefined && typeof args.start_discussion !== "boolean")
    throw new Error("start_discussion must be a boolean");
  if (
    args.roles !== undefined &&
    (!Array.isArray(args.roles) ||
      args.roles.some((name) => typeof name !== "string" || !name.trim()))
  )
    throw new Error("roles must contain non-empty saved role names or IDs");
  const roleNames = [...new Set((args.roles ?? []).map((name) => name.trim()))];
  const available = await roles(workspace);
  const resolved = roleNames.map((name) => {
    const role = available.find(
      (item) =>
        item.id === name ||
        String(item.name ?? "").toLocaleLowerCase() === name.toLocaleLowerCase(),
    );
    if (!role) throw new Error(`Unknown role '${name}'`);
    return { role_id: role.id, role_name: role.name };
  });
  const roster = resolved.filter(
    (item, index) => resolved.findIndex((other) => other.role_id === item.role_id) === index,
  );
  const group = args.group_id
    ? groupFor(loadState(root), String(args.group_id), workspace)
    : await createGroup({ ...args, title, _openagent: args._openagent });
  const state = loadState(root);
  const previous = state.rosters[group.id] ?? [];
  state.rosters[group.id] = [
    ...previous,
    ...roster.filter((item) => !previous.some((old) => old.role_id === item.role_id)),
  ];
  saveState(root, state);
  try {
    await materializeRoster(state, group, ["all"], workspace);
  } catch {
    throw new Error(`Group '${group.id}' was saved; retry with group_id to finish adding roles`);
  }
  const targets = args.roles === undefined ? state.rosters[group.id] : roster;
  const message = await sendGroupMessage({
    ...args,
    group_id: group.id,
    content,
    mentions: args.start_discussion === false ? [] : targets.map((item) => item.role_name),
    _openagent: args._openagent,
  });
  const members = await listMembers({ group_id: group.id, _openagent: args._openagent });
  const senderId = context(args).conversationId;
  return {
    group: groupFor(loadState(root), group.id, workspace),
    members,
    message,
    discussion_started: members.some(
      (member) => message.mentions.includes(member.id) && member.conversation_id !== senderId,
    ),
  };
}

async function sendPrivate(args) {
  const { workspace } = context(args);
  const conversationId = String(args.conversation_id ?? "").trim();
  const content = String(args.content ?? "").trim();
  if (!conversationId || !content) throw new Error("conversation_id and content are required");
  const detail = await conversation.state(conversationId);
  if (detail.workspace !== workspace)
    throw new Error("Conversation is outside the current workspace");
  await agent.submit({
    convId: conversationId,
    branchId: detail.branch_id ?? null,
    text: content,
    // The generic bridge resolves the current branch head at submission
    // time, so private messages cannot fork from a stale state snapshot.
    parent_checkpoint_id: null,
    attachments: [],
    contexts: [],
    model_binding: null,
    user_message_id: null,
    assistant_message_id: null,
  });
  return { conversation_id: conversationId, accepted: true };
}

async function callTool(name, args) {
  return runMutation(async () => {
    if (name === "chat_group_list") return listGroups(args);
    if (name === "chat_group_start") return startGroup(args);
    if (name === "chat_group_create") return createGroup(args);
    if (name === "chat_group_add_member") return addMember(args);
    if (name === "chat_group_list_members") return listMembers(args);
    if (name === "chat_group_send_message") return sendGroupMessage(args);
    if (name === "chat_group_read_messages") return readMessages(args);
    if (name === "chat_send_message") return sendPrivate(args);
    throw new Error(`Unknown tool: ${name}`);
  });
}

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}
function methodNotFound(id, method) {
  const respond = (locale) =>
    send({
      jsonrpc: "2.0",
      id,
      error: { code: -32601, message: noticeText("notice.methodMissing", { method }, locale) },
    });
  void requestLocale({}, { locale: hostLocale })
    .then(respond)
    .catch(() => respond(defaultLocale));
}
function reply(id, value, isError = false) {
  send({
    jsonrpc: "2.0",
    id,
    result: {
      content: [{ type: "text", text: isError ? String(value) : JSON.stringify(value) }],
      isError,
    },
  });
}

function handle(message) {
  const { id, method, params } = message;
  if (method === "initialize") {
    send({
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: params?.protocolVersion ?? PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: "chat-groups", version: "2.0.0" },
      },
    });
    return;
  }
  if (method === "notifications/initialized") return;
  if (method === "ping") {
    send({ jsonrpc: "2.0", id, result: {} });
    return;
  }
  if (method === "tools/list") {
    send({ jsonrpc: "2.0", id, result: { tools: TOOLS } });
    return;
  }
  if (method === "tools/call") {
    const args = params?.arguments ?? {};
    callTool(params?.name, args)
      .then((value) => reply(id, value))
      .catch(async (error) => {
        let requestedLocale = defaultLocale;
        try {
          requestedLocale = await requestLocale(args, { locale: hostLocale });
        } catch {}
        reply(id, errorNotice(error, requestedLocale), true);
      });
    return;
  }
  if (id !== undefined) methodNotFound(id, method);
}

let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let index = buffer.indexOf("\n");
  while (index !== -1) {
    const line = buffer.slice(0, index).trim();
    buffer = buffer.slice(index + 1);
    if (line) {
      try {
        handle(JSON.parse(line));
      } catch (error) {
        void requestLocale({}, { locale: hostLocale })
          .then((requestedLocale) =>
            process.stderr.write(`${errorNotice(error, requestedLocale)}\n`),
          )
          .catch(() => process.stderr.write(`${errorNotice(error, defaultLocale)}\n`));
      }
    }
    index = buffer.indexOf("\n");
  }
});
process.stdin.on("end", () => process.exit(0));

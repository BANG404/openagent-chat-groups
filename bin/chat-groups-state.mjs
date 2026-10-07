import { createHash, randomUUID } from "node:crypto";
import {
  constants,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

const EMPTY = { version: 2, groups: [], members: [], messages: [], rosters: {} };

export function dataRoot() {
  const root = String(process.env.PLUGIN_DATA ?? "").trim();
  if (!root) throw new Error("PLUGIN_DATA is not set");
  mkdirSync(root, { recursive: true });
  return root;
}

function stateFile(root) {
  return path.join(root, "chat-groups.json");
}

export function loadState(root) {
  const file = stateFile(root);
  if (!existsSync(file)) return structuredClone(EMPTY);
  let value;
  try {
    value = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    throw new Error("Chat Groups data could not be read");
  }
  return normalize(value);
}

export function saveState(root, state) {
  const file = stateFile(root);
  const normalized = normalize(state);
  if (existsSync(file)) {
    const existing = JSON.parse(readFileSync(file, "utf8"));
    normalize(existing);
    if (existing.version === undefined) {
      const backup = `${file}.v1.bak`;
      if (existsSync(backup)) {
        if (!statSync(backup).isFile()) throw new Error("Chat Groups backup could not be saved");
      } else {
        try {
          copyFileSync(file, backup, constants.COPYFILE_EXCL);
        } catch {
          throw new Error("Chat Groups backup could not be saved");
        }
      }
    }
  }
  const temporary = `${file}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
  renameSync(temporary, file);
}

export function normalize(value) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    !["groups", "members", "messages"].every((key) => Array.isArray(value[key])) ||
    (value.rosters !== undefined &&
      (!value.rosters || typeof value.rosters !== "object" || Array.isArray(value.rosters)))
  ) {
    throw new Error("Chat Groups data could not be read");
  }
  if (value.version !== undefined && value.version !== 2) {
    throw new Error(`Unsupported Chat Groups data version '${value.version}'`);
  }
  const state = structuredClone({ ...value, version: 2, rosters: value.rosters ?? {} });
  for (const group of state.groups) {
    if (value.version === undefined && group.owner_conversation_id === undefined) {
      const first = messagesFor(state, group.id, 0, 1)[0];
      group.owner_conversation_id = first?.sender_type === "conversation" ? first.sender_id : null;
    }
    for (const member of state.members.filter((item) => item.group_id === group.id)) {
      member.member_type =
        group.owner_conversation_id === member.conversation_id ? "owner" : "member";
      if (member.member_type === "owner" && !member.role_id) member.role_name = "Group owner";
    }
  }
  return state;
}

export function newGroup(workspace, title, ownerConversationId = null) {
  const now = Date.now();
  return {
    id: randomUUID(),
    workspace,
    title,
    owner_conversation_id: ownerConversationId,
    created_at: now,
    updated_at: now,
  };
}

export function newMember(
  groupId,
  conversationId,
  roleId,
  roleName,
  branchId = null,
  memberType = "member",
) {
  return {
    id: randomUUID(),
    group_id: groupId,
    conversation_id: conversationId,
    branch_id: branchId,
    role_id: roleId ?? null,
    role_name: roleName || "role",
    member_type: memberType,
    joined_at: Date.now(),
  };
}

export function newMessage(groupId, senderType, senderId, content, mentions) {
  return {
    id: randomUUID(),
    group_id: groupId,
    seq: 0,
    sender_type: senderType,
    sender_id: senderId ?? null,
    content,
    mentions: [...mentions],
    created_at: Date.now(),
  };
}

export function groupFor(state, groupId, workspace) {
  const group = state.groups.find((item) => item.id === groupId);
  if (!group) throw new Error("Chat group not found");
  if (workspace !== undefined && group.workspace !== workspace) {
    throw new Error("Chat group is outside the current workspace");
  }
  return group;
}

export function membersFor(state, groupId) {
  return state.members
    .filter((member) => member.group_id === groupId)
    .sort(
      (a, b) =>
        Number(b.member_type === "owner") - Number(a.member_type === "owner") ||
        a.joined_at - b.joined_at ||
        a.id.localeCompare(b.id),
    );
}

export function messagesFor(state, groupId, fromSeq = 0, limit = 50) {
  return state.messages
    .filter((message) => message.group_id === groupId && message.seq > fromSeq)
    .sort((a, b) => a.seq - b.seq)
    .slice(0, limit);
}

export function appendMessage(state, message) {
  const latest = state.messages
    .filter((item) => item.group_id === message.group_id)
    .reduce((max, item) => Math.max(max, Number(item.seq) || 0), 0);
  message.seq = latest + 1;
  state.messages.push(message);
  const group = state.groups.find((item) => item.id === message.group_id);
  if (group) group.updated_at = message.created_at;
  return message;
}

export function memberFor(state, groupId, id) {
  return state.members.find((member) => member.group_id === groupId && member.id === id);
}

export function stableConversationKey(conversationId) {
  return createHash("sha256").update(String(conversationId)).digest("hex");
}

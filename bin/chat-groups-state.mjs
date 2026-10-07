import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

const EMPTY = { groups: [], members: [], messages: [], rosters: {} };

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
  try {
    const value = JSON.parse(readFileSync(file, "utf8"));
    return normalize(value);
  } catch {
    return structuredClone(EMPTY);
  }
}

export function saveState(root, state) {
  const file = stateFile(root);
  const temporary = `${file}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(normalize(state), null, 2)}\n`, "utf8");
  renameSync(temporary, file);
}

export function normalize(value) {
  const source = value && typeof value === "object" ? value : {};
  return {
    groups: Array.isArray(source.groups) ? source.groups : [],
    members: Array.isArray(source.members) ? source.members : [],
    messages: Array.isArray(source.messages) ? source.messages : [],
    rosters: source.rosters && typeof source.rosters === "object" ? source.rosters : {},
  };
}

export function newGroup(workspace, title) {
  const now = Date.now();
  return { id: randomUUID(), workspace, title, created_at: now, updated_at: now };
}

export function newMember(groupId, conversationId, roleId, roleName, branchId = null) {
  return {
    id: randomUUID(),
    group_id: groupId,
    conversation_id: conversationId,
    branch_id: branchId,
    role_id: roleId ?? null,
    role_name: roleName || "role",
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
    .sort((a, b) => a.joined_at - b.joined_at || a.id.localeCompare(b.id));
}

export function groupsForConversation(state, conversationId) {
  const related = new Set(
    state.members.filter((member) => member.conversation_id === conversationId).map((member) => member.group_id),
  );
  for (const message of state.messages) {
    if (["conversation", "agent"].includes(message.sender_type) && message.sender_id === conversationId) {
      related.add(message.group_id);
    }
  }
  return state.groups.filter((group) =>
    group.created_by_conversation_id === conversationId || related.has(group.id),
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

---
name: chat-groups
description: Use OpenAgent Chat Groups when a conversation needs mention-aware group participants, role-scoped messages, or group lifecycle actions.
---

# Chat Groups

This package defaults to relay mounting. If its tools are not yet available,
call `load_tool` with `server_id: "plugin:chat-groups:chat-groups"` before using
the group tools. A user may override the package to mount them directly.

Chat Groups is an ordinary Agent Plugin package. Keep group state, role scope,
message visibility, and wake scheduling inside the package; use the shared Host
Bridge for conversations, branches, Agent turns, roles, events, and optional
opaque flow projections. Use `parent_checkpoint_id: null` for wakes so the
bridge resolves the current branch head at submission time.

## Create and start a group

Use `chat_group_start` for a new discussion; do not call `chat_group_create`
first unless an empty group is intentional. If a group already exists, pass its
ID as `group_id` to start it instead of creating a duplicate. Resolve saved
roles first and pass their exact names or IDs. Unknown roles fail before a new
group is saved. Create missing roles only when the requested task needs them.

The calling conversation joins immediately as the group owner. Ownership is
separate from a saved role: an unbound owner is displayed as Group owner / 群主,
and a role-bound owner retains its role name plus the owner label. Conversation
titles are never default member names. `chat_group_start` creates conversations
for its selected roles and returns the actual joined `members`.

By default start wakes selected roles with the opening message. Set
`start_discussion: false` to join without starting Agent turns. When resuming
an existing group with no `roles` field, its saved roster is selected. Explicit
`roles: []` wakes nobody. Creation failures retain the group ID and successful
members; retry with that `group_id`, which prevents duplicate conversations.

Agent-authored messages require explicit `mentions` (member IDs, exact role
names, `owner` / `群主`, or `all`) to wake participants. Listing `@names` in
the content alone does not wake Agents. User sidebar messages resolve textual
mentions too. A message never wakes its own sender. Use `@owner` for an unbound
owner across language changes; a role-bound owner can also be mentioned by role.
Check returned members and mention targets before reporting that participants
joined or discussion started. A private final response is not a group reply;
participants publish substantive replies with `chat_group_send_message`.

## Data and verification

State version 2 records `owner_conversation_id` and `member_type`. For an
unversioned group, its recorded creator establishes ownership; otherwise only
a first message authored by a conversation establishes legacy ownership. Groups with no such evidence remain ownerless; do not guess
from a title. Before the first persisted upgrade, preserve the original JSON
as `chat-groups.json.v1.bak`. Migration preserves IDs, role bindings and history.
Listing members materializes any legacy saved roster without waking it.
Unreadable, malformed or unsupported-version data fails without replacement.

Run `bun test tests` and Plugin Kit's `validate-plugin.mjs` against the candidate.
The host's `test:blackbox:chat-groups-sidebar` covers owner labels, stable owner
mentions, role-bound owners, live English/Chinese and light/dark changes, reload,
and the existing sidebar interactions. `test:blackbox:chat-groups-wake` verifies
hidden wake prompts and transcript recovery in the real desktop window.

## Participant conversations

Create each selected role with the generic `conversation.create` bridge, passing
its saved `role_id` and the group's `owner_conversation_id` as `parent_conv_id`.
A group ID is package data, never a Runtime conversation ID. Publish the standard
`subagent-started` projection after persisting the member, with `started: false`
and a hidden empty task, so join-only conversations appear live without a fake
user message or running state. Use `agent.wake` for discussion on that same branch.

Membership is explicit: creation/start and `chat_group_add_member` join
conversations. Sending and listing messages never auto-enroll their authors.
An unjoined Runtime child task cannot send a group reply. Participants send from
their own conversation; if needed, load the relay tools with `load_tool` rather
than delegating a send with `spawn_agent`. Existing member IDs and message history
remain unchanged; this fix does not merge historical conversations or rewrite
old parent links.

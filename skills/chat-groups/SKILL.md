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

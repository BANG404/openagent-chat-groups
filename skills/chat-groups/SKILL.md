---
name: chat-groups
description: Use OpenAgent Chat Groups when a conversation needs mention-aware group participants, role-scoped messages, or group lifecycle actions.
---

# Chat Groups

Chat Groups is an ordinary Agent Plugin package. Keep group state, role scope,
message visibility, and wake scheduling inside the package; use the shared Host
Bridge for conversations, branches, Agent turns, roles, events, and optional
opaque flow projections. Use `parent_checkpoint_id: null` for wakes so the
bridge resolves the current branch head at submission time.

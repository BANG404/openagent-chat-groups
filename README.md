# OpenAgent Chat Groups

The standard Agent Plugin package for OpenAgent Chat Groups. The package carries
its portable identity, Skill, MCP server, and package-owned group state. The
trusted OpenAgent Runtime supplies only generic conversations, Agent turns,
cancellation, roles, events, and the plugin host bridge. The vendored
`bin/lib/openagent-host.mjs` client is the same capability interface used by
every plugin; member wake-ups call `agent.wake`.

## Group ownership and discussion

The creating conversation joins as **Group owner / 群主** immediately, including
when creating an empty group. If it has a saved role, the sidebar shows the role
name with an owner label. Member names never fall back to conversation titles.

`chat_group_start` joins selected saved roles as actual member conversations and
starts their discussion by default. Use `start_discussion: false` to add them
without waking them. Pass `group_id` to start an existing group. The tools return
the joined members; a list of role names in a message is not proof of membership.
The bundled Skill documents role selection, explicit mentions and recovery.

Version 2.0.0 changes the start default from saving a deferred roster to joining
and waking the selected roles. Existing clients that only prepare a group should
set `start_discussion: false`. Existing unversioned state is upgraded with an
original-file backup at `chat-groups.json.v1.bak`; legacy role rosters become
visible members without automatic wakes. Corrupt or unsupported data is retained
and reported instead of silently replaced.

The shared bridge also exposes `conversation.flow.set` for an optional opaque
package projection. Chat Groups keeps its durable group state in `PLUGIN_DATA`;
it does not register a Runtime-owned group implementation.

Install the package from this repository through **Settings -> Plugins ->
Install**, or subscribe to its GitHub repository through the ordinary plugin
update flow.

## Group sidebar

The workspace-scoped `groups` sidebar reads the package's existing MCP tools
through the version-1 sidebar tool bridge. It lists saved groups, members and
paginated messages, polls for new messages, and sends user messages with optional
`@role` mentions. Typing `@` opens a member palette above the composer; typing
filters roles, arrows select, Enter/Tab insert, and Escape dismisses. `@all`
selects all members. IME composition never selects or sends, and choosing an
item replaces only the mention at the caret. Member buttons insert mentions too.
When a conversation is open, its live sidebar context filters groups to those
it created, joined or posted in. Without an open conversation the picker lists
all groups in the current workspace. Switching conversations clears stale
messages immediately, remembers the selected group per conversation and keeps
drafts per group. Branch switches keep the same conversation's group selection.
An unrelated conversation shows an empty state instead of another group's messages.
The input stays disabled until the selected group's members and messages load.
`chat_group_list` accepts an optional `conversation_id` filter; omission preserves
workspace-wide listing. New groups record their creating conversation and join
it as the group owner. Existing creator, member and Agent-message associations
remain available through the ownership upgrade.
Messages render GFM Markdown (headings, emphasis, lists, quotes, tables, fenced
code and links) with preserved line breaks. Raw HTML stays visible text; unsafe
URL schemes and executable markup are excluded. External HTTP(S) links use the
optional host opener instead of navigating the panel. Images show their alt
text; the panel does not fetch network resources.
The square Stop button beside Send terminates the selected group's member
turns, including its owner. It keeps messages, membership and the draft, and
prevents queued or late Agent messages from waking another member. Failed
cancellations show a localized retry notice. A new user message or explicit
`chat_group_start` resumes discussion.
The application selects the owning package and supplies workspace and locale;
the frame receives no bridge credential or conversation transcript. Drafts are
kept per group while switching the picker and live locale/theme changes preserve
input. Failed requests keep the draft and expose Refresh for retry.
Older hosts without `tool_calls` support show an update-required message.
The sidebar follows the desktop group-panel layout: a compact title and message
count, collapsible outlined member pills, consecutive messages grouped under a
sticky speaker heading, and an inset Mica composer with an arrow Send button.
Light and dark colors match the application's conversation surface. The message
list owns a bounded scroll viewport above the composer, separated by an 8px gap.
The final message and the entire scrollbar remain accessible, including when
the input height changes.
Existing `PLUGIN_DATA/chat-groups.json` remains the source of truth, including
its versioned ownership migration. Install this package directory again to activate its
new sidebar entry; source changes do not update an already installed copy.

## Message policies

Member wake-ups use the authenticated bridge's `hidden: true` option. Runtime
retains the user-role prompt as model-visible checkpoint data under
`plugin:chat-groups:control`, while live and restored transcripts omit it and
keep the Agent reply. Ordinary group messages and explicit `chat_send_message`
submissions remain visible. This applies to new wakes; existing untagged user
records keep their original visibility.

This package declares none. The Runtime keeps the `chat_group_mention` entry
only for legacy checkpoint compatibility; new Chat Groups events use the
plugin's generic event and MCP contract. A policy declared here would be namespaced to `plugin:chat-groups:<tag>`, which
belongs to messages this package's own automation would print; this package
ships no automation, so it could never take effect and would only add a second
entry to the plugin card's policy count.

## Language support

The package declares English and Chinese in `plugin.json`. OpenAgent supplies
the current application language to each MCP call and through `locale.get`
when the process reports an independent notice. Plugin metadata, validation
feedback, and operational notices follow that language. Group IDs, role names,
conversation content, and stored messages keep their original values.

## Development

The single HTML sidebar embeds pinned Marked and DOMPurify browser bundles.
Their source versions, SHA-256 digests and licenses live in `ui/vendor/`.
After changing a vendor, update its provenance and regenerate the inline slot:

```bash
bun scripts/embed-sidebar-vendors.mjs
bun scripts/embed-sidebar-vendors.mjs --check
```

Keep the vendor slot's `prettier-ignore` directives so embedding stays byte
deterministic. The sidebar is network-free and does not load external scripts.

Validate the package with the validator from
an [OpenAgent Plugin Kit](https://github.com/BANG404/openagent-plugin-kit)
checkout, pointing at this directory.

```bash
bun <plugin-kit>/scripts/validate-plugin.mjs .
```

The package follows the portable Agent Plugins 1.0.0 format and the generic
`extensions.openagent` package contract.

## License

MIT

## MCP mounting and plugin name

The manifest declares `mcp_tool_mode: relay`. Use `load_tool` to discover and
mount the package MCP tools before calling them.
Users may select Direct, Relay, or Follow plugin declaration in OpenAgent
Settings; the override applies to every server in this package.
The English and Chinese display names follow the application language; the
package ID, commands, tool names and persisted state remain stable.

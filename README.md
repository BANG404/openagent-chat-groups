# OpenAgent Chat Groups

The standard Agent Plugin package for OpenAgent Chat Groups. The package carries
its portable identity, Skill, MCP server, and package-owned group state. The
trusted OpenAgent Runtime supplies only generic conversations, Agent turns,
cancellation, roles, events, and the plugin host bridge. The vendored
`bin/lib/openagent-host.mjs` client is the same capability interface used by
every plugin; member wake-ups call `agent.wake`.

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
`@role` mentions. Member buttons insert mentions. Plain text is rendered with
preserved line breaks; message content never becomes executable HTML.
The application selects the owning package and supplies workspace and locale;
the frame receives no bridge credential or conversation transcript. Drafts are
kept per group while switching the picker and live locale/theme changes preserve
input. Failed requests keep the draft and expose Refresh for retry.
Older hosts without `tool_calls` support show an update-required message.
No package-state migration is required. Existing `PLUGIN_DATA/chat-groups.json`
remains the source of truth. Install this package directory again to activate its
new sidebar entry; source changes do not update an already installed copy.

## Message policies

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

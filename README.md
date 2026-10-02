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

## Message policies

This package declares none. The Runtime keeps the `chat_group_mention` entry
only for legacy checkpoint compatibility; new Chat Groups events use the
plugin's generic event and MCP contract. A policy declared here would be namespaced to `plugin:chat-groups:<tag>`, which
belongs to messages this package's own automation would print; this package
ships no automation, so it could never take effect and would only add a second
entry to the plugin card's policy count.

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

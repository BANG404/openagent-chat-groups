# OpenAgent Chat Groups

The standard Agent Plugin package for OpenAgent Chat Groups. The package carries
its portable identity, Skill, MCP server, and package-owned group state. The
trusted OpenAgent Runtime supplies only generic conversations, Agent turns,
cancellation, roles, events, and the plugin host bridge.

Install the package from this repository through **Settings -> Plugins ->
Install**, or subscribe to the GitHub repository in an OpenAgent build that
ships the Chat Groups Runtime binding.

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

The package follows the portable Agent Plugins 1.0.0 format and the
`extensions.openagent.runtime` binding defined by OpenAgent.

## License

MIT

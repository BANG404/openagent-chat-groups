# OpenAgent Chat Groups

The standard Agent Plugin package for OpenAgent Chat Groups. Chat Groups is a
Runtime-backed plugin: the package carries its portable identity, its Skill, and
its subscription repository, while the trusted OpenAgent Runtime owns durable
group state, tool execution, and the audience of every message it emits.

Install the package from this repository through **Settings -> Plugins ->
Install**, or subscribe to the GitHub repository in an OpenAgent build that
ships the Chat Groups Runtime binding.

## Message policies

This package declares none. The Runtime owns the `chat_group_mention` audience
in its own registration and applies it to the messages Chat Groups emits. A
policy declared here would be namespaced to `plugin:chat-groups:<tag>`, which
belongs to messages this package's own automation would print; this package
ships no automation, so it could never take effect and would only add a second
entry to the plugin card's policy count.

## Development

This repository ships no scripts: validate the package with the validator from
an [OpenAgent Plugin Kit](https://github.com/BANG404/openagent-plugin-kit)
checkout, pointing at this directory.

```bash
bun <plugin-kit>/scripts/validate-plugin.mjs .
```

The package follows the portable Agent Plugins 1.0.0 format and the
`extensions.openagent.runtime` binding defined by OpenAgent.

## License

MIT

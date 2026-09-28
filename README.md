# OpenAgent Chat Groups

The standard Agent Plugin package for OpenAgent Chat Groups. Chat Groups is a
Runtime-backed plugin: the package declares its portable identity, capability
surface, checkpoint message policy, and subscription repository while the
trusted OpenAgent Runtime owns durable group state and tool execution.

Install the package from this repository through **Settings -> Plugins ->
Install**, or subscribe to the GitHub repository in an OpenAgent build that
ships the Chat Groups Runtime binding.

## Development

Validate the package with the OpenAgent Plugin Kit:

```bash
bun scripts/validate-plugin.mjs .
```

The package follows the portable Agent Plugins 1.0.0 format and the
`extensions.openagent.runtime` binding defined by OpenAgent.

## License

MIT

# ai-hub-agent-trade contributor rules

- Keep all user-facing text and Skill content in English.
- Never log, serialize, or commit API keys, secret keys, passphrases, or credential references.
- Keep CLI, MCP, and Skills within the spot-only scope documented in `context/PROJECT_OVERVIEW.md`.
- All state-changing capabilities must use the shared prepare/confirm flow in Core.
- Do not hard-code an OpenAPI domain. Always resolve it from a validated local profile.

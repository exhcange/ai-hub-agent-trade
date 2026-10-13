# ai-hub-agent-trade contributor rules

- Keep all user-facing text and Skill content in English.
- Never log, serialize, or commit API keys, secret keys, passphrases, or credential references.
- Keep CLI, MCP, and Skills within the spot scope and the approved Futures allowlist in `context/FUTURES_IMPLEMENTATION_DESIGN.md`; retain all other exclusions.
- All state-changing capabilities must use the shared prepare/confirm flow in Core.
- Do not hard-code an OpenAPI domain. Always resolve it from a validated local profile.

## Project context

- Before work on the planned contract extension, read `context/CONTRACT_EXTENSION_CONTEXT.md` for the linked code, usage guide, PRD, and user decisions. The user approved the consolidated design and authorized AI-Hub-only implementation. Do not modify the reference Futures server. Actual local profile changes require explicit user direction; the user authorized spot/futures local migration and installation on 2026-09-15.
- Use Chinese for explanations, requirements discussions, and progress messages to this user. Repository documentation, product text, and Skill content remain English.

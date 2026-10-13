# Contract extension: project memory

Recorded on 2026-09-14. This is a source-linked understanding record. The owner subsequently approved the consolidated design and explicitly authorized repository-only development; see ../docs/FUTURES_DELIVERY.md.

Latest handoff: read [Futures design handoff and API scope review](FUTURES_DESIGN_HANDOFF.md) before using the draft scope below. It records the user-supplied published API, the verified 25 + 3 operation inventory, inclusion of four sensitive settings writes, exclusion of ticker_all, reported profile routing, and C01-C19 design history. These later scope decisions supersede earlier draft uncertainties; the subsequent explicit development approval supplies implementation authority.

Latest consolidated proposal: [Futures implementation design](FUTURES_IMPLEMENTATION_DESIGN.md). C02-C19 directions are approved; the final design and repository-only development are now approved. Delivery changes only AI Hub; Futures code is a read-only reference and frontend Skill display belongs to the spot team.

## User direction and working agreement

- Conditional and TP/SL orders are submitted with trigger prices to the exchange after confirmation. The exchange monitors and triggers them. No Agent price-watching or delayed client-side order submission is intended.

- Latest routing decision: the future implementation uses fixed profile names `spot` (product `spot`) and `futures` (product `futures`). This supersedes the earlier smoke/default routing context. C07 approves dual balance queries with separate display and no cross-product totals; see the handoff for migration questions and decision status.

- The user identified this repository as the implementation home for future contract functionality, built on the existing spot foundation. Do not treat choosing a different implementation repository as an unresolved product question.
- The original context-gathering request authorized reading and recording only. The later explicit approval authorizes implementing the approved extension in AI Hub. Publishing, actual profile migration and real exchange writes remain separate activities.
- Communicate explanations, requirements discussions, and progress to the user in Chinese. Keep repository documentation, Skill content, and product text in English under the existing contributor rules unless a later scoped instruction changes that.
- Preserve existing spot behavior. The original spot-only rules describe the baseline; scope documents and checks are now extended only for the approved Futures allowlist.

## Sources and how they relate

1. Implementation: https://github.com/exhcange/ai-hub-agent-trade — this local checkout, version 0.1.20 at commit `d670b5eb1c7d7a1a740eb92a2d10382779077959` when reviewed. Local source was inspected; remote HEAD parity was not verified.
2. Usage guide: https://exchangedocsv2.gitbook.io/aihub?fallback=true — installation, profiles, CLI, MCP, Skills, and confirmation workflows. The documentation index is https://exchangedocsv2.gitbook.io/aihub/llms.txt. All seven English sections were read earlier in this task; MCP, CLI, Skills, and Security were fetched again on 2026-09-14.
3. Requirements: [Contract Skill PRD](</Users/admin/futures-project/futures-project/requirements/2026/2026-09/0901 AI Agent/AI Agent.md>) — V1.0, dated 2026-08-24, status pending review. Its six adjacent PC/H5 prototype images were inspected. This is an external local reference and may not exist on another machine. The project is not `/Users/admin/IdeaProjects/chainup-futures`.

Use code to establish current behavior, the guide to understand the user journey, and the PRD plus subsequent user decisions to establish intended changes. Neither an outdated guide nor a prototype command establishes an implemented API contract. Exact exchange API paths, authentication, parameters, units, enums, and errors require the final published user OpenAPI specification before implementation.

## Existing architecture and reusable foundation

| Area | Source | Current role / extension relevance |
| --- | --- | --- |
| Core tool definitions | `packages/core/src/tools/tool-spec.ts`, `tool-registry.ts` | Shared schema, CLI path, public/signed access, read/write classification, validation, handlers, normalization, and preview metadata. CLI and MCP share this registry. Current module types are spot-specific. |
| API and context | `packages/core/src/openapi.ts`, `tools/execution-context.ts`, `config.ts` | Context currently constructs `AiHubSpotApi` from a validated tenant profile. Contract API integration must account for this concrete type and establish endpoint/auth compatibility rather than assume it. Never hard-code a tenant domain. |
| Writes | `packages/core/src/tools/write-executor.ts`, `confirmation.ts` | Shared prepare/confirm, five-minute single-use confirmation bound to profile/configuration/credential versions, audit events, and uncertain-result tracking. Preparation can perform read preflight but must not submit the trading write. |
| Uncertain outcomes | `tools/write-executor.ts`, `unresolved-write.ts` | Existing automatic read-only order reconciliation is restricted to named spot-order tools. Contract reconciliation cannot be assumed to work without extension. Never blindly retry uncertain writes. |
| CLI | `packages/cli/src/index.ts` | `ai-hub` structured commands, profile selection, local capabilities, previews, and separate `confirm`. |
| Natural-language shortcut | `packages/cli/src/fast.ts`, `packages/core/src/fast-router.ts` | `aihub` deterministically routes bounded balance/price/open-order queries and renders results directly. Other requests can fall back to an isolated Agent. Contract requests must not accidentally route to spot tools. |
| MCP | `packages/mcp/src/server.ts`, `index.ts`, Core `setup.ts` | Local stdio tools generated from the registry; read-only mode omits write previews and confirmation. Client setup shares local profiles. |
| Skills | `skills/ai-hub-spot*/`, `skills/_shared/` | Router and domain guidance; MCP first, CLI fallback, focused references, explicit units, bounded reads, new-message confirmation. |
| Validation | `packages/core/test/`, CLI/MCP tests, `scripts/check-denylist.mjs` | Existing schema/intent/Skill/confirmation tests and release checks must retain spot regression coverage. The denylist currently excludes the word `futures` from packages/Skills; revisit intentionally with approved scope, not by deleting protections indiscriminately. |

Current isolated/cross margin tools are spot margin, not perpetual or other derivatives tools. Their rejection of explicit leverage multipliers must not be globally removed to add contracts. Wallet account type `5` already represents derivatives and `2` represents isolated spot margin; transfer support does not imply contract order support.

## Output consistency: context from the user's earlier question

- Core normalizes balance data into asset, available, frozen, and total fields; the default balance overview is non-zero and bounded.
- MCP reads return the same discriminated JSON envelope in text and structured content. This standardizes tool output, not the model's final prose.
- The `aihub` deterministic fast path uses code templates and may bypass an Agent entirely.
- Skills constrain selection and workflow but currently do not require a rigid final balance table. The user's other session was not inspected, so its precise route is unknown.
- The PRD requests safe, structured, relevant results, but does not define strict presentation templates. Do not treat the earlier explanation as a user-approved requirement to build new renderers.

## Planned contract capability scope from the PRD

Proposed names, still subject to PRD review:

| Skill | Role |
| --- | --- |
| `ai-hub-contract` | Intent routing across contract capabilities |
| `ai-hub-contract-common` | Contract discovery/rules, ticker, index/mark price, depth, trades, candles |
| `ai-hub-contract-account` | Equity, available/frozen funds, margin, current positions |
| `ai-hub-contract-order` | Open/history/detail/fill queries; conditional-order queries if published |
| `ai-hub-contract-trade` | Supported market/limit orders, conditional orders if published, single/batch/all cancellation |
| `ai-hub-contract-transfer` | Transferable assets, spot-to-contract and reverse transfers, history |

Only officially released public user OpenAPI capabilities qualify. Exclude internal, market-maker-only, Robot, KOL, Copy, Grid, copy-trading, and strategy-specific interfaces. Do not add underlying exchange functionality merely to satisfy a suggested Skill example.

Account and position guidance is combined by default. Separate buy/sell side from open/close intent and position mode. Validate contract identifiers, settlement/margin asset, quantity units, price/trigger price, and API-supported modes. Do not copy spot market-buy quote-amount semantics into contract orders without verifying their units, lot sizes, and contract multipliers. Reading leverage is not authorization to implement leverage-setting operations.

Lists require bounded pagination. CLI requests carry an explicit profile; the PRD requires asking when multiple profiles exist and none is selected. Do not infer a tenant or a required trading parameter.

Write previews must disclose the relevant profile, instrument/asset, side, open/close intent, type, quantity/amount and units, price/trigger, order scope, transfer direction, and expected request count. A fresh explicit user message is required after preview. Changed parameters require a fresh preview; the PRD also requires invalidation of the previous confirmation, which must be checked explicitly against the implementation. Batch limits and per-item summaries are mandatory; do not automatically split oversized batches. Query status after an uncertain write. The host/Agent must enforce message provenance; a text field alone cannot prove a fresh user confirmation.

## Distribution and website work

- Skills are intended to share the public `exhcange/ai-hub-agent-skills` repository and installation command `npx skills add exhcange/ai-hub-agent-skills`. That distribution repository is distinct from this implementation repository; its synchronization/release mechanism has not been verified.
- Installing Skills and registering MCP remain separate operations.
- Homepage: three representative contract cards (market, account/positions, trade) below the existing spot cards and above FAQ; show only published entries.
- Plaza: retain spot and include all published contract Skills, stable server ordering, six per PC page, H5 append up to six via load-more. An inclusive dataset does not necessarily place contracts on the first page.
- Details: real directory IDs, matching title/version/content/links, compatible unavailable/error states. Download counts represent successful link-return events, not completed downloads.
- Publishing must avoid visible cards with missing details. No unpublished fallback cards; preserve successful spot content when a separate contract request fails.
- The PRD assigns contract API/CLI/Skill and publishing data to the contract team; website changes to the spot team; list/detail metadata to the server team. Do not assume the website implementation lives in this Node.js tool repository or start UI work from this memory alone.

## Known guide drift and unresolved design details

Verified guide drift relative to the reviewed checkout:

- MCP `default` and `full` expose the same registry, while the guide describes different capability sets.
- `compact` and `compat` have the same read envelope, while the guide describes different text payloads.
- Registration uses `aihub` / `aihub-<profile>`, not the older documented server name.
- Local Skills prefer MCP with CLI fallback, while the guide says Skills execute through CLI.
- OpenClaw setup, persistent setup read-only examples, and newer CLI capabilities are not fully covered; the CLI guide has a broken Security link.

Items to resolve during later design, not reasons to start implementation now:

1. Final published contract API allowlist and exact endpoint/authentication/field contracts; conditional-order availability and batch limits.
2. How contract API adapters and configuration fit the existing Core within this repository; package boundaries and release compatibility remain design choices.
3. Explicit contract MCP deliverables: the PRD emphasizes CLI/Skills, while the H5 prototype says MCP First.
4. Final tool/command names. H5 `order execute` and `transfer execute` examples are prototypes, not permission to bypass shared confirmation.
5. The PC contract detail prototype still contains spot-common identifiers/content; replace with real contract metadata when implementing the page.
6. Clarify first-page contract discoverability versus inclusive paginated results; the H5 long image does not establish initial-load behavior.
7. Preserve a distinction between observed implementation, draft requirements, user decisions, and recommendations. Re-read sources and changed files when development resumes.

## Local installation update — 2026-09-15

The owner authorized local migration and a combined installation guide. Migrated smoke to spot and default to futures, preserving endpoint/credential fields; registered two read-only Codex MCP servers and installed twelve local Skills. This later authorization supersedes the earlier restriction on actual profile changes for this specific migration. Product names are spot/futures (sopt was treated as the previously corrected typo). No exchange queries or trades were executed. The current running conversation may retain old tools until client reload. See ../docs/INSTALL_SPOT_FUTURES.zh-CN.md.

## Corrected Futures endpoint — 2026-09-15

After a public time request returned 10002 (not logged in), the owner confirmed that the former futuresappapi endpoint was their configuration mistake. The authorized Futures OpenAPI endpoint is https://futuresopenapi.coobit.vip. The local futures profile was updated through ConfigStore; endpoint-bound credentials were cleared by the existing policy. Spot configuration was unchanged. Public ping/time verification is authorized; this does not authorize signed account queries or trades. Executable code continues to resolve the endpoint from the profile.

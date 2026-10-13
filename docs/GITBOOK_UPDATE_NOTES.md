# GitBook update review notes

This local draft supplements the existing 14 English/Chinese GitBook pages fetched from https://exchangedocsv2.gitbook.io/aihub. It is not a personal migration guide. The live GitBook site has not been modified.

## Reader journey

npm already installed -> install CLI/MCP npm packages -> create spot/futures profiles -> enter credentials locally -> test public endpoints -> register both products in the selected MCP client -> install all twelve Skills -> use existing spot workflows or new Futures workflows.

## Changes to the original pages

- Preserve the original seven-chapter structure, existing spot examples, wallet/account workflows and confirmation instructions.
- Replace the example spot Profile name with spot and add product=futures configuration and Futures examples.
- Register both products for each supported client example; explain optional read-only mode without imposing the developer's previous permissions on new users.
- Install both sets of Skills from the implementation repository, which now contains all twelve Skills, rather than assuming the separate spot Skills repository has also been updated.
- Expand Futures CLI coverage to public markets, assets/positions, PnL/transactions, ordinary and trigger order queries, all ten write operations, both transfer directions, parameter tables and pagination rules.
- Document all sixteen Futures read tools and ten prepare tools in MCP, with inputs, result handling and spot-side transfer routing.
- Add scenario-based prompts for all six Futures Skills and detailed preview, prerequisite, timeout and account-pairing guidance.
- Add fourteen Futures FAQs, while preserving the existing spot FAQ entries.
- Correct existing toolset/response-mode descriptions to match current code, and repair three broken security links found in the original pages.
- Remove personal migration history, private machine paths, source-build instructions and local installer scripts from the reader guide.

## Publication prerequisites for the maintainer

Before publishing this reader guide, publish CLI and MCP npm packages that actually contain the Futures extension, and ensure the GitHub Skills source contains all twelve corresponding Skills. A GitHub merge alone does not update npm. This is a release prerequisite for maintainers, not a new-user setup step. Do not claim the current public npm release was checked or changed by this documentation edit.

No npm packages, GitHub branches, credentials or installed client settings were changed in this documentation task.

## Local documentation validation

- Validated 98 CLI examples against the current argument parser and Core schemas without calling handlers; checked four local operation-status examples separately.
- Confirmed CLI example coverage for all 26 Futures semantic operations and the same 26 MCP tool names in each language; validated both MCP order-input examples.
- Checked local links, Markdown tables, code fences, GitBook blocks, bilingual tool-name parity and exact ZIP/chapter parity.
- No exchange requests were made. Example validation establishes syntax and schema compatibility, not live acceptance of the illustrative prices, quantities or account prerequisites.

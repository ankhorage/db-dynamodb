# AGENTS.md

<!-- This file is managed by @ankhorage/devtools. -->

## Repository

Package: `@ankhorage/db-dynamodb`

Provider-neutral DynamoDB adapter for `@ankhorage/contracts/db`.

## Current architecture only

Only the current Ankhorage architecture is valid. Do not add compatibility aliases, shims, dual paths, or sibling-source imports.

## Standalone contract

This package is independently installable and usable with declared dependencies and explicit configuration only. It must not use sibling source, `workspace:`, `file:`, or `link:` dependencies.

## Required repository instructions

Before changing files, read this file, inspect `.agents/skills/`, and load `ankhorage-coding-rules`, `ankhorage-project-structure`, and every relevant local skill. Generated README and Paradox output are release artifacts: do not edit or commit them in feature pull requests.

## Pull requests

Before creating a pull request run `bun run build`, `bun run check-types`, `bun run lint`, `bun run knip:check`, `bun run changeset`, and `bun run format` in order. Run Changesets only for release-impacting work.

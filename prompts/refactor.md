---
description: Dispatch refactor specialists in parallel, then triage proposals through an isolated aggregator
argument-hint: "<TARGET -- file path, diff range, branch, PR ref, or empty for working tree>"
---

Propose behavior-preserving refactorings for: ${1:-the current working tree (diff against HEAD)}

## Step 1 — Resolve the target (read-only)

- Empty target → use the working-tree diff: `git diff --name-only HEAD` (repo root via `git rev-parse --show-toplevel`).
- Path-like → confirm it exists (`test -e`).
- `<ref>..<ref>` or `HEAD~N..HEAD` → confirm both refs with `git rev-parse`.
- Single branch → `git rev-parse --verify`.
- If the target cannot be validated, ask one clarification and stop.

Gather dispatch context: exact target, changed file list, repo root, branch, latest commit, plus any qualifiers I attached (e.g. "smells only", "no performance class").

## Step 2 — Dispatch refactorers in parallel

Call the `scout` tool ONCE with four agents, `profile` set for each, **before reading any result**:

1. `design-refactorer` — structural/architecture-level proposals.
2. `type-refactorer` — type-safety and expressiveness proposals.
3. `perf-refactorer` — performance and allocation proposals.
4. `smell-refactorer` — local readability/duplication/complexity proposals.

Each objective must be self-contained (target, class, repo context, changed files, constraints) and state that output must follow the refactor-contract format. Use `digestWords: 400`.

## Step 3 — Isolated triage

Call `scout` again with one agent, `profile: refactor-triage`, `digestWords: 1200`. The objective must embed: the target + repo context, then **all four proposal reports verbatim**. The triage persona has no tools: it deduplicates, applies priority rules, orders by dependency, and computes the final recommendation per the refactor-contract skill.

## Step 4 — Proposals, never silent edits

Present the triage report verbatim with the priority-ordered proposal list. Ask which proposals to apply. Anything you apply afterwards flows through the normal approval gates and the verification loop (checks must pass before settling). Do not refactor anything until I approve.

---
description: Dispatch bug-hunter specialists in parallel, then triage findings through an isolated aggregator
argument-hint: "<TARGET -- file path, diff range, branch, PR ref, or empty for working tree>"
---

Hunt for latent bugs in: ${1:-the current working tree (diff against HEAD)}

## Step 1 — Resolve the target (read-only)

- Empty target → use the working-tree diff: `git diff --name-only HEAD` (repo root via `git rev-parse --show-toplevel`).
- Path-like → confirm it exists (`test -e`).
- `<ref>..<ref>` or `HEAD~N..HEAD` → confirm both refs with `git rev-parse`.
- Single branch → `git rev-parse --verify`.
- If the target cannot be validated, ask one clarification and stop.

Gather dispatch context: exact target, changed file list, repo root, branch, latest commit (`git log -1 --format='%h %s'`), plus any qualifiers I attached (e.g. "concurrency only", "ignore generated files").

## Step 2 — Dispatch hunters in parallel

Call the `scout` tool ONCE with four agents, `profile` set for each, **before reading any result**:

1. `logic-hunter` — objective: hunt <target> for logic/type/contract bugs; hints: changed files + repo context.
2. `concurrency-hunter` — same target, concurrency/async class.
3. `resource-hunter` — same target, resource/scale class.
4. `boundary-hunter` — same target, boundary/edge-case class.

Each objective must be self-contained (target, class, repo context, changed files, constraints). Use `digestWords: 400`. If I named specific classes, dispatch only those hunters plus triage in step 3.

## Step 3 — Isolated triage

Call `scout` again with one agent, `profile: bug-triage`, `digestWords: 1200`, `tools`-free persona. The objective must embed: the target + repo context, then **all four hunter reports verbatim**. The triage agent has no tools and works solely from that material (dedup, filter rules, severity elevation, verdict per the finding-contract skill).

## Step 4 — Verdict

Present the triage report to me verbatim, then state the verdict: CLEAN / SHIP WITH FOLLOWUPS / DO NOT SHIP. If findings include a fix plan, ask whether to apply it — any fixes you apply afterwards flow through the normal approval gates and verification loop. Do not fix anything until I approve.

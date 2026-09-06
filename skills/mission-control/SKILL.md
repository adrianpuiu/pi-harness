---
name: mission-control
description: Maintain .harness/MISSION.md as the single source of truth for the current goal and its checklist, with a recitation protocol to defeat goal drift on long tasks. Use whenever starting a multi-step task, after /plan approval, or when the user changes direction mid-task.
---

# Mission Control

The context window is a cache, not memory. Attention decays over long tasks
(lost-in-the-middle), so the plan must be *recited* back into recent context —
this file is the recitation target, and the mission widget reads it live.

## Protocol

1. **Start of a multi-step task:** create `.harness/MISSION.md`:

   ```markdown
   # <one-line goal, user's words>
   Constraints: <any stated constraints, one line each>

   - [ ] step one (concrete, verifiable)
   - [ ] step two
   ```

   Keep it under 15 items. Split larger missions: link a topic file per phase.
   For feature-driven long tasks (apps/tools), prefer `/longrun <goal>` — it
   scaffolds MISSION.md **plus** a `.harness/features.json` ledger
   (`[{category, description, steps[], passes}]`) per the long-running-agent
   pattern (Anthropic, Nov 2025).

## Ledger rules (enforced by the deterministic ledger guard)

The ledger guard extension validates MISSION.md / features.json edits:

- Checklist ticks may only close: `- [ ]` → `- [x]`. Un-ticking, removing,
  or rewriting an *unfinished* step triggers a correction steer — progress
  must stay honest (a rewritten "easier" step is the quietest fake
  progress there is).
- If the course genuinely changed, ask the user to approve rewriting the
  ledger explicitly, then do it in one edit.
- features.json entries are immutable except `passes` (false→true, after
  careful testing). Removing or editing entries is unacceptable — models
  rewrite Markdown ledgers too easily; JSON + this guard is what survives
  (the reason Anthropic's harness uses JSON for its feature list).

2. **After completing each step:** tick it immediately (`- [x]`). Ticking is
   the progress bar — never batch ticks at the end.

3. **Recitation (every ~5 tool calls):** re-read MISSION.md, then restate the
   remaining steps in one line in your working notes before continuing.

4. **On interruption or failure:** assume context death at any moment. Any
   progress not ticked in MISSION.md is lost. Record before exploring.

5. **On course change:** rewrite affected steps; never leave stale steps —
   a wrong plan recited is worse than no plan.

## Anti-patterns

- Todos scattered across chat or separate files — the widget reads exactly
  `.harness/MISSION.md`.
- Vague steps ("improve code") — every step must be verifiable so ticking it
  is a fact, not a mood.

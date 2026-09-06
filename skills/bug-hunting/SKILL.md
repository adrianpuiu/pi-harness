---
name: bug-hunting
description: >-
    Use when proactively hunting for latent bugs in code through static analysis: reading code paths to find defects before they manifest in production. A seven-phase methodology from mapping the target to reporting findings with evidence-backed reproduction paths. Triggers: Trigger for "find bugs", "hunt for issues", "proactively check for defects", "static analysis", "what could go wrong", "are there any latent bugs", "pre-ship bug check", "look for logic errors", "review for correctness", or any task where the goal is discovering bugs by reading code rather than running it.
---

# Bug-Hunting Methodology — Static Analysis

## The Iron Law

> NO FINDING WITHOUT A REPRODUCTION PATH. NO SEVERITY WITHOUT BLAST RADIUS.

A latent bug claim requires a deterministic path to failure — not a suspicion,
not a pattern match, not a heuristic. If you cannot construct a concrete
entry-point → trigger → failing-line chain, you do not have a finding.

This law has two parts. The first ("no finding without a Repro") prevents
speculative noise. The second ("no severity without blast radius") prevents
under-rating a bug that is trivial in isolation but catastrophic at scale.

## Static Hunting vs Live Debugging

Live debugging *executes* code to observe a failure. Static hunting *reads*
code to construct the path a failure would take before it fires.

The methodology adapts the classic debug cycle for the read-only case:

| Live debugging | Static hunting equivalent |
|----------------|--------------------------|
| Reproduce the failure | Construct the Repro path |
| Isolate the component | Map the blast radius |
| Hypothesize the cause | Hypothesize failure (Phase 3) |
| Test the hypothesis | Pin the Trigger (Phase 4) |
| Root-cause the defect | Root cause, not symptom (Phase 5) |
| Verify the fix | Calibrate severity (Phase 6) |

You cannot run the code. You can read every code path. The discipline is the
same; the evidence is the source text, not a runtime trace.

## Phase 1 — Map the Target

1. **Resolve the scope**: diff, file, range, branch, or module. Be precise
   about what is in scope and what is not.
2. **Identify entry points**: public functions, HTTP handlers, CLI commands,
   event listeners, scheduled jobs, and any other reachable boundary where
   external input enters the system.
3. **Identify high-traffic paths**: code called on every request, in tight
   loops, or on the critical data path. Bugs here have the highest blast radius.
4. **Probe the knowledge graph**: `list_graph_stats_tool` to confirm graph
   availability; `get_impact_radius_tool` on changed or suspect symbols to
   understand blast radius before starting to hunt.

Do not hunt blind. A finding on a dead-code path has zero blast radius and
should be a SUGGESTION at most.

## Phase 2 — Walk Every Path

For each entry point, walk:

- Every **conditional branch**: `if`/`elif`/`else`, `match`/`case`, ternary,
  short-circuit (`and`/`or`).
- Every **exception handler**: `except`/`catch`/`rescue`, `finally`/`defer`.
- Every **early exit**: `return`, `break`, `continue`, `raise`.
- Every **`await` point** and thread-boundary crossing (where control may
  interleave with another coroutine or thread).
- Every **generator `yield`** and the state of local variables across it.
- **Boundary inputs** at each parameter: empty, single-element, maximum size,
  `None`/`null`/`undefined`/`0`, negative, Unicode edge, timezone edge,
  malformed.

Do not walk only the happy path. Bugs live in the branches you skipped.

## Phase 3 — Hypothesize Failure

For each suspicious path, form a **falsifiable hypothesis**:

> "If input/interleaving X, then failure Y at line Z."

A hypothesis without a concrete X is a note to self, not a finding.
"This could fail under load" is not a hypothesis — it is a suspicion.
Keep reading until you can name X, or downgrade to below the emit threshold.

Three-part structure of a sound hypothesis:

1. **Condition (X)**: what must be true for the failure to occur (a specific
   input value, a specific interleaving of threads, a specific size of data).
2. **Failure (Y)**: what goes wrong (exception, wrong return value, corrupted
   state, hang, OOM).
3. **Location (Z)**: the exact file and line where the failure occurs.

## Phase 4 — Construct the Reproduction

Pin the exact trigger using the tightest applicable Repro form:

- **Input-driven**: `Call f(x=-1) → x+1=0 @L42 → ZeroDivisionError`.
  Name the entry point, the exact argument values, and the line-by-line chain
  to failure.
- **Interleaving-driven**: express the interleaving as an ordered step list.
  `Thread A reads balance=100 @L10, Thread B reads balance=100 @L10,
  Thread A writes 150 @L12, Thread B writes 70 @L12 → lost update`.
- **Scale-driven**: state the growth function.
  `Each request appends to module-level _cache @L20 with no eviction
  → ~1 KB per item × 1M requests → 1 GB → OOM`.
- **State-driven**: state the exact edge value.
  `Empty list input → max(items) @L8 → ValueError`.

If you cannot pin the trigger, confidence is **capped at 79** (per the
`finding-contract` confidence rubric). The finding is still worth emitting for
BLOCKER candidates. For SUGGESTION/IMPORTANT, either keep digging or omit.

## Phase 5 — Root Cause, Not Symptom

Trace the failure to the defect that causes it. The symptom is what you
observe; the root cause is the code decision that makes it possible.

- A `None` dereference is a symptom; the root cause is that a function returns
  `None` when the caller assumes it always returns `T`.
- An `IndexError` is a symptom; the root cause is an off-by-one in the loop
  bound.
- An OOM is a symptom; the root cause is an unbounded cache with no eviction
  policy.

If the same root cause manifests at multiple call sites, report the root cause
**once** and list all affected sites — do not emit N redundant symptom reports.

Ask: "Why does the code make the wrong decision here?" not just "What happens
when it breaks?"

## Phase 6 — Calibrate Severity

Apply the severity rubric from `finding-contract` in order:

1. **Is the failure path reachable?** If the entry point is dead code or gated
   behind a flag that is never set, severity is at most SUGGESTION.
2. **What is the consequence?** Crash/corrupt/lose/hang/leak → BLOCKER
   candidate. Latent risk under non-default conditions → IMPORTANT. Low-
   likelihood edge → SUGGESTION.
3. **What is the blast radius?** Query `get_impact_radius_tool`. Apply the
   elevation rule: IMPORTANT with 50+ transitive importers → BLOCKER.
4. **Degrade gracefully** if no graph is built: base severity on code analysis
   alone and write `Blast radius: graph unavailable` in the finding.

## Phase 7 — Report

Produce the per-hunter report in the exact template from `finding-contract`.

**Coverage section discipline**: state what code paths you walked AND what you
deliberately did not examine (generated code, vendored dependencies, files
outside the declared scope). A Coverage section that claims completeness it did
not achieve is worse than a narrow, honest one.

**One finding per root cause**: group all symptoms of the same root cause into
one finding. List all affected `file:line` locations in the Bug or Consequence
field.

**Relay findings verbatim to triage**: the bug-triage agent aggregates; do not
pre-filter or pre-summarize. Emit everything above the confidence threshold and
let triage apply the dedup and filter rules.

## Anti-Patterns

**No speculative findings.** "This might be slow under load" without a growth
function is not a finding. Write the Repro first; if you cannot, do not emit.

**No security-vuln hunting.** CVE-class issues (authentication bypass, SQL
injection as a privilege escalation vector, hardcoded secrets, session
hijacking) are out of scope for this methodology. They belong in a dedicated
security plugin. You may note "untrusted input causes incorrect behavior (crash,
wrong result)" as a boundary-class correctness finding; frame it that way.

**No editing code.** The hunters do not have Write or Edit tools. Put the
suggested fix in the `Fix` field of the finding; do not attempt to implement.

**No narrating your thought process** in the report. The report is for the
reader. State results; do not transcribe your analysis.

**No duplicate symptom spam.** One root cause → one finding. List all affected
sites in the finding; do not emit one finding per call site.

**No confidence inflation.** If you cannot pin the trigger, cap confidence at
79. If the blast radius is unavailable, state it. Never upgrade a 65-confidence
hunch to 90 because the bug "feels important."

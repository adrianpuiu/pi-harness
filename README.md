# pi-harness

A production **harness layer** for the [pi coding agent](https://pi.dev),
implementing the reference architecture from *Harness Engineering: A Deep
Technical Research Report* — governance gates, verification loops, a runtime
context compiler, and a calm, psychology-informed TUI — as a single
installable pi package.

> The model is stateless; the harness is the substrate of state.
> This package is that substrate, with a frontend designed around how
> humans actually maintain attention and trust. See [DESIGN.md](DESIGN.md)
> and the [architecture diagrams](docs/architecture.html).

## Install

```bash
# from a local checkout (project-local install)
cd your-project
pi install -l /path/to/pi-harness

# or from git once pushed
pi install git:github.com/adrianpuiu/pi-harness@v0.1.0   # pinned ref = provenance
```

Then pick the theme: `/settings` → theme `calm-focus`, or one-off:
`pi --use-theme calm-focus`.

## What you get

| Layer (report §5.1) | Component | File |
|---|---|---|
| L2 Execution | Output truncation, gate hook points | (pi core) |
| L3 Capability | **Parallel scouts with specialist profiles** — vendored hyperpowers hunters/refactorers/triage (read-only personas + `tools: none` aggregators), roster via `/scouts` | `extensions/scouts.ts`, `agents/` |
| L6 Knowledge | 12 vendored prose skills: hunt/refactor methodology, finding/refactor contracts, 8 taxonomies | `skills/` |
| L5 Orchestration | `/hunt`, `/refactor` — parallel dispatch → isolated triage → verdict | `prompts/` |
| L4 State | Mission file + memory protocol skills | `skills/` |
| L7 Governance | deny → ask → allow gates, protected paths, audit trail | `extensions/governance.ts` |
| L4/L7 | Verification loop (Stop-hook analog, max 3 fix cycles; `-p`/CI sessions record the verdict in the transcript instead of steering) | `extensions/verify-gate.ts` |
| L4 Context | Runtime context compiler: restorable pruning + decision-preserving compaction | `extensions/context-compiler.ts` |
| Frontend | Header, footer, mission widget, run summary, audit & verify cards, calm theme | `extensions/ui.ts`, `themes/calm-focus.json` |

## Commands & entry points

| Command | What it does |
|---|---|
| `/plan` | Plan-then-approve: drafts `.harness/MISSION.md`, waits for your approval |
| `/policy` | Print the governance policy summary (deny/ask/allow counts) |
| `/verify` | Run the verification check now (`.harness/verify.sh` or `npm test`) |
| `scout` tool | 1–5 parallel agents; profiles via `agents/` (hunters, refactorers, tools:none triage); digests in context, artifacts in `.harness/scouts/` |
| `/scouts` | List the specialist roster with tool policies |
| `/hunt <target>` | Orchestrator: 4 hunter profiles in parallel → isolated `bug-triage` → CLEAN / SHIP WITH FOLLOWUPS / DO NOT SHIP |
| `/refactor <target>` | Orchestrator: 4 refactorer profiles in parallel → isolated `refactor-triage` → priority-ordered proposals (apply only on approval) |
| `/mission` | Mission status digest |
| auto | Approval overlay on risky actions (auto-deny after 45 s) |
| auto | Summary card after every run; auto-verify after file-mutating runs |

## The `.harness/` directory

```
.harness/
├── MISSION.md        # goal + checklist (mission-control skill, read by the widget)
├── memories/         # cross-session memory (memory-protocol skill)
│   ├── index.md      # tiny index
│   └── <topic>.md
├── scouts/           # full scout outputs (newest 100 kept)
└── verify.sh         # optional: becomes your verification gate (exit 0 = green)
                      # (budget.json is optional too: {"maxCostUsd": 5} enables the governor —
                      #  80% of a ceiling steers a wrap-up, 100% aborts the run)
```

## Psychology, in one paragraph

The frontend applies **peak-end** (runs end on a quiet green summary),
**serial position** (identity at the top, state at the bottom), **cognitive
load limits** (≤4 footer chunks, detail behind expand), **goal-gradient +
Zeigarnik** (progress bar and next-open-step always visible), the **von
Restorff effect** (saturated color only for risk), **default bias/loss
aversion** (approvals auto-deny; allowing is explicit), **trust calibration**
(rules and payloads shown on every gate), and **predictable feedback**
(deterministic ✓/✗ after every mutation). Full map: [DESIGN.md](DESIGN.md).

## Type checking & tests

```bash
npm run typecheck   # npx tsc --noEmit (strict)
npm test            # 44 checks: governance classifier (38 cases incl.
                    # bypass regressions), render edges, context-compiler prune
```

`node_modules` symlinks resolve against the global pi installation
(see repo scaffold). Extensions run via pi's jiti loader — no build step.
The repo dogfoods its own verify gate: `npm test` is the discovery target
(`package.json scripts.test`).

## Themes

`calm-focus` (dark) and `calm-focus-light` share identical hue semantics —
one hue = one meaning holds across both variants, so switching appearance
never re-trains your color reflexes.



## Relationship to the report

Each component's header comment cites the report section it implements.
Maturity mapping: stock pi = L1; + this package = L2–L3 (engineered +
governed harness); agents authoring skills through `/plan` + gates = L4.

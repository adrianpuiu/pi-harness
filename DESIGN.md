# DESIGN.md — Human Psychology in the Harness Frontend

Every visual and interaction decision in this harness maps to a named
psychological principle. This document is the traceability layer: no
decoration exists without a reason.

Design stance: **the harness is a calm operating theater, not a slot machine.**
The model does the work; the interface's job is to keep the human's
attention budget spent on exactly the right things — the same "attention
budget" logic the report applies to the model's context window applies to
the operator's cognition.

## Principle → implementation map

| # | Principle | Research anchor | Where it lives | Expected effect |
|---|-----------|-----------------|----------------|-----------------|
| 1 | **Peak-end rule** | Kahneman et al., 1993 — memories of experiences are dominated by the peak and the *end* | `ui.ts` summary card appended at `agent_settled`; `verify-gate.ts` ends every mutating run on a green "checks green" card | Runs are remembered as competent and finished, not as tool noise |
| 2 | **Serial-position effect** | Murdock, 1962 — recall is best at start and end of a sequence | Header (start): identity + one hint. Footer (end): live state | Identity and state never compete with transcript content |
| 3 | **Cognitive load / Miller's 7±2** | Miller, 1956; Sweller's cognitive load theory | Footer carries ≤4 chunks (mission bar, counts, cache hit, cost). Detail behind expand (Ctrl+O), never default-on | Low extraneous load; the useful density stays scannable |
| 4 | **Goal-gradient effect** | Hull, 1932 — effort accelerates as a goal nears | Mission widget progress bar (▰▰▱▱▱) fed by ticked checklist steps | Visible nearness of completion pulls the agent (and operator) through the tail of long tasks |
| 5 | **Zeigarnik effect** | Zeigarnik, 1927 — unfinished tasks stay cognitively active | Widget persistently shows the *next open step* while any step is unticked | Open work is never forgotten mid-task; directly mitigates goal drift (report §4.6) |
| 6 | **Von Restorff isolation effect** | von Restorff, 1933 — the distinct item is remembered | Color economy: saturated red/amber/green are reserved for risk semantics (governance, verify). Everything else is muted blue-gray | When the dialog turns red, it is genuinely the only red thing on screen |
| 7 | **Default bias + loss aversion** | Kahneman & Tversky, 1979; Johnson & Goldstein, 2003 (opt-in vs opt-out) | Approval dialog auto-**denies** on timeout; allowing requires explicit "a", never reflex Enter | Irreversible actions fail safe; the default outcome is always the safe one |
| 8 | **Trust calibration (automation)** | Lee & See, 2004 — trust must match capability; opacity causes both over-trust and disuse | Dialogs show the matched rule + exact payload; audit cards record every gate decision in-transcript | Operators approve with understanding; audit builds justified, not blind, trust |
| 9 | **Predictable feedback vs variable reward** | Skinner's schedules — variable reinforcement heightens anxiety | Every mutation is followed by a deterministic ✓/✗ within a fixed budget (verify gate) | The system feels lawful; no slot-machine dopamine, no learned helplessness |
| 10 | **Processing fluency / aesthetic-usability** | Reber et al., 1998; Kurosu & Kashimura, 1995 | Breathing spinner (220 ms, low-arousal), aligned columns, quiet glyphs (▰▱ ◈ ⛨), consistent 1-hue-1-meaning palette | Perceived calm and competence; low-arousal motion does not spike vigilance |
| 11 | **Recitation as externalized working memory** | Report §7.3 (Manus `todo.md`); goal-drift failure mode | `mission-control` skill: tick steps immediately, re-read every ~5 tool calls | The plan keeps winning the battle for recent attention |
| 12 | **Implementation intentions** | Gollwitzer, 1999 — concrete if-then plans dramatically outperform vague goals | Mission steps must be "concrete, verifiable"; `/plan` template forces risks to be flagged before approval | Vague plans are rejected at the gate, not at the failure |

## Color semantics (one hue = one meaning)

| Hue | Meaning | Used by |
|-----|---------|---------|
| Soft blue `#7aa2f7` | System identity, working state | accent, wordmark, progress bar |
| Soft cyan `#7dcfff` | Tool titles, neutral structure | toolTitle, links, bullets |
| Green `#9ece6a` | Verified, done | success token, check cards, full bar |
| Amber `#e0af68` | Caution: reversible-but-needs-you | caution gate, warnings |
| Red `#f7768e` | Irreversible or failed | irreversible gate, failed checks |
| Violet `#bb9af7` | Intellect, headings | mdHeading, syntax keywords |
| Grays 238–245 | Structure, secondary text | borders, muted, dim |

Amber and red are *never* decorative. Their scarcity is the point.

## What is deliberately NOT here

- **No confetti, no celebration animations.** Peak-end is served by a quiet
  ✓ card; celebration would train the operator to distrust it.
- **No red badges for "working".** Arousal is reserved for genuine risk.
- **No always-on progress spinners in the footer.** The footer shows state,
  not motion; motion lives only in the working indicator.
- **No more than one modal decision at a time.** Serial approval dialogs
  produce approval fatigue → rubber-stamping (the failure mode report §10
  calls approval fatigue without sandboxing).

## Multi-agent UX (scouts)

Parallel read-only scouts apply the same attention economics to the
*coordinator model*: digests capped at ~300 words keep conclusions, not
exploration, in the parent window (report §8.2: artifact references over
transcript copies). For the human, scouts run concurrently and report
"2/3 done" the moment each lands — latency is experienced as progress,
not silence. A hard cap of 5 scouts keeps the choice space scannable
(Hick's law) and the 15× multi-agent token multiplier (report §9.1)
deliberate rather than accidental.

## Relationship to the research report

This frontend implements the report's oversight taxonomy (§10.6) and its
enforcement principle (§10.1: "governance lives in deterministic harness
code, advisory instructions never confer capability") at the level of
*human factors*: gates are psychology-aware because a gate that is annoying
gets disabled, and a gate that is invisible gets rubber-stamped. The design
target is **calibrated, low-effort oversight** — fast enough to keep, strict
enough to matter.

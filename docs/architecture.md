# pi-harness — architecture

> GitHub renders mermaid natively in Markdown. For the styled dark version, open `docs/architecture.html` locally (or the GitHub Pages URL once enabled).

## 1 · Component map

```mermaid
flowchart TB
    subgraph PI["pi runtime (loads package via settings.json)"]
        TUI["TUI session<br/>(interactive)"]
        PRINT["-p session<br/>(scripted / CI)"]
    end

    subgraph EXT["pi-harness extensions"]
        GOV["governance.ts<br/>tool_call gate"]
        VG["verify-gate.ts<br/>executable verification"]
        BG["budget-gate.ts<br/>spend governor (opt-in)"]
        LR["long-run.ts<br/>ritual + ledger guard"]
        SC["scouts.ts<br/>parallel read-only agents"]
        UI["ui.ts<br/>header / footer / cards"]
        CC["context-compiler.ts<br/>prune + compact prompts"]
        LIB["lib/constants · lib/render<br/>entry types · formatters"]
    end

    subgraph DISK[".harness/ (project-local state)"]
        MISSION["MISSION.md + features.json<br/>mission + feature ledger"]
        SCOUTS["scouts/*.md<br/>(cap 100, pid+seq names)"]
        VERIFYSH["verify.sh<br/>(optional check)"]
        MEM["memories/"]
        SESSION["session .jsonl<br/>harness.verify / audit / summary entries"]
    end

    subgraph PROFILES["inputs"]
        AGENTS["agents/*.md<br/>hunter / refactorer / triage personas"]
        SKILLS["skills/*/SKILL.md<br/>reference library"]
    end

    CHILDREN["scout children<br/>pi -p --no-extensions<br/>--tools read,grep,find,ls"]

    TUI -->|"every tool call"| GOV
    PRINT -->|"every tool call"| GOV
    GOV -->|"deny → block"| TUI
    GOV -->|"ask → approval dialog (TUI only)<br/>timeout = deny"| TUI
    GOV -->|"decision"| SESSION

    TUI -->|"write / edit runs"| VG
    PRINT -->|"write / edit runs"| VG
    VG -->|"mutated + agent_settled"| CHK{"check<br/>verify.sh ∨ npm test"}
    CHK -->|"green"| SESSION
    CHK -->|"red, TUI"| TUI
    CHK -->|"red, -p"| SESSION
    TUI -->|"/verify · /policy · /scouts · /mission"| EXT

    TUI -->|"session resume → orientation ritual"| LR
    LR -->|"ledger violations → correction steer"| TUI
    BG -->|"≥80% wrap-up · ≥100% abort"| SESSION
    TUI -->|"/longrun scaffolds mission + ledger"| LR

    SC -->|"spawns 1–5"| CHILDREN
    CHILDREN -->|"read personas"| AGENTS
    CHILDREN -->|"read on demand"| SKILLS
    SC -->|"digests → model<br/>full output"| SESSION
    SC -->|"artifacts"| SCOUTS

    UI -->|"footer: mission bar + stats"| MISSION
    UI -->|"renders entries as cards"| SESSION
    CC -->|"context event: prune stale bash output"| PI

    style GOV fill:#f9d71c,stroke:#333
    style VG fill:#90EE90,stroke:#333
    style CHK fill:#FFB347,stroke:#333
```

Every tool call — TUI or -p — passes governance first: deny
			blocks outright, ask renders the approval dialog in TUI (45 s timeout
			resolves to deny) or blocks with a reason in -p; every
			decision lands as a harness.audit entry. The UI layer is a
			pure consumer of MISSION.md and the session transcript.

## 2 · Data flow — one mutating turn

```mermaid
sequenceDiagram
    autonumber
    actor User
    participant TUI as pi runtime (TUI / -p)
    participant CC as context-compiler
    participant LLM as model
    participant GOV as governance gate
    participant Tool as bash / write / edit
    participant VG as verify-gate
    participant Chk as check (verify.sh / npm test)
    participant JS as session .jsonl
    participant UI as ui renderer

    User->>TUI: prompt
    TUI->>CC: context event (messages)
    CC->>CC: prune stale bash output<br/>(>400 chars, keep 6 recent)
    CC-->>LLM: pruned working set
    LLM->>TUI: tool_call

    TUI->>GOV: classify(tool, input)
    alt deny (pipe-to-shell, mkfs, dd…)
        GOV-->>TUI: block + reason
        GOV->>JS: harness.audit {blocked}
    else ask (rm -r*, push -f, sudo…)
        GOV->>User: approval dialog (45s)
        User-->>GOV: a / d / timeout→deny
        GOV->>JS: harness.audit {allowed-once | denied}
        GOV-->>TUI: allow or block
    else allow
        GOV-->>TUI: pass-through
    end

    TUI->>Tool: execute (if allowed)
    Tool-->>TUI: stdout / stderr / files changed
    TUI->>VG: tool_execution_end<br/>(write|edit ⇒ mutated = true)
    TUI->>JS: append messages + tool results

    Note over TUI,LLM: loop until the model settles

    LLM-->>TUI: final answer → agent_settled
    TUI->>VG: agent_settled

    VG->>Chk: exec (timeout 180s, abort signal)
    Chk-->>VG: code / stdout / stderr / killed
    VG->>VG: ok = code == 0 && !killed

    alt green
        VG->>JS: harness.verify {ok, seconds}
    else red + TUI
        VG->>JS: harness.verify {failed, digest}
        VG->>TUI: steer: "fix and make checks pass"
        Note over TUI,LLM: fix cycles ≤ 3, then gave-up card
    else red + -p (no session left)
        VG->>JS: harness.verify {failed, digest}
    end

    VG->>JS: harness.summary {turns, tokens, cost, cacheHit}
    JS->>UI: entry renderers → cards in transcript
    UI->>User: footer (mission bar, tokens, cost)<br/>from MISSION.md + branch stats
```

The verification path judges the child process's raw exit data —
			code == 0 && !killed — so a timed-out check can never read
			as green. In -p sessions the controller disposes the session
			at settle, so a red verdict is recorded in the transcript instead of
			steering; the interactive fix loop is TUI-only.

## 3 · Scouts — the parallel side channel

```mermaid
sequenceDiagram
    autonumber
    participant M as model
    participant ST as scout tool (scouts.ts)
    participant P as profiles (agents/*.md)
    participant CH as scout child (×1–5)
    participant SK as skills library
    participant D as .harness/scouts/

    M->>ST: tool call {scouts[], profile?, digestWords}
    ST->>P: read personas from 3 dirs<br/>(package, project, user)
    P-->>ST: name · description · tools policy
    alt unknown profile
        ST-->>M: error: Unknown profile(s)…
    end
    alt profile = tools:none (triage)
        ST->>CH: pi -p --no-tools<br/>(objective embeds all material)
    else default (read-only)
        ST->>CH: pi -p --tools read,grep,find,ls
        CH->>SK: read taxonomy / contract SKILL.md on demand
    end
    CH-->>ST: stdout digest
    ST->>D: write artifact<br/>(ts-pid-seq name, prune oldest >100)
    ST-->>M: per-scout digests + artifact refs<br/>(model reads full artifact only if needed)
```

Scouts parallelize read-only work while decisions stay serialized with
			the main agent. Each child is an isolated pi -p session with
			no extensions and no skills preloaded — skills are a read-on-demand
			library, which is what keeps 5 concurrent specialists cheap.

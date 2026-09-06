---
name: memory-protocol
description: Persistent memory across sessions via .harness/memories/ with an index file and topic files. Use when the user shares a durable preference or correction, when starting non-trivial work in a repo you may have worked on before, or when the user asks you to remember something.
---

# Memory Protocol

Durable knowledge lives in the repo, not in weights and not in the window.
Layout:

```
.harness/memories/
├── MEMORY.md        # index: one bullet per topic, max 40 lines total
└── <topic>.md       # detail files, read on demand
```

## Reading

Before non-trivial work, read `MEMORY.md` (it is small by design). Follow
pointers to topic files only when the current task touches them.

## Writing

When the user corrects you or states a durable preference/fact:

1. Add one bullet to the matching topic file, with a date: `- 2026-09-06: deploy via make release, never npm publish`.
2. If no topic file fits, create one and add a one-line pointer to `MEMORY.md`.

## Rules

- **Index stays tiny:** if `MEMORY.md` exceeds 40 lines, merge or prune stale
  entries first — memory that is never re-read is dead weight (context rot).
- **Record corrections verbatim-ish:** capture what the user said, not your
  interpretation of it.
- **Conflicts:** newest dated bullet wins; delete the superseded one instead
  of accumulating contradictions.
- Assume session death at any moment: write the memory the moment you learn
  it, not "at the end".

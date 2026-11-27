---
description: Delegate implementation to the worker subagent (pi)
argument-hint: "[task]"
---
Delegate the implementation work to a `worker` subagent (runs in pi). Give it a self-contained task: goal, relevant file paths, constraints, and how to verify (tests/build commands) — it has no access to this conversation. It can spawn scout and researcher itself, so you don't need to pre-explore unless you already know where the code is. When it reports back, review the changes yourself (read the diff) before telling me it's done.

Task: ${@:-the change we just agreed on in this conversation}

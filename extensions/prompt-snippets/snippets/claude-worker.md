---
name: Claude worker
description: Delegate implementation to the claude-worker subagent (Claude Code CLI)
placement: append
order: 40
---
Delegate the implementation work to a `claude-worker` subagent (runs in Claude Code). Give it a self-contained task: goal, relevant file paths, constraints, and how to verify (tests/build commands) — it has no access to this conversation. Use scout first if you need to locate the relevant code. When it reports back, review the changes yourself (read the diff) before telling me it's done.

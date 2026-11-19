# Pi agent config (~/.pi/agent)

This file is loaded into **every** pi session (it lives in the agent dir). The rules below apply only when you are reading or editing files under `~/.pi/agent`; otherwise ignore them.

- Before changing anything here, load the `pi-config` skill (`/skill:pi-config`). It has the layout map, workflows, and `scripts/check.sh`.
- This directory is a public git repo with an allow-list `.gitignore`: only listed paths are committed. Untracked files (`mcp.json`, `trust.json`, credentials) have no history, so back them up before editing (`<file>.bak-<reason>`, ignored by git). Make minimal edits and run `skills/pi-config/scripts/check.sh` afterwards.
- Before anything is committed: no secrets, no work-specific names (employer org/project keys, local paths, usernames). Put those in untracked files and commit a placeholder template instead (see `mcp.example.json`). Adding a new top-level path means adding it to `.gitignore`.
- Never print or copy secrets: `auth.json`, `mcp-auth.json`. Inspect them with `jq 'keys'` only. `mcp.json` holds no inline tokens: secrets come from the macOS keychain via `!security find-generic-password …` values. Keep it that way, and never run those commands to show their output.
- Hands off managed/runtime dirs: `install/`, `npm/`, `git/`, `sessions/`, `*.sqlite*`. `extensions/interactive-subagents/` and `extensions/observational-memory/` are vendored MIT code: keep their `LICENSE` files, and keep `NOTICE.md` in sync when adding or removing third-party code.
- Check pi's bundled docs (`install/releases/<current-version>/node_modules/@earendil-works/pi-coding-agent/docs/`) instead of guessing setting keys, event names, or CLI flags.
- Keep `README.md` → Contents in sync when adding or removing extensions or skills.
- Finish by telling the user what to run: `/reload`, restart pi, or `npm install` in an extension dir.

# pi-config

My [pi](https://github.com/earendil-works/pi) agent directory (`~/.pi/agent`): an extended fork of [amosblomqvist/pi-config](https://github.com/amosblomqvist/pi-config), maintained by me. Maintenance workflows and sanity checks live in the `pi-config` skill (`skills/pi-config/`, run `scripts/check.sh` after edits).

## Models

- **Default:** `lmstudio/local`, an alias defined once in `models.json` that LM Studio (`localhost:1234`) serves as the model in its `samplingParams.model` (currently `qwen/qwen3.8-27b`). Everything else (default model, memory observer, router `local` tier, `scout.local`) refers to `lmstudio/local`. To switch local models, edit only that entry: `samplingParams.model`, `name`, `contextWindow` (= the context length LM Studio loads it with), `reasoning`, `input`.
- **Cloud:** GitHub Copilot (Claude, GPT); per-model thinking levels in `settings.json`.
- **Router tiers** (`router.json`, used by the `delegate` tool): `local` → `lmstudio/local`, `copilot` → Claude Opus via Copilot, `claude` → Claude Code CLI (`opus`, read-only tools).

## Contents

### Extensions

- `ask-user-question.ts` — the agent asks you a question through a UI popup; popups from different extensions serialize via a shared UI lock
- `bash-guard/` — hooks that catch dangerous bash commands before they run, with an on/off toggle
- `browser/` — Playwright-driven headless Chromium the agent can drive (navigate, eval JS, inspect network/console, click, screenshot); off by default, enable with `/browser on`
- `custom-header.ts` — the big capital Π header
- `interactive-subagents/` — async, interactive subagents in Rex / tmux panes; vendored from [pi-interactive-subagents](https://github.com/amosblomqvist/pi-interactive-subagents) with local changes (Rex integration, custom loadouts)
- `observational-memory/` — tiered session memory with deterministic compaction (`/om on`); vendored from [pi-observational-memory](https://github.com/amosblomqvist/pi-observational-memory)
- `prompt-snippets/` — small, reusable behavior rules toggled onto a message before sending (`alt+s`); reset after send
- `router/` — `delegate` tool routing isolated tasks across `local`, `copilot`, and `claude` tiers
- `tokyo-footer.ts` — custom Tokyo Night footer with context/cost stats and GitHub Copilot premium quota
- `web-fetch/` — fetch a URL and get clean markdown
- `web-search/` — keyless DuckDuckGo web search

### Skills

- `analyze-sessions/` — Python scripts to query past pi sessions: cost rollups, prompt-pattern mining, session rendering
- `obsidian-zettel-summary/` — save conversation summaries as atomic, linked Zettelkasten notes in Obsidian
- `pi-config/` — develop and maintain this config: layout map, workflows for extensions/skills/MCP/models, and `scripts/check.sh` sanity checks
- `pdf-reader/` — read PDFs (lecture notes, papers) into the context
- `sonarqube-findings/` — collect SonarQube Cloud findings for a branch/PR (gate, issues, hotspots, coverage, or a local check), with severity mapping and triage rules; used by the `pre-pr-review` and `sonar-quality-gate` snippets
- `web-debug/` — a playbook for debugging frontend issues with the browser extension's tools
- `youtube-transcript/` — fetch a YouTube video's title and transcript as JSON

### Subagents

- `agents/` — `worker` (default implementer, overrides the bundled one; Copilot GPT-6.2 Sol), `claude-worker` (Claude Code CLI implementer), `reviewer` (pre-PR reviewer, read-only), `scout` (recon)
- `agent-presets/` — scout variants: `scout.local` (LM Studio), `scout.gpt` (Copilot GPT-6 Luna), `scout.mai` (Copilot MAI Code 2 Flash), `scout.claude` (Copilot Claude Haiku 5.5); switch with `pi-preset-scout <name>`, which symlinks the chosen file over `agents/scout.md`

### Prompt snippets

`extensions/prompt-snippets/snippets/`: ask-questions, verify-not-assume, delegate-exploration, session-kickoff, orchestrator-mode, diagnose-report, claude-worker, pi-worker, pre-pr-review, sonar-quality-gate, obsidian-note.

### MCP servers (`mcp.json`, not committed)

angular-cli, playwright, chrome-devtools, github, atlassian, figma, sonarqube (local jar in `mcp-servers/sonarqube/`, read-only). `mcp.example.json` is the committed template: copy it to `mcp.json` and fill in the `<placeholders>`. Secrets are read from the macOS keychain via `!security find-generic-password …` commands, never stored inline. Store one with `security add-generic-password -s <service> -a "$USER" -w`.

### Packages (`settings.json` → `packages`)

- `npm:@ygncode/pi-web@beta` — web UI (`bin/pi-web`, `bin/pi-web-ctl`)
- `git:github.com/MasuRii/pi-session-cleanup` — session cleanup
- `npm:@casualjim/pi-caveman` — caveman skills (`caveman`, `caveman-commit`, `caveman-review`, `caveman-compress`, `caveman-help`, `caveman-stats`, `cavecrew`) + extension that turns on caveman `full` mode at session start by default; disabled here via `~/.config/pi-caveman/config.json` → `{"defaultMode": "off"}` (or `CAVEMAN_DEFAULT_MODE=off`), turn on with `/skill:caveman full`

## Setup

Extension-local npm deps: run `npm install` in `bash-guard/`, `browser/` (plus `npx playwright install chromium` once), `web-fetch/`, `interactive-subagents/`, `observational-memory/`.

System tools: `brew install yt-dlp ffmpeg` (youtube-transcript), Python 3 (youtube-transcript, analyze-sessions; stdlib only), Java (SonarQube MCP), Claude Code CLI (`claude-worker`, `claude` router tier), a `git-base-branch` script on `PATH` (`reviewer` agent, `pre-pr-review` snippet), the `obsidian` CLI (`obsidian-zettel-summary`).

PDF reader venv:

```bash
python3 -m venv ~/.pi/agent/skills/pdf-reader/.venv
~/.pi/agent/skills/pdf-reader/.venv/bin/pip install -r ~/.pi/agent/skills/pdf-reader/requirements.txt
```

## Git

`.gitignore` is an allow-list: only the files listed there are committed. Credentials (`auth.json`, `mcp-auth.json`), `mcp.json`, `trust.json`, sessions, caches and pi-managed directories (`install/`, `npm/`, `git/`, `bin/`) stay local. A new top-level file stays private until you add it to `.gitignore`.

## License

[MIT](LICENSE) for my own work. Parts derived from other projects keep their original authors and terms: see [NOTICE.md](NOTICE.md).

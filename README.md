# pi-config

My [pi](https://github.com/earendil-works/pi) agent directory (`~/.pi/agent`): an extended fork of [amosblomqvist/pi-config](https://github.com/amosblomqvist/pi-config), maintained by me. Maintenance workflows and sanity checks live in the `pi-config` skill (`skills/pi-config/`, run `scripts/check.sh` after edits).

## Models

- **Default:** `lmstudio/local`, an alias defined once in `models.json` that LM Studio (`localhost:1234`) serves as the model in its `samplingParams.model` (currently `qwen/qwen3.8-27b`). Everything else (default model, memory observer, router `local` tier, `scout.local`) refers to `lmstudio/local`. To switch local models, edit only that entry: `samplingParams.model`, `name`, `contextWindow` (= the context length LM Studio loads it with), `reasoning`, `input`.
- **Cloud:** GitHub Copilot (Claude, GPT); per-model thinking levels in `settings.json`.
- **Router tiers** (`router.json`, used by the `delegate` tool): `local` → `lmstudio/local`, `copilot` → Claude Opus via Copilot, `claude` → Claude Code CLI (`opus`, read-only tools).

## Contents

### Extensions

- `interactive-subagents/` — async, interactive subagents in Rex / tmux panes; vendored from [pi-interactive-subagents](https://github.com/amosblomqvist/pi-interactive-subagents) with local changes (Rex integration, custom loadouts)
- `observational-memory/` — tiered session memory with deterministic compaction (`/om on`); vendored from [pi-observational-memory](https://github.com/amosblomqvist/pi-observational-memory)
- `prompt-snippets/` — short behavior rules for one message or the whole session: `#tags` with autocomplete, `alt+s` / `/snippets` menu, pins kept per session (system prompt section); project rules from `.pi/snippets/` in trusted projects
- `router/` — `delegate` tool routing isolated tasks across `local`, `copilot`, and `claude` tiers
- `tokyo-footer.ts` — custom Tokyo Night footer with context/cost stats and GitHub Copilot premium quota

### Skills

- `analyze-sessions/` — Python scripts to query past pi sessions: cost rollups, prompt-pattern mining, session rendering
- `obsidian-zettel-summary/` — save conversation summaries as atomic, linked Zettelkasten notes in Obsidian
- `pi-config/` — develop and maintain this config: layout map, workflows for extensions/skills/MCP/models, and `scripts/check.sh` sanity checks
- `pdf-reader/` — read local PDFs (lecture notes, papers, scans, forms, CAD drawings): `scripts/triage.py` sizes a PDF up, says which pages to render, and crops large sheets into tiles; text, search and rendering use Poppler (`brew install poppler`)
- `sonarqube-findings/` — collect SonarQube Cloud findings for a branch/PR (gate, issues, hotspots, coverage, or a local check), with severity mapping and triage rules; used by the `/pre-pr-review` and `/sonar-quality-gate` templates
- `web-debug/` — a playbook for debugging frontend issues through the `playwright` and `chrome-devtools` MCP servers

### Subagents

- `agents/` — `worker` (default implementer, overrides the bundled one; Copilot GPT-6.2 Sol), `claude-worker` (Claude Code CLI implementer), `reviewer` (pre-PR reviewer, read-only), `scout` (recon)
- `agent-presets/` — scout variants: `scout.local` (LM Studio), `scout.gpt` (Copilot GPT-6 Luna), `scout.mai` (Copilot MAI Code 2 Flash), `scout.claude` (Copilot Claude Haiku 5.5); switch with `pi-preset-scout <name>`, which symlinks the chosen file over `agents/scout.md`

### Prompt snippets and templates

- Snippets (`extensions/prompt-snippets/snippets/`, used as `#tag`): kickoff, ask, verify, delegate, orchestrate, diagnose.
- Prompt templates (`prompts/`, used as `/name`): `pre-pr-review [what the change does]`, `sonar-quality-gate [focus]`, `obsidian-note <url or text>`, `claude-worker [task]`, `pi-worker [task]`.

### MCP servers (`mcp.json`, not committed)

atlassian, figma, sonarqube (local jar in `mcp-servers/sonarqube/`, read-only), plus angular-cli, playwright, chrome-devtools and github, which are configured but `"enabled": false` so they don't start in every session; turn one on with `/mcp` when needed. `mcp.example.json` is the committed template: copy it to `mcp.json` and fill in the `<placeholders>`. Secrets are read from the macOS keychain via `!security find-generic-password …` commands, never stored inline. Store one with `security add-generic-password -s <service> -a "$USER" -w`.

### Packages (`settings.json` → `packages`)

- `npm:@ygncode/pi-web@beta` — web UI (`bin/pi-web`, `bin/pi-web-ctl`)
- `git:github.com/MasuRii/pi-session-cleanup` — session cleanup
- `npm:@casualjim/pi-caveman` — caveman skills (`caveman`, `caveman-commit`, `caveman-review`, `caveman-compress`, `caveman-help`, `caveman-stats`, `cavecrew`) + extension that turns on caveman `full` mode at session start by default; disabled here via `~/.config/pi-caveman/config.json` → `{"defaultMode": "off"}` (or `CAVEMAN_DEFAULT_MODE=off`), turn on with `/skill:caveman full`
- `npm:pi-web-access` — `web_search`, `fetch_content`, `get_search_content`, `source_check`: keyless search (Exa, falling back to DuckDuckGo on quota, network or empty results via `searchRouting`), page/PDF/GitHub fetching, YouTube and video via Gemini. Config lives outside this repo: `~/.config/pi/web-search.json` when `XDG_CONFIG_HOME` is set (as here), else `~/.pi/agent/web-search.json`. It sets `toolActivation: "eager"` (so subagents with a `--tools` allowlist get the tools directly) and reads `geminiApiKey` from the keychain entry `gemini-api-key`. The free Gemini tier has no Google Search grounding quota, so Gemini is not in the search chain
- `npm:pi-ask-user` — `ask_user` tool: questions with single/multi-select and free-form answers
- `npm:cc-safety-net` — blocks destructive commands and secret-file access before a tool call runs; `/cc-safety-net` explains blocks, `npx cc-safety-net gui` tunes the rules
- `npm:@dietrichgebert/ponytail` — "lazy senior dev" rules (write less code, reuse what exists) added to the system prompt; on by default in `full` mode. `/ponytail off|lite|full|ultra` per session, `/ponytail default <mode>` to persist (`~/.config/ponytail/config.json`); also `/ponytail-review`, `-audit`, `-debt`, `-gain`, `-help`
- `npm:pi-lens` — LSP, linters and type-checkers run on every edit; blocking findings come back in the tool result. Auto-format and autofix are off globally in `~/.pi-lens/config.json` (not committed; a repo's `.pi-lens.json` can re-enable them). Tools it needs are auto-installed into `~/.pi-lens/`. `/lens-health`, `/lens-tools`, `/lens-toggle`

## Setup

Extension-local npm deps: run `npm install` in `interactive-subagents/` and `observational-memory/`.

System tools: `brew install yt-dlp ffmpeg` (pi-web-access video frames), Python 3 (analyze-sessions, pdf-reader; stdlib only), Poppler (`brew install poppler`; pdf-reader), Java (SonarQube MCP), Claude Code CLI (`claude-worker`, `claude` router tier), a `git-base-branch` script on `PATH` (`reviewer` agent, `/pre-pr-review` template), the `obsidian` CLI (`obsidian-zettel-summary`).

## Git

`.gitignore` is an allow-list: only the files listed there are committed. Credentials (`auth.json`, `mcp-auth.json`), `mcp.json`, `trust.json`, sessions, caches and pi-managed directories (`install/`, `npm/`, `git/`, `bin/`) stay local. A new top-level file stays private until you add it to `.gitignore`.

## License

[MIT](LICENSE) for my own work. Parts derived from other projects keep their original authors and terms: see [NOTICE.md](NOTICE.md).

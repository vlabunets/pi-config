---
name: pi-config
description: "Develop and maintain this pi config in ~/.pi/agent: add or edit extensions (.ts), skills, subagents/presets, prompt snippets, MCP servers, models/providers, router tiers, settings and packages; upgrade pi; debug load failures. Use whenever the task touches files under ~/.pi/agent or the user says 'my pi config', 'add an extension/skill/MCP server/model to pi', '/reload broke', or 'pi won't start'."
---

# Pi config development & maintenance

The config lives in `~/.pi/agent` (override: `PI_CODING_AGENT_DIR`). It is a public git repo with an allow-list `.gitignore` (see README → Git). Untracked files (`mcp.json`, `trust.json`, credentials) have no undo: back them up before risky edits.

## 0. Ground truth first

Pi's own docs ship with the installed release. Read the relevant one before changing anything you are not sure about — do not guess setting names or event names:

```bash
DOCS=~/.pi/agent/install/releases/$(cat ~/.pi/agent/install/current-version)/node_modules/@earendil-works/pi-coding-agent/docs
ls "$DOCS"   # settings.md extensions.md skills.md mcp.md models.md packages.md prompt-templates.md themes.md keybindings.md security.md ...
```

Map task → doc: settings keys → `settings.md`; extension API/events/`ctx.ui` → `extensions.md` (+ `tui.md`); MCP → `mcp.md`; providers/models.json → `models.md`, `custom-provider.md`; packages → `packages.md`; file layout → `configuration.md`.

## 1. Layout

| Path | What | Notes |
|---|---|---|
| `settings.json` | defaults (provider/model/thinking), `defaultTools`, `packages`, resource paths | edited by `/settings` too — re-read before writing |
| `models.json` | custom providers (LM Studio at `localhost:1234`) | |
| `router.json` | tiers for `extensions/router` (local / copilot / claude) | |
| `mcp.json` | global MCP servers | secrets via keychain `!command` values |
| `auth.json`, `mcp-auth.json` | credentials | **never print, copy, or commit** |
| `trust.json` | trusted project dirs | |
| `extensions/*.ts` | single-file extensions | |
| `extensions/<name>/` | dir extensions: `index.ts` or `package.json` with `pi.extensions` | own `node_modules` |
| `extensions/{interactive-subagents,observational-memory}` | vendored MIT code (see `NOTICE.md`) | keep their `LICENSE`; pull upstream changes by hand |
| `skills/<name>/SKILL.md` | skills | |
| `agents/*.md`, `agent-presets/*.md` | subagent definitions (frontmatter: name, description, tools, model, thinking, …) | presets = variants (`.local` / `.gpt` / `.mai` / `.claude`), switched by `pi-preset-scout` |
| `extensions/prompt-snippets/snippets/*.md` | toggleable rules (`alt+s`) | frontmatter: name, description, placement, order |
| `mcp-servers/` | local MCP server binaries (sonarqube jar) | |
| `npm/`, `git/` | installed `packages` from settings | managed by `pi install` — don't edit |
| `install/` | managed pi releases | managed — don't edit |
| `sessions/`, `*.sqlite*`, `pi-debug.log`, `session-status` | runtime state | read-only for debugging |
| `bin/` | `pi`, `pi-web`, `pi-web-ctl` wrappers | |

## 2. Workflows

### Edit any JSON config
1. `cp file.json file.json.bak-$(date +%Y%m%d-%H%M%S)` (existing convention: `mcp.json.bak-before-<reason>`).
2. Edit with a minimal change (prefer `jq` or exact-string edit; keep 2-space indent).
3. Run `scripts/check.sh` (from this skill dir).
4. Tell the user to `/reload` (or restart pi for provider/MCP changes).

### Add an extension
- Small → `extensions/<name>.ts`. Needs deps or multiple files → `extensions/<name>/index.ts` + `package.json` (`"type": "module"`, `"pi": {"extensions": ["./index.ts"]}`), then `npm install` in that dir.
- Imports: `@earendil-works/pi-coding-agent` (ExtensionAPI, events), `@earendil-works/pi-tui`, `typebox` for tool params. These are host-provided: put them in `peerDependencies`/`devDependencies`, never `dependencies`.
- Shape: `export default function (pi: ExtensionAPI) { pi.on(...); pi.registerTool({...}); pi.registerCommand(...) }`.
- Use `ctx.ui.*` for interaction; respect the shared UI lock pattern from `ask-user-question.ts` if showing popups.
- Long-lived resources (child processes, servers, watchers) must be cleaned up on `session_shutdown`.
- Test in isolation first: `pi -e ./extensions/<name>.ts`, then `/reload` in the main session.
- Typecheck if the dir has a `typecheck` script: `npm run typecheck`.

### Add a skill
- `skills/<name>/SKILL.md`, frontmatter `name` (lowercase-hyphen, ≤64, match dir name) + `description` (≤1024: say **what** and **when**, include trigger phrases).
- Bundle scripts under `scripts/`, refer to them by relative path. Python: stdlib only, or a skill-local `.venv` + `requirements.txt` (see `pdf-reader`).
- `disable-model-invocation: true` for command-only skills.
- Verify: `/reload`, then `/skill:<name>`.

### Add a subagent / preset
- Copy an existing file in `agents/` or `agent-presets/` and keep its frontmatter keys. Model ids are `provider/model-id` and must exist (`models.json` or a built-in provider).
- Final message format must stand alone — subagents have no parent context.

### Add a prompt snippet
- `extensions/prompt-snippets/snippets/<slug>.md` with `name`, `description`, `placement: prepend|append`, `order`. One rule per snippet, a few lines max.

### Add/modify an MCP server
- Back up `mcp.json` first. Follow `mcp.md` for schema; secrets go in the macOS keychain via `!security find-generic-password …` (existing convention), env vars, or OAuth — never inline.
- Diagnose with the steps in `mcp.md` → "Diagnose connection problems".

### Change the local model
- All config refers to `lmstudio/local`. It is an alias entry in `models.json` whose `samplingParams.model` is the real LM Studio id (pi sends `samplingParams` last, so it overrides the request's `model` field).
- To switch: edit only that entry: `samplingParams.model` (copy the id from `curl -s localhost:1234/v1/models | jq '.data[].id'`), `name`, `contextWindow` (= LM Studio's loaded context length), `reasoning`, `input`. Then run `scripts/check.sh` (it verifies every `lmstudio/<id>` reference and that LM Studio knows the alias target) and restart pi.
- Caveat: LM Studio silently answers with whatever model is loaded when it gets an unknown id, so a wrong target doesn't error. `check.sh` warns about it.

### Add a model / provider
- `models.json` → `providers.<id>` with `api`, `baseUrl`, `models[]`. Check LM Studio is up: `curl -s localhost:1234/v1/models | jq '.data[].id'` and copy the id exactly.
- If it should be the default, update `settings.json` `defaultProvider`/`defaultModel`, and `router.json` / `agents/*.md` that reference the old id (`grep -rn "<old-id>" ~/.pi/agent --include=*.md --include=*.json`, excluding `sessions/`, `npm/`, `install/`).

### Packages
- `pi install npm:<pkg>` / `pi install git:github.com/<user>/<repo>`; `pi list`, `pi remove <source>`, `pi update <source>` or `pi update --extensions`. Try one without installing: `pi -e npm:<pkg>`. Let pi manage `settings.json#packages`, `npm/`, `git/`. Review third-party source before installing.

### Upgrade pi
- Note current version (`install/current-version`), run `pi update` (pi only) or `pi update --all` (pi + packages); `pi update --models` refreshes model catalogs.
- Then skim the new release's `CHANGELOG.md` for breaking extension-API changes, run `scripts/check.sh`, and start pi once to confirm extensions load. Old release dirs stay in `install/releases/` for rollback.

## 3. Debugging "pi won't start" / "/reload broke"
1. `scripts/check.sh` — catches invalid JSON and bad skill frontmatter.
2. `tail -100 ~/.pi/agent/pi-debug.log`.
3. Bisect extensions: `pi --no-extensions`, then `pi -e <one-extension>`.
4. Most recently edited files: `find ~/.pi/agent -newer ~/.pi/agent/install/current-version -type f -not -path '*/node_modules/*' -not -path '*/sessions/*' | head`.
5. Restore from the `.bak-*` file if the cause is a config edit.

## 4. Rules
- Never read out or log contents of `auth.json`, `mcp-auth.json`, or the output of the `!command` keychain lookups in `mcp.json`. Inspect structure with `jq 'keys'`.
- Don't touch `install/`, `npm/`, `git/`, `sessions/`, sqlite files by hand.
- Never commit secrets or work-specific names; use untracked files plus a committed template (`mcp.example.json`). New top-level paths must be added to the `.gitignore` allow-list. Keep `NOTICE.md` in sync with third-party code.
- Keep `README.md` "Contents" section in sync when adding/removing an extension or skill.
- After changes, state exactly what the user must do: `/reload`, restart, `npm install`, etc.

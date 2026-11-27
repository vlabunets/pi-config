# prompt-snippets

Short behavior rules ("verify, don't guess", "diagnose only") that you switch
on for **one message** or **the whole session**, without retyping them.

Bigger, reusable workflows (PR review, Sonar gate, delegating to a worker)
are pi prompt templates in `~/.pi/agent/prompts/` instead: `/pre-pr-review`,
`/sonar-quality-gate`, `/obsidian-note <url>`, `/claude-worker <task>`,
`/pi-worker <task>`.

## Using it

**Tags in the message.** Type `#` and pick from the autocomplete list, or
type the tag yourself:

```text
the login redirect loops after the token refresh #diagnose #verify
```

Known tags are removed from your message, and their rules are sent with it as
a separate, collapsible `▸ snippets #diagnose #verify` message. Tags inside
code (`` `#x` `` or fenced blocks), unknown tags (`#123`, `#todo`), headings
and URL fragments are left alone. A message that is only tags (`#ask`) sends
nothing: it arms those rules for your next message.

**Menu.** `alt+s` or `/snippets` lists every snippet with its full text. Space
or Enter cycles each one through **off → next message → whole session**; type
to filter, Esc to close.

**Commands.**

| Command | Effect |
|---|---|
| `/snippets next verify ask` | add to the next message |
| `/snippets pin orchestrate` | on for the whole session |
| `/snippets unpin orchestrate` | off |
| `/snippets clear` | everything off |
| `/snippets list` | names, state and descriptions |

A widget above the editor shows what is active: `◆ session …` and
`▸ next message …`.

## How rules reach the model

- **Next message**: a custom message right after yours, so what you typed stays
  as typed and slash commands (`/pre-pr-review #verify`) still work. Messages
  you send while the agent is busy (steer, follow-up) get the rules appended to
  their text instead, because they don't start a run of their own.
- **Whole session**: a `<session-rules>` section of the system prompt. pi
  patches only that section when it changes, so the prompt cache survives. Pins
  are saved in the session and follow `/tree`, resume and fork.

## Writing snippets

One Markdown file per rule. The file name is the tag: lowercase letters, digits
and dashes.

```markdown
---
name: Verify
description: Check facts in the code, docs or tools instead of trusting memory
order: 30
---
Check facts against the code, the docs, or real tool output instead of relying
on memory or on what seems likely.
```

| Field | Default | Use |
|---|---|---|
| `name` | file name | menu label |
| `description` | — | one line in the menu, `/snippets list` and autocomplete |
| `order` | `100` | sort order in the menu and in the composed rules |

Keep each rule to one instruction of a few lines; combine them with tags.

**Where they load from**

- `snippets/` next to this README (global).
- `<project>/.pi/snippets/` in projects pi trusts. A project file with the same
  name replaces the global one and is marked `(project)` in the menu.

Files are re-read every time you open the menu or send a message, so edits
apply without `/reload`.

## Tests

```bash
node --test extensions/prompt-snippets/core.test.ts
```

`core.ts` holds the parsing, tag and text logic without pi imports; `index.ts`
wires it to pi.

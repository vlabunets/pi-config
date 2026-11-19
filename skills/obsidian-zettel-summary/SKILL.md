---
name: "obsidian-zettel-summary"
description: Save a conversation summary as Zettelkasten-style Obsidian notes (atomic, dated, linked). Use when asked to save, log or summarize the current session to Obsidian.
---

# Obsidian Zettelkasten conversation summary

Turn the current conversation into one or more Obsidian-ready Markdown notes that follow the Zettelkasten method: atomic, written in own words, uniquely identified, and linked. Save them into the user's Obsidian vault through the Obsidian CLI.

## When to use

The user asks to save, capture, log or summarize the conversation/session to Obsidian, make a zettel, or turn the chat into notes. Do not trigger for general Markdown writing.

## Principles

1. **Atomic**: one idea per note. If the conversation covers several distinct ideas, write several notes, not one long summary.
2. **Own words**: synthesize the insight; do not paste the transcript or long code dumps. Keep only snippets that make the idea reusable.
3. **Title as a claim**: titles state the idea ("Reactive form validators should be pure functions"), not a topic ("Angular validators").
4. **Unique ID in frontmatter**: every note gets a timestamp `id` (`YYYYMMDDHHmm`). The filename carries only the date, so the frontmatter `id` is the stable unique identifier.
5. **Linked**: connect each note to related notes with `[[wikilinks]]`. Only link to notes that exist in the vault or are created in this same run. Never invent links.
6. **Context-independent**: a note must make sense months later without the chat.

## Note types

- **Permanent note** (default): a distilled idea, decision, or how-to learned in the session.
- **Literature note**: summarizes an external source (article, doc, video) discussed in the session. Include the source URL.
- **Structure note / MOC** (optional): only when the run produces 3+ notes, as an index linking them.

## File naming

Filename: `<Title> <YYYYMMDD>.md` (four-digit year, month, day). Example, created on 2 Nov 2026:

`Reactive form validators should be pure functions 20261102.md`

- Title first, a single space, then the date, then `.md`.
- Strip characters illegal in filenames (`/ \ : * ? " < > |`).
- Wikilinks use the filename without the extension, including the date: `[[Reactive form validators should be pure functions 20261102]]`. Use an alias for readable link text: `[[... 20261102|pure validators]]`.
- If a file with the same name exists, never overwrite it: append `(2)` to the title, or merge into the existing note when it is clearly the same idea.

## Note template

```markdown
---
id: 202611021815
title: <claim-style title>
type: permanent        # permanent | literature | structure
created: 2026-11-02
tags: [topic, subtopic]
source: pi-session
aliases: []
---

# <claim-style title>

<2-6 sentences: the idea in own words, with the reasoning or the "why".>

## Details

<Only if needed: key steps, trade-offs, a minimal code snippet.>

## Links

- [[<related note filename without .md>]] - one line on how it relates (extends, contradicts, example of, prerequisite for)

## Open questions

- <unresolved questions or next things to explore, if any>
```

Rules: tags are lowercase, hyphenated, 2-5 per note; omit empty sections; keep each note under roughly 300 words.

## Workflow

1. **Get timestamps from the shell** (never guess the date):
   - `date +%Y%m%d%H%M` for the `id`
   - `date +%Y%m%d` for the filename suffix
   - `date +%F` for `created`
2. **Use the Obsidian CLI for all vault access.** Always run it as `obsidian vault=my_vault <command> ... </dev/null` (the `</dev/null` stops it swallowing stdin). Do not touch the vault's files directly: macOS blocks that path, and do not try to get around it. Obsidian must be running; the first command launches it if not. Errors can still exit 0, so check the output for `Error:`. If the CLI is missing or fails, stop and tell the user rather than saving elsewhere. New notes go in `_inbox/` unless the user names another folder.
3. **Identify the ideas.** Scan the session and list the distinct ideas, decisions or learnings worth keeping. Drop chit-chat and dead ends (unless the dead end is the lesson).
4. **Find link candidates.** Search existing notes and reuse existing tags and conventions. Match the language of existing notes; otherwise use the language of the conversation.
   - `obsidian vault=my_vault search query="<terms>" limit=20 </dev/null`
   - `obsidian vault=my_vault tags counts sort=count </dev/null`
   - `obsidian vault=my_vault read path="<path>.md" </dev/null`
5. **Write the notes** with the naming rule and template. Write each note to a temp file, check the name is free with `obsidian vault=my_vault files folder=_inbox </dev/null`, then create it (never pass `overwrite`):
   ```bash
   obsidian vault=my_vault create path="_inbox/<Title> <YYYYMMDD>.md" content="$(cat /tmp/<note-file>.md)" </dev/null
   ```
   Keep the `$(cat ...)` form so quotes and `$` in the note are not expanded. The CLI turns a literal backslash-n or backslash-t into a line break or tab, so reword code snippets to avoid them. Read each note back to confirm it arrived intact, then delete the temp file.

   Add backlinks: when a new note relates strongly to an existing note, add a one-line link under that note's Links section (append only, never rewrite existing content):
   ```bash
   obsidian vault=my_vault append path="<existing note>.md" heading="Links" content="- [[<new note>]] - how it relates" </dev/null
   ```
6. **Report briefly**: list the created note filenames and their folder. Do not recap the session again.

## Quality checklist

- Each note has exactly one idea and a claim-style title.
- Filename is `<Title> <YYYYMMDD>.md` and `created` matches the date in the filename.
- Frontmatter `id` is a unique timestamp.
- Every `[[link]]` points to a real note, using its full filename (with date) without `.md`.
- No secrets, tokens, or personal data copied from the session.
- Code snippets are minimal and labelled with a language.

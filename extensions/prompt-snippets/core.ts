// Pure logic for prompt-snippets: snippet files, #tags, and the text sent to
// the model. No pi imports, so `node --test` can run it directly.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";

export type Source = "global" | "project";

export interface Snippet {
	/** File name without `.md`; also the `#tag`. Lowercase letters, digits, dashes. */
	slug: string;
	/** Menu label. */
	name: string;
	description: string;
	/** Sort key in the menu and in the composed text; ties sort by slug. */
	order: number;
	body: string;
	source: Source;
	file: string;
}

export const SLUG = /^[a-z0-9][a-z0-9-]*$/;
const DEFAULT_ORDER = 100;

/** Split `---`-fenced frontmatter (flat `key: value` lines) from the body. */
export function splitFrontmatter(raw: string): { meta: Record<string, string>; body: string } {
	const text = raw.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
	const fence = /^---\n([\s\S]*?)\n---(?:\n|$)/.exec(text);
	if (!fence) return { meta: {}, body: text.trim() };
	const meta: Record<string, string> = {};
	for (const line of fence[1].split("\n")) {
		const colon = line.indexOf(":");
		if (colon <= 0) continue;
		const value = line.slice(colon + 1).trim().replace(/^(["'])(.*)\1$/, "$2");
		meta[line.slice(0, colon).trim().toLowerCase()] = value;
	}
	return { meta, body: text.slice(fence[0].length).trim() };
}

/** Parse one snippet file. Returns an error string for files that can't be used. */
export function parseSnippet(file: string, raw: string, source: Source): Snippet | string {
	const slug = basename(file, ".md");
	if (!SLUG.test(slug)) return `${file}: file name must be lowercase letters, digits and dashes`;
	const { meta, body } = splitFrontmatter(raw);
	if (!body) return `${file}: empty body`;
	const order = Number(meta.order);
	return {
		slug,
		name: meta.name || slug,
		description: meta.description || "",
		order: Number.isFinite(order) && meta.order !== "" && meta.order !== undefined ? order : DEFAULT_ORDER,
		body,
		source,
		file,
	};
}

export function bySortKey(a: Snippet, b: Snippet): number {
	return a.order - b.order || a.slug.localeCompare(b.slug);
}

/**
 * Read every `*.md` in the given directories. Later directories win on the
 * same slug, so pass global first and project second.
 */
export function loadSnippets(dirs: { dir: string; source: Source }[]): { snippets: Snippet[]; errors: string[] } {
	const found = new Map<string, Snippet>();
	const errors: string[] = [];
	for (const { dir, source } of dirs) {
		if (!existsSync(dir)) continue;
		for (const entry of readdirSync(dir).filter((f) => f.endsWith(".md")).sort()) {
			const file = join(dir, entry);
			let raw: string;
			try {
				raw = readFileSync(file, "utf8");
			} catch (err) {
				errors.push(`${file}: ${(err as Error).message}`);
				continue;
			}
			const parsed = parseSnippet(file, raw, source);
			if (typeof parsed === "string") errors.push(parsed);
			else found.set(parsed.slug, parsed);
		}
	}
	return { snippets: [...found.values()].sort(bySortKey), errors };
}

// ── #tags ──────────────────────────────────────────────────────────────────

/** `#slug` at the start, after whitespace or an opening bracket; ends at whitespace, end, or punctuation. */
const TAG = /(^|[\s(\[])#([a-z0-9][a-z0-9-]*)(?=$|[\s.,;:!?)\]])/g;

/**
 * Remove known `#tags` from the text, outside fenced code blocks and inline
 * code. Unknown tags (`#123`, `#todo`) and Markdown headings stay as typed.
 */
export function extractTags(text: string, known: ReadonlySet<string>): { text: string; slugs: string[] } {
	const slugs: string[] = [];
	// Odd-indexed parts are code: fenced blocks first, then inline spans.
	const parts = text.split(/(```[\s\S]*?(?:```|$)|`[^`\n]*`)/);
	for (let i = 0; i < parts.length; i += 2) {
		parts[i] = parts[i].replace(TAG, (match, lead: string, slug: string) => {
			if (!known.has(slug)) return match;
			if (!slugs.includes(slug)) slugs.push(slug);
			return lead;
		});
	}
	const cleaned = parts
		.join("")
		.replace(/[ \t]+$/gm, "")
		.replace(/[ \t]{2,}/g, " ")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
	return { text: cleaned, slugs };
}

/** The partial `#tag` being typed at the cursor, or undefined. */
export function tagAtCursor(textBeforeCursor: string): string | undefined {
	return /(?:^|[ \t(\[])#([a-z0-9-]*)$/.exec(textBeforeCursor)?.[1];
}

// ── Composed text ──────────────────────────────────────────────────────────

/** Rules for one message, sent as a separate context message after it. */
export function messageRules(snippets: Snippet[]): string {
	const sorted = [...snippets].sort(bySortKey);
	return ["Additional instructions for this message:", ...sorted.map((s) => `- ${indentBody(s.body)}`)].join("\n");
}

/** Rules pinned for the whole session, as the body of a system prompt section. */
export function sessionRules(snippets: Snippet[]): string {
	const sorted = [...snippets].sort(bySortKey);
	return [
		"The user turned these rules on for the whole session. Follow them in every turn until they are turned off:",
		...sorted.map((s) => `- ${indentBody(s.body)}`),
	].join("\n");
}

function indentBody(body: string): string {
	return body.replace(/\n/g, "\n  ");
}

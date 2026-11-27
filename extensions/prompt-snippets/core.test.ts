// Run: node --test extensions/prompt-snippets/core.test.ts
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { extractTags, loadSnippets, messageRules, parseSnippet, sessionRules, splitFrontmatter, tagAtCursor } from "./core.ts";

const known = new Set(["verify", "ask", "diagnose", "dry-run"]);

describe("splitFrontmatter", () => {
	it("reads flat keys and the body", () => {
		const { meta, body } = splitFrontmatter("---\nname: Verify\norder: 30\ndescription: \"quoted: yes\"\n---\nCheck facts.\n");
		assert.deepEqual(meta, { name: "Verify", order: "30", description: "quoted: yes" });
		assert.equal(body, "Check facts.");
	});
	it("treats a file without frontmatter as all body", () => {
		assert.deepEqual(splitFrontmatter("Just a rule.\n"), { meta: {}, body: "Just a rule." });
	});
	it("handles CRLF and a BOM", () => {
		assert.equal(splitFrontmatter("﻿---\r\nname: X\r\n---\r\nBody\r\n").body, "Body");
	});
});

describe("parseSnippet", () => {
	it("uses the file name as slug and defaults the rest", () => {
		const s = parseSnippet("/x/verify.md", "Check facts.", "global");
		assert.ok(typeof s !== "string");
		assert.equal(s.slug, "verify");
		assert.equal(s.name, "verify");
		assert.equal(s.order, 100);
	});
	it("keeps order 0", () => {
		const s = parseSnippet("/x/a.md", "---\norder: 0\n---\nBody", "global");
		assert.ok(typeof s !== "string" && s.order === 0);
	});
	it("rejects bad file names and empty bodies", () => {
		assert.match(parseSnippet("/x/Bad Name.md", "Body", "global") as string, /file name/);
		assert.match(parseSnippet("/x/empty.md", "---\nname: E\n---\n", "global") as string, /empty body/);
	});
});

describe("loadSnippets", () => {
	const root = mkdtempSync(join(tmpdir(), "snippets-"));
	after(() => rmSync(root, { recursive: true, force: true }));
	const global = join(root, "global");
	const project = join(root, "project");
	mkdirSync(global);
	mkdirSync(project);
	writeFileSync(join(global, "verify.md"), "---\norder: 30\n---\nGlobal verify");
	writeFileSync(join(global, "ask.md"), "---\norder: 20\n---\nAsk");
	writeFileSync(join(global, "notes.txt"), "ignored");
	writeFileSync(join(global, "Bad.md"), "Body");
	writeFileSync(join(project, "verify.md"), "---\norder: 30\n---\nProject verify");

	it("sorts by order and lets the project override the global snippet", () => {
		const { snippets, errors } = loadSnippets([
			{ dir: global, source: "global" },
			{ dir: project, source: "project" },
			{ dir: join(root, "missing"), source: "project" },
		]);
		assert.deepEqual(snippets.map((s) => s.slug), ["ask", "verify"]);
		assert.equal(snippets[1].body, "Project verify");
		assert.equal(snippets[1].source, "project");
		assert.equal(errors.length, 1);
	});
});

describe("extractTags", () => {
	it("removes known tags and keeps their order of first use", () => {
		assert.deepEqual(extractTags("#verify fix the login #ask bug #verify", known), {
			text: "fix the login bug",
			slugs: ["verify", "ask"],
		});
	});
	it("accepts trailing punctuation and dashed slugs", () => {
		assert.deepEqual(extractTags("Do it (#dry-run), then report. #diagnose.", known), {
			text: "Do it (), then report. .",
			slugs: ["dry-run", "diagnose"],
		});
	});
	it("leaves unknown tags, issue numbers, headings and URL fragments alone", () => {
		const text = "# Title\nSee #123 and #todo at https://x.dev/page#verify";
		assert.deepEqual(extractTags(text, known), { text, slugs: [] });
	});
	it("skips inline code and fenced blocks", () => {
		const text = "Explain `#verify` and\n```\n#ask\n```\nnow #diagnose";
		const result = extractTags(text, known);
		assert.deepEqual(result.slugs, ["diagnose"]);
		assert.ok(result.text.includes("`#verify`") && result.text.includes("\n#ask\n"));
	});
	it("works after a slash command", () => {
		assert.deepEqual(extractTags("/pre-pr-review adds export #verify", known), {
			text: "/pre-pr-review adds export",
			slugs: ["verify"],
		});
	});
	it("returns empty text when the message is only tags", () => {
		assert.deepEqual(extractTags("#verify #ask", known), { text: "", slugs: ["verify", "ask"] });
	});
});

describe("tagAtCursor", () => {
	it("finds the partial tag being typed", () => {
		assert.equal(tagAtCursor("please #ver"), "ver");
		assert.equal(tagAtCursor("#"), "");
		assert.equal(tagAtCursor("page#ver"), undefined);
		assert.equal(tagAtCursor("#verify done"), undefined);
	});
});

describe("composed rules", () => {
	const make = (slug: string, order: number, body: string) => {
		const s = parseSnippet(`/x/${slug}.md`, `---\norder: ${order}\n---\n${body}`, "global");
		assert.ok(typeof s !== "string");
		return s;
	};
	it("orders rules and indents multi-line bodies", () => {
		const text = messageRules([make("b", 20, "Second"), make("a", 10, "First\nline two")]);
		assert.equal(text, "Additional instructions for this message:\n- First\n  line two\n- Second");
	});
	it("frames session rules", () => {
		assert.match(sessionRules([make("a", 1, "Rule")]), /whole session[\s\S]*- Rule$/);
	});
});

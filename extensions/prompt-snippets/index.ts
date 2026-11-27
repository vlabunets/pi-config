// prompt-snippets: small behavior rules you add to one message or pin for the
// whole session. Pick them with alt+s or /snippets, or type #tags in a message.
//
//   next message   sent as a separate context message after the one you send
//   whole session  a system prompt section, patched in place when it changes
//
// Snippets: ./snippets/*.md, plus <project>/.pi/snippets/*.md in trusted projects.

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	CONFIG_DIR_NAME,
	type ExtensionAPI,
	type ExtensionContext,
	getSettingsListTheme,
} from "@earendil-works/pi-coding-agent";
import {
	type AutocompleteItem,
	type Component,
	Container,
	fuzzyFilter,
	type SettingItem,
	SettingsList,
	Text,
} from "@earendil-works/pi-tui";
import { extractTags, loadSnippets, messageRules, type Snippet, type Source, sessionRules, tagAtCursor } from "./core.ts";

const GLOBAL_DIR = join(dirname(fileURLToPath(import.meta.url)), "snippets");
const PIN_ENTRY = "prompt-snippets-pins"; // session entry: { pinned: string[] }
const RULES_MESSAGE = "prompt-snippets"; // custom message carrying one message's rules
const SECTION = "session-rules"; // system prompt section for pinned rules
const WIDGET = "prompt-snippets";

const OFF = "off";
const NEXT = "next message";
const SESSION = "whole session";

export default function promptSnippets(pi: ExtensionAPI) {
	let snippets: Snippet[] = [];
	const next = new Set<string>(); // for the next message only
	let pinned = new Set<string>(); // for every turn of this session
	let pending: Snippet[] = []; // chosen at input, sent at before_agent_start
	const reported = new Set<string>(); // load errors already shown

	const find = (slug: string) => snippets.find((s) => s.slug === slug);
	const present = (slugs: Iterable<string>) => [...slugs].map(find).filter((s): s is Snippet => !!s);

	function reload(ctx: ExtensionContext): void {
		const dirs: { dir: string; source: Source }[] = [{ dir: GLOBAL_DIR, source: "global" }];
		if (ctx.isProjectTrusted()) dirs.push({ dir: join(ctx.cwd, CONFIG_DIR_NAME, "snippets"), source: "project" });
		const loaded = loadSnippets(dirs);
		snippets = loaded.snippets;
		for (const error of loaded.errors) {
			if (reported.has(error)) continue;
			reported.add(error);
			if (ctx.hasUI) ctx.ui.notify(`prompt-snippets: ${error}`, "warning");
		}
		for (const slug of next) if (!find(slug)) next.delete(slug);
	}

	function restorePins(ctx: ExtensionContext): void {
		let latest: string[] = [];
		for (const entry of ctx.sessionManager.getBranch()) {
			if (entry.type === "custom" && entry.customType === PIN_ENTRY) {
				const data = entry.data as { pinned?: unknown } | undefined;
				latest = Array.isArray(data?.pinned) ? data.pinned.filter((s): s is string => typeof s === "string") : [];
			}
		}
		pinned = new Set(latest);
	}

	function savePins(): void {
		pi.appendEntry(PIN_ENTRY, { pinned: [...pinned].sort() });
	}

	function showWidget(ctx: ExtensionContext): void {
		if (!ctx.hasUI) return;
		const session = present(pinned);
		const once = present(next);
		if (!session.length && !once.length) {
			ctx.ui.setWidget(WIDGET, undefined);
			return;
		}
		const tags = (list: Snippet[]) => list.map((s) => `#${s.slug}`).join(" ");
		ctx.ui.setWidget(WIDGET, (_tui, theme) => {
			const lines: string[] = [];
			if (session.length) lines.push(theme.fg("accent", "◆ session ") + tags(session));
			if (once.length) lines.push(theme.fg("warning", "▸ next message ") + tags(once));
			return new Text(lines.join("\n"), 0, 0);
		});
	}

	/** Set one snippet's mode; returns whether the pinned set changed. */
	function setMode(slug: string, mode: string): boolean {
		const wasPinned = pinned.has(slug);
		next.delete(slug);
		pinned.delete(slug);
		if (mode === NEXT) next.add(slug);
		if (mode === SESSION) pinned.add(slug);
		return wasPinned !== pinned.has(slug);
	}

	async function openMenu(ctx: ExtensionContext): Promise<void> {
		reload(ctx);
		if (ctx.mode !== "tui") {
			ctx.ui.notify("The snippet menu needs the terminal UI. Use /snippets pin|next|unpin <name>.", "warning");
			return;
		}
		if (!snippets.length) {
			ctx.ui.notify(`No snippets found in ${GLOBAL_DIR}`, "warning");
			return;
		}
		let pinsChanged = false;
		await ctx.ui.custom<void>((tui, theme, _keys, done) => {
			const mode = (slug: string) => (pinned.has(slug) ? SESSION : next.has(slug) ? NEXT : OFF);
			const items: SettingItem[] = snippets.map((s) => ({
				id: s.slug,
				label: `#${s.slug}${s.source === "project" ? theme.fg("dim", " (project)") : ""}`,
				description: s.description ? `${s.description}\n\n${s.body}` : s.body,
				currentValue: mode(s.slug),
				values: [OFF, NEXT, SESSION],
			}));
			const list = new SettingsList(
				items,
				Math.min(items.length + 2, 14),
				getSettingsListTheme(),
				(slug, value) => {
					pinsChanged = setMode(slug, value) || pinsChanged;
					showWidget(ctx);
				},
				() => done(undefined),
				{ enableSearch: true },
			);
			const view = new Container();
			view.addChild(new Text(theme.fg("accent", theme.bold("Prompt snippets")), 0, 0));
			view.addChild(new Text(theme.fg("dim", "space/enter: off → next message → whole session · type to search · esc: done"), 0, 0));
			view.addChild(list);
			const component: Component & { capturesViewportInput?: boolean } = {
				capturesViewportInput: list.capturesViewportInput,
				render: (width) => view.render(width),
				invalidate: () => view.invalidate(),
				handleInput: (data) => {
					list.handleInput(data);
					tui.requestRender();
				},
			};
			return component;
		});
		if (pinsChanged) savePins();
		showWidget(ctx);
	}

	// ── UI entry points ──────────────────────────────────────────────────────

	pi.registerShortcut("alt+s", {
		description: "Prompt snippets: pick rules for the next message or the session",
		handler: async (ctx) => openMenu(ctx),
	});

	const SUBCOMMANDS = ["next", "pin", "unpin", "clear", "list"];
	pi.registerCommand("snippets", {
		description: "Prompt snippets menu, or: next|pin|unpin <name>, clear, list",
		getArgumentCompletions: (prefix): AutocompleteItem[] | null => {
			const [sub, name = ""] = prefix.split(/\s+/, 2);
			if (!prefix.includes(" ")) {
				const items = SUBCOMMANDS.filter((c) => c.startsWith(sub)).map((c) => ({ value: `${c} `, label: c }));
				return items.length ? items : null;
			}
			if (!["next", "pin", "unpin"].includes(sub)) return null;
			const items = snippets
				.filter((s) => s.slug.startsWith(name))
				.map((s) => ({ value: `${sub} ${s.slug}`, label: s.slug, description: s.description }));
			return items.length ? items : null;
		},
		handler: async (args, ctx) => {
			const [sub = "", ...names] = args.trim().split(/\s+/).filter(Boolean);
			if (!sub) return openMenu(ctx);
			reload(ctx);
			if (sub === "list") {
				const lines = snippets.map((s) => {
					const state = pinned.has(s.slug) ? "session" : next.has(s.slug) ? "next" : "-";
					return `#${s.slug}  [${state}]  ${s.description}${s.source === "project" ? "  (project)" : ""}`;
				});
				ctx.ui.notify(lines.join("\n") || "No snippets", "info");
				return;
			}
			if (sub === "clear") {
				const hadPins = pinned.size > 0;
				next.clear();
				pinned.clear();
				if (hadPins) savePins();
				showWidget(ctx);
				ctx.ui.notify("All snippets off", "info");
				return;
			}
			if (!["next", "pin", "unpin"].includes(sub) || !names.length) {
				ctx.ui.notify("Usage: /snippets [next|pin|unpin <name>... | clear | list]", "warning");
				return;
			}
			const unknown = names.filter((n) => !find(n.replace(/^#/, "")));
			if (unknown.length) {
				ctx.ui.notify(`Unknown snippet: ${unknown.join(", ")}`, "error");
				return;
			}
			const target = sub === "next" ? NEXT : sub === "pin" ? SESSION : OFF;
			let pinsChanged = false;
			for (const n of names) pinsChanged = setMode(n.replace(/^#/, ""), target) || pinsChanged;
			if (pinsChanged) savePins();
			showWidget(ctx);
		},
	});

	pi.registerMessageRenderer<{ slugs?: string[] }>(RULES_MESSAGE, (message, options, theme) => {
		const tags = (message.details?.slugs ?? []).map((s) => `#${s}`).join(" ");
		let text = theme.fg("dim", "▸ snippets ") + tags;
		if (options.expanded) {
			const body = typeof message.content === "string" ? message.content : "";
			text += `\n${theme.fg("dim", body)}`;
		} else {
			text += theme.fg("dim", ` (${options.keyHint("app.tools.expand", "to expand")})`);
		}
		return new Text(text, options.outputPad, 0);
	});

	// ── Session lifecycle ────────────────────────────────────────────────────

	pi.on("session_start", (_event, ctx) => {
		reload(ctx);
		restorePins(ctx);
		next.clear();
		pending = [];
		showWidget(ctx);
		if (!ctx.hasUI) return;
		ctx.ui.addAutocompleteProvider((current) => ({
			triggerCharacters: ["#"],
			async getSuggestions(lines, line, col, options) {
				const token = tagAtCursor((lines[line] ?? "").slice(0, col));
				if (token === undefined || !snippets.length) return current.getSuggestions(lines, line, col, options);
				const matches = token ? fuzzyFilter(snippets, token, (s) => `${s.slug} ${s.name}`) : snippets;
				if (!matches.length) return current.getSuggestions(lines, line, col, options);
				return {
					prefix: `#${token}`,
					items: matches.slice(0, 20).map((s) => ({
						value: `#${s.slug}`,
						label: `#${s.slug}`,
						description: s.description || s.name,
					})),
				};
			},
			applyCompletion: (lines, line, col, item, prefix) => current.applyCompletion(lines, line, col, item, prefix),
			shouldTriggerFileCompletion: (lines, line, col) =>
				current.shouldTriggerFileCompletion?.(lines, line, col) ?? true,
		}));
	});

	pi.on("session_tree", (_event, ctx) => {
		restorePins(ctx);
		showWidget(ctx);
	});

	// ── Applying rules ───────────────────────────────────────────────────────

	pi.on("input", (event, ctx) => {
		if (event.source === "extension") return { action: "continue" };
		reload(ctx);
		const { text, slugs } = extractTags(event.text, new Set(snippets.map((s) => s.slug)));
		const tagged = slugs.length > 0;

		// Only tags, no message: arm them for the next message instead of sending nothing.
		if (tagged && !text && !event.images?.length) {
			for (const slug of slugs) setMode(slug, NEXT);
			showWidget(ctx);
			ctx.ui.notify(`Next message: ${slugs.map((s) => `#${s}`).join(" ")}`, "info");
			return { action: "handled" };
		}

		const chosen = present(new Set([...next, ...slugs]));
		next.clear();
		showWidget(ctx);
		if (!chosen.length) return tagged ? { action: "transform", text } : { action: "continue" };

		// Steering and follow-up messages don't start a run of their own, so
		// before_agent_start won't see them: put the rules in the text instead.
		if (event.streamingBehavior) return { action: "transform", text: `${text}\n\n${messageRules(chosen)}` };

		pending = chosen;
		return tagged ? { action: "transform", text } : { action: "continue" };
	});

	pi.on("before_agent_start", (event) => {
		const session = present(pinned);
		const sections = event.systemPromptOptions?.sections;
		let systemPrompt: string | undefined;
		if (sections) {
			if (session.length) sections[SECTION] = sessionRules(session);
			else delete sections[SECTION];
		} else if (session.length) {
			systemPrompt = `${event.systemPrompt}\n\n<${SECTION}>\n${sessionRules(session)}\n</${SECTION}>`;
		}

		const rules = event.messageType === "user" ? pending : [];
		pending = [];
		if (!rules.length) return systemPrompt ? { systemPrompt } : undefined;
		return {
			...(systemPrompt ? { systemPrompt } : {}),
			message: {
				customType: RULES_MESSAGE,
				content: messageRules(rules),
				display: true,
				details: { slugs: rules.map((r) => r.slug) },
			},
		};
	});
}

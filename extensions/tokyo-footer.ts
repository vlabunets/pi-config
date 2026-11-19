/**
 * Tokyo Night Footer Extension
 *
 * Replaces the built-in footer with a Tokyo Night styled one showing the same info:
 *   line 1: cwd, git branch, session name
 *   line 2: tokens ↑in ↓out, cache read/write + hit rate, cost, context usage | provider, model, thinking
 *   line 3: extension statuses (from ctx.ui.setStatus)
 *
 * Usage: edit this file and run /reload in pi.
 * To restore the built-in footer: run /builtin-footer, or rename/delete this file and /reload.
 */

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, relative, sep } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

// ── Tokyo Night palette ──────────────────────────────────
const tn = {
	blue: "#7aa2f7",
	cyan: "#7dcfff",
	teal: "#73daca",
	green: "#9ece6a",
	yellow: "#e0af68",
	orange: "#ff9e64",
	red: "#f7768e",
	magenta: "#bb9af7",
	fg: "#c0caf5",
	comment: "#565f89",
	dark: "#3b4261",
};

const RESET = "\x1b[0m";
const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)).join(";");
const fg = (h: string, s: string) => `\x1b[38;2;${hex(h)}m${s}${RESET}`;
const bold = (h: string, s: string) => `\x1b[1;38;2;${hex(h)}m${s}${RESET}`;
const dim = (s: string) => fg(tn.comment, s);
const SEP = ` ${fg(tn.dark, "│")} `;

// Same formatting as the built-in footer
function formatTokens(n: number): string {
	if (n < 1000) return `${n}`;
	if (n < 10000) return `${(n / 1000).toFixed(1)}k`;
	if (n < 1000000) return `${Math.round(n / 1000)}k`;
	if (n < 10000000) return `${(n / 1000000).toFixed(1)}M`;
	return `${Math.round(n / 1000000)}M`;
}

function formatCwd(cwd: string): string {
	const rel = relative(homedir(), cwd);
	if (rel === "") return "~";
	if (rel.startsWith("..") || rel.startsWith(sep)) return cwd;
	return `~${sep}${rel}`;
}

function bar(percent: number, color: string, cells = 10): string {
	const filled = Math.min(cells, Math.round((percent / 100) * cells));
	return fg(color, "━".repeat(filled)) + fg(tn.dark, "━".repeat(cells - filled));
}

function autoCompactEnabled(cwd: string): boolean {
	let enabled = true;
	for (const file of [join(homedir(), ".pi", "agent", "settings.json"), join(cwd, ".pi", "settings.json")]) {
		try {
			const value = JSON.parse(readFileSync(file, "utf8"))?.compaction?.enabled;
			if (typeof value === "boolean") enabled = value;
		} catch {}
	}
	return enabled;
}

function sessionStats(ctx: ExtensionContext) {
	const totals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };
	let cacheHitRate: number | undefined;
	let lastResponseModel: string | undefined;
	const add = (u: any) => {
		totals.input += u.input;
		totals.output += u.output;
		totals.cacheRead += u.cacheRead;
		totals.cacheWrite += u.cacheWrite;
		totals.cost += u.cost.total;
	};
	for (const e of ctx.sessionManager.getEntries() as any[]) {
		if (e.type === "usage") add(e.usage);
		else if (e.type === "message" && e.message.role === "assistant") {
			const u = e.message.usage;
			add(u);
			const prompt = u.input + u.cacheRead + u.cacheWrite;
			cacheHitRate = prompt > 0 ? (u.cacheRead / prompt) * 100 : undefined;
			lastResponseModel = e.message.responseModel ?? e.message.model;
		} else if (e.type === "message" && e.message.role === "toolResult" && e.message.usage) add(e.message.usage);
		else if ((e.type === "branch_summary" || e.type === "compaction") && e.usage) add(e.usage);
	}
	return { totals, cacheHitRate, lastResponseModel };
}

// ── GitHub Copilot AI credits ────────────────────────────
type CopilotCredits = {
	entitlement: number;
	remaining: number;
	percentRemaining: number;
	unlimited: boolean;
	overageCount: number;
	overagePermitted: boolean;
	resetDate?: string;
};

let credits: CopilotCredits | undefined;
let creditsFetchedAt = 0;
let creditsInFlight = false;

/** Fetch premium/AI credit quota using the GitHub OAuth token pi stores for Copilot. Throttled. */
async function refreshCopilotCredits(onUpdate: () => void, force = false) {
	if (creditsInFlight || (!force && Date.now() - creditsFetchedAt < 30_000)) return;
	creditsInFlight = true;
	try {
		const auth = JSON.parse(readFileSync(join(homedir(), ".pi", "agent", "auth.json"), "utf8"))["github-copilot"];
		if (!auth?.refresh) return;
		const domain = auth.enterpriseUrl ? String(auth.enterpriseUrl).replace(/^https?:\/\//, "").replace(/\/.*$/, "") : "github.com";
		const res = await fetch(`https://api.${domain}/copilot_internal/user`, {
			headers: { Authorization: `token ${auth.refresh}`, Accept: "application/json" },
			signal: AbortSignal.timeout(10_000),
		});
		if (!res.ok) return;
		const data: any = await res.json();
		const q = data?.quota_snapshots?.premium_interactions;
		if (!q) return;
		credits = {
			entitlement: q.entitlement,
			remaining: q.remaining,
			percentRemaining: q.percent_remaining,
			unlimited: q.unlimited,
			overageCount: q.overage_count ?? 0,
			overagePermitted: q.overage_permitted,
			resetDate: data.quota_reset_date_utc ?? data.quota_reset_date,
		};
		creditsFetchedAt = Date.now();
		onUpdate();
	} catch {
		// offline / not logged in: keep last known value
	} finally {
		creditsInFlight = false;
	}
}

function renderCredits(c: CopilotCredits): string {
	const label = `${fg(tn.comment, " ")}${dim("credits")}`;
	if (c.unlimited) return `${label} ${fg(tn.green, "unlimited")}`;
	const pct = c.percentRemaining;
	const color = pct < 10 ? tn.red : pct < 30 ? tn.yellow : tn.green;
	let s = `${label} ${bar(pct, color, 8)} ${fg(color, formatTokens(c.remaining))}${dim(`/${formatTokens(c.entitlement)} left`)}`;
	if (c.resetDate) {
		const d = new Date(c.resetDate);
		if (!Number.isNaN(d.getTime())) {
			s += ` ${dim(`· resets ${d.toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" })}`)}`;
		}
	}
	// Included credits exhausted: extra usage is billed
	if (c.overageCount > 0 || (c.remaining <= 0 && c.overagePermitted)) {
		const badge = c.overageCount > 0 ? ` 💸 OVERAGE ${formatTokens(c.overageCount)} · BILLED ` : " 💸 BILLED PER USE ";
		s += ` \x1b[1;38;2;${hex("#1a1b26")};48;2;${hex(tn.red)}m${badge}${RESET}`;
	}
	return s;
}

export default function (pi: ExtensionAPI) {
	let requestRender = () => {};
	const isCopilot = (ctx: ExtensionContext) => ctx.model?.provider === "github-copilot";
	const maybeRefreshCredits = (ctx: ExtensionContext, force = false) => {
		if (ctx.hasUI && isCopilot(ctx)) void refreshCopilotCredits(() => requestRender(), force);
	};

	const install = (ctx: ExtensionContext) => {
		if (!ctx.hasUI) return;
		const autoCompact = autoCompactEnabled(ctx.cwd);

		ctx.ui.setFooter((tui, _theme, footerData) => {
			requestRender = () => tui.requestRender();
			const unsub = footerData.onBranchChange(() => tui.requestRender());

			return {
				dispose: unsub,
				invalidate() {},
				render(width: number): string[] {
					const model = ctx.model;
					const { totals, cacheHitRate, lastResponseModel } = sessionStats(ctx);

					// ── Line 1: location ──
					let loc = `${fg(tn.blue, " ")}${bold(tn.blue, formatCwd(ctx.sessionManager.getCwd()))}`;
					const branch = footerData.getGitBranch();
					if (branch) loc += `  ${fg(tn.magenta, ` ${branch}`)}`;
					const sessionName = pi.getSessionName();
					if (sessionName) loc += `  ${fg(tn.teal, `󰆍 ${sessionName}`)}`;
					// Copilot AI credits, right-aligned on line 1
					if (model?.provider === "github-copilot" && credits) {
						const cr = renderCredits(credits);
						const gap = width - visibleWidth(loc) - visibleWidth(cr);
						if (gap >= 2) loc += " ".repeat(gap) + cr;
					}

					// ── Line 2 left: usage ──
					const parts: string[] = [];
					if (totals.input || totals.output) {
						const io: string[] = [];
						if (totals.input) io.push(fg(tn.cyan, `↑${formatTokens(totals.input)}`));
						if (totals.output) io.push(fg(tn.green, `↓${formatTokens(totals.output)}`));
						parts.push(`${dim("tokens")} ${io.join(" ")}`);
					}
					if (totals.cacheRead || totals.cacheWrite) {
						const c: string[] = [];
						if (totals.cacheRead) c.push(fg(tn.teal, `R${formatTokens(totals.cacheRead)}`));
						if (totals.cacheWrite) c.push(fg(tn.yellow, `W${formatTokens(totals.cacheWrite)}`));
						if (cacheHitRate !== undefined) c.push(`${fg(tn.fg, `${cacheHitRate.toFixed(1)}%`)} ${dim("hit")}`);
						parts.push(`${dim("cache")} ${c.join(" ")}`);
					}
					const usingSubscription = model
						? model.provider === "kimi-coding" || ctx.modelRegistry.isUsingOAuth(model)
						: false;
					if (totals.cost || usingSubscription) {
						parts.push(
							fg(tn.orange, `$${totals.cost.toFixed(3)}`) + (usingSubscription ? ` ${dim("sub")}` : ""),
						);
					}

					const usage = ctx.getContextUsage();
					const window = usage?.contextWindow ?? model?.contextWindow ?? 0;
					const pct = usage?.percent ?? 0;
					const known = usage?.percent != null;
					const ctxColor = pct > 90 ? tn.red : pct > 70 ? tn.yellow : tn.green;
					parts.push(
						`${dim("ctx")} ${bar(known ? pct : 0, ctxColor)} ` +
							fg(known ? ctxColor : tn.comment, known ? `${pct.toFixed(1)}%` : "?") +
							dim(`/${formatTokens(window)}`) +
							(autoCompact ? ` ${dim("auto")}` : ""),
					);
					const left = parts.join(SEP);

					// ── Line 2 right: model ──
					let right = bold(tn.blue, model?.id || "no-model");
					if (model?.reasoning) {
						const level = pi.getThinkingLevel() || "off";
						right += ` ${dim("•")} ${fg(level === "off" ? tn.comment : tn.magenta, level === "off" ? "thinking off" : level)}`;
					}
					// Virtual/routed models: show where the latest response actually went
					if (model && lastResponseModel && lastResponseModel !== model.id) {
						right += ` ${dim("→")} ${fg(tn.cyan, lastResponseModel)}`;
					}
					if (footerData.getAvailableProviderCount() > 1 && model) {
						const withProvider = `${fg(tn.comment, `(${model.provider})`)} ${right}`;
						if (visibleWidth(left) + 2 + visibleWidth(withProvider) <= width) right = withProvider;
					}

					const leftW = visibleWidth(left);
					const rightW = visibleWidth(right);
					let stats: string;
					if (leftW + 2 + rightW <= width) stats = left + " ".repeat(width - leftW - rightW) + right;
					else if (width - leftW - 2 > 0) stats = left + "  " + truncateToWidth(right, width - leftW - 2, "");
					else stats = truncateToWidth(left, width, dim("..."));

					const lines = [truncateToWidth(loc, width, dim("...")), stats];

					// ── Line 3: extension statuses ──
					const statuses = footerData.getExtensionStatuses();
					if (statuses.size > 0) {
						const text = Array.from(statuses.entries())
							.sort(([a], [b]) => a.localeCompare(b))
							.map(([, t]) => t.replace(/[\r\n\t]/g, " ").replace(/ +/g, " ").trim())
							.join(SEP);
						lines.push(truncateToWidth(text, width, dim("...")));
					}
					return lines;
				},
			};
		});
	};

	pi.on("session_start", async (_event, ctx) => {
		install(ctx);
		maybeRefreshCredits(ctx, true);
	});
	pi.on("model_select", async (event, ctx) => {
		if (event.model.provider === "github-copilot") void refreshCopilotCredits(() => requestRender(), true);
	});
	pi.on("turn_end", async (_event, ctx) => maybeRefreshCredits(ctx));

	pi.registerCommand("tokyo-footer", {
		description: "Enable the Tokyo Night footer",
		handler: async (_args, ctx) => install(ctx),
	});

	pi.registerCommand("builtin-footer", {
		description: "Restore the built-in footer",
		handler: async (_args, ctx) => {
			ctx.ui.setFooter(undefined);
			ctx.ui.notify("Built-in footer restored", "info");
		},
	});
}

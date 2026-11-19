/**
 * router — delegate work from the main Pi session to three tiers:
 *
 *   local   → LM Studio model via a child `pi` process (free, private, bulk work)
 *   copilot → GitHub Copilot model via a child `pi` process (day-to-day implementation)
 *   claude  → the official Claude Code CLI (`claude -p`), read-only (planning & review)
 *
 * Each delegated task runs in a fresh, isolated context and only the final answer
 * comes back to the main session, so the orchestrator's context stays small.
*
* p
* Example prompt:
* pPlan the new date-range form field component with claude, save it to PLAN.md,
* then have local execute steps 1–3 one at a time and verify tests after each.
 *
 * Config: ~/.pi/agent/router.json (optional, see DEFAULTS below).
 * Install: put this folder at ~/.pi/agent/extensions/router/
 */

import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import {
	DEFAULT_MAX_BYTES,
	DEFAULT_MAX_LINES,
	type ExtensionAPI,
	formatSize,
	getAgentDir,
	truncateTail,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

type Tier = "local" | "copilot" | "claude";
const TIERS: Tier[] = ["local", "copilot", "claude"];

interface PiTierConfig {
	/** "provider/model-id", e.g. "lmstudio/local". Omit to use the provider default. */
	model?: string;
	thinking?: string;
	/** Extra instructions appended to the child agent's system prompt. */
	role: string;
	timeoutSec: number;
}

interface ClaudeTierConfig {
	/** Claude Code model alias, e.g. "opus" or "sonnet". Omit for Claude Code's default. */
	model?: string;
	/** Claude Code tools the delegate may use. Read-only by default. */
	allowedTools: string[];
	role: string;
	timeoutSec: number;
}

interface RouterConfig {
	local: PiTierConfig;
	copilot: PiTierConfig;
	claude: ClaudeTierConfig;
}

const DEFAULTS: RouterConfig = {
	local: {
		model: "lmstudio/local",
		role:
			"You are an execution worker. Do exactly the task given, nothing more. " +
			"Make small, mechanical edits, run the relevant tests, and finish with a short summary " +
			"of changed files and test results. If the task is ambiguous, stop and say what is unclear.",
		timeoutSec: 1800,
	},
	copilot: {
		// Run `pi --list-models copilot` after /login and put the model you want here.
		model: undefined,
		role:
			"You are an implementation worker on an Angular codebase. Implement the task, follow existing " +
			"patterns in the repo, run lint and tests, and finish with a concise summary of changes.",
		timeoutSec: 1800,
	},
	claude: {
		model: undefined,
		allowedTools: ["Read", "Grep", "Glob"],
		role:
			"You are the planner/reviewer. You cannot edit files. Produce a concrete, step-by-step plan " +
			"(or review) with small, independently verifiable steps a less capable model can execute. " +
			"Reference exact file paths.",
		timeoutSec: 900,
	},
};

function loadConfig(): RouterConfig {
	const file = path.join(getAgentDir(), "router.json");
	if (!fs.existsSync(file)) return DEFAULTS;
	try {
		const user = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<RouterConfig>;
		return {
			local: { ...DEFAULTS.local, ...user.local },
			copilot: { ...DEFAULTS.copilot, ...user.copilot },
			claude: { ...DEFAULTS.claude, ...user.claude },
		};
	} catch (err) {
		throw new Error(`router: could not parse ${file}: ${(err as Error).message}`);
	}
}

interface RunResult {
	exitCode: number;
	output: string;
	stderr: string;
	model?: string;
	aborted: boolean;
	timedOut: boolean;
}

/** Spawn a process, stream stdout lines to onLine, honour abort + timeout. */
function runProcess(
	command: string,
	args: string[],
	cwd: string,
	timeoutSec: number,
	signal: AbortSignal | undefined,
	onLine: (line: string) => void,
): Promise<{ exitCode: number; stderr: string; aborted: boolean; timedOut: boolean }> {
	return new Promise((resolve) => {
		const proc = spawn(command, args, { cwd, shell: false, stdio: ["ignore", "pipe", "pipe"] });
		let buffer = "";
		let stderr = "";
		let aborted = false;
		let timedOut = false;

		const kill = () => {
			proc.kill("SIGTERM");
			setTimeout(() => {
				if (!proc.killed) proc.kill("SIGKILL");
			}, 5000);
		};
		const timer = setTimeout(() => {
			timedOut = true;
			kill();
		}, timeoutSec * 1000);
		const onAbort = () => {
			aborted = true;
			kill();
		};
		if (signal?.aborted) onAbort();
		else signal?.addEventListener("abort", onAbort, { once: true });

		proc.stdout.on("data", (chunk) => {
			buffer += chunk.toString();
			const lines = buffer.split("\n");
			buffer = lines.pop() ?? "";
			for (const line of lines) onLine(line);
		});
		proc.stderr.on("data", (chunk) => {
			stderr += chunk.toString();
		});
		proc.on("error", (err) => {
			stderr += `\n${err.message}`;
		});
		proc.on("close", (code) => {
			clearTimeout(timer);
			signal?.removeEventListener("abort", onAbort);
			if (buffer.trim()) onLine(buffer);
			resolve({ exitCode: code ?? 1, stderr, aborted, timedOut });
		});
	});
}

/** Child `pi` in JSON mode; keep the last assistant text as the answer. */
async function runPiTier(
	cfg: PiTierConfig,
	task: string,
	readOnly: boolean,
	cwd: string,
	signal: AbortSignal | undefined,
	onProgress: (text: string) => void,
): Promise<RunResult> {
	const args = ["--mode", "json", "-p", "--no-session", "--no-extensions", "--append-system-prompt", cfg.role];
	if (cfg.model) args.push("--model", cfg.model);
	if (cfg.thinking) args.push("--thinking", cfg.thinking);
	if (readOnly) args.push("--tools", "read,grep,find,ls");
	args.push("--", task);

	let output = "";
	let model: string | undefined;
	let turns = 0;

	const res = await runProcess("pi", args, cwd, cfg.timeoutSec, signal, (line) => {
		if (!line.trim()) return;
		let event: any;
		try {
			event = JSON.parse(line);
		} catch {
			return;
		}
		if (event.type === "message_end" && event.message?.role === "assistant") {
			turns++;
			model ??= event.message.model;
			const text = (event.message.content ?? [])
				.filter((p: any) => p.type === "text")
				.map((p: any) => p.text)
				.join("\n")
				.trim();
			if (text) output = text;
			onProgress(`turn ${turns}${text ? `: ${text.slice(0, 120)}` : ""}`);
		}
	});
	return { ...res, output, model };
}

/** Official Claude Code CLI in headless mode (covered by the Claude subscription). */
async function runClaudeTier(
	cfg: ClaudeTierConfig,
	task: string,
	cwd: string,
	signal: AbortSignal | undefined,
	onProgress: (text: string) => void,
): Promise<RunResult> {
	const args = [
		"-p",
		"--output-format",
		"text",
		"--allowedTools",
		cfg.allowedTools.join(","),
		"--append-system-prompt",
		cfg.role,
	];
	if (cfg.model) args.push("--model", cfg.model);
	args.push(task);

	const lines: string[] = [];
	onProgress("claude is thinking…");
	const res = await runProcess("claude", args, cwd, cfg.timeoutSec, signal, (line) => lines.push(line));
	return { ...res, output: lines.join("\n").trim(), model: cfg.model ?? "claude-code default" };
}

const ROUTING_POLICY = `Delegate a task to another model in an isolated context. Only its final answer comes back.

Tiers:
- "claude": planning, architecture, tricky debugging analysis, code review. READ-ONLY: it returns a plan or review; you write it to a file (e.g. PLAN.md) yourself. Scarce quota: use for thinking, not for volume.
- "copilot": normal feature implementation and medium-complexity edits on the main project.
- "local": mechanical, high-volume or private work: applying one plan step, renames, test/spec generation, docs, boilerplate. Free, but weaker: give it one small, precise step at a time with exact file paths and the command that verifies it.

Write the task fully self-contained: the delegate cannot see this conversation. After a "local" or "copilot" task, verify the result (read the diff / run tests) before moving on.`;

export default function (pi: ExtensionAPI) {
	pi.registerTool({
		name: "delegate",
		label: "Delegate",
		description: ROUTING_POLICY,
		parameters: Type.Object({
			tier: Type.String({ enum: TIERS, description: 'One of "local", "copilot", "claude"' }),
			task: Type.String({ description: "Complete, self-contained task description" }),
			readOnly: Type.Optional(
				Type.Boolean({ description: "local/copilot only: restrict to read tools (analysis, no edits)" }),
			),
		}),

		async execute(_toolCallId, params, signal, onUpdate, ctx) {
			const tier = params.tier as Tier;
			if (!TIERS.includes(tier)) throw new Error(`Unknown tier "${params.tier}". Use one of: ${TIERS.join(", ")}`);

			const config = loadConfig();
			const progress = (text: string) =>
				onUpdate?.({ content: [{ type: "text", text: `[${tier}] ${text}` }], details: undefined });

			const started = Date.now();
			const result =
				tier === "claude"
					? await runClaudeTier(config.claude, params.task, ctx.cwd, signal, progress)
					: await runPiTier(config[tier], params.task, params.readOnly ?? false, ctx.cwd, signal, progress);
			const seconds = Math.round((Date.now() - started) / 1000);

			if (result.aborted) throw new Error(`[${tier}] delegation aborted`);
			if (result.timedOut) throw new Error(`[${tier}] timed out after ${seconds}s. Split the task into smaller steps.`);
			if (result.exitCode !== 0 || !result.output) {
				const why = result.stderr.trim().split("\n").slice(-15).join("\n") || "(no output)";
				throw new Error(`[${tier}] failed (exit ${result.exitCode}):\n${why}`);
			}

			const t = truncateTail(result.output, { maxLines: DEFAULT_MAX_LINES, maxBytes: DEFAULT_MAX_BYTES });
			let text = `[${tier} · ${result.model ?? "default model"} · ${seconds}s]\n\n${t.content}`;
			if (t.truncated) {
				text += `\n\n[Output truncated to last ${t.outputLines} lines (${formatSize(t.outputBytes)} of ${formatSize(t.totalBytes)}).]`;
			}

			return {
				content: [{ type: "text", text }],
				details: { tier, model: result.model, seconds, exitCode: result.exitCode },
			};
		},
	});

	pi.registerCommand("route", {
		description: "Show which model each delegate tier uses",
		handler: async (_args, ctx) => {
			try {
				const c = loadConfig();
				ctx.ui.notify(
					[
						`claude  → Claude Code (${c.claude.model ?? "default"}), tools: ${c.claude.allowedTools.join(",")}`,
						`copilot → ${c.copilot.model ?? "(provider default — set copilot.model in router.json)"}`,
						`local   → ${c.local.model ?? "(provider default)"}`,
					].join("\n"),
					"info",
				);
			} catch (err) {
				ctx.ui.notify((err as Error).message, "error");
			}
		},
	});
}

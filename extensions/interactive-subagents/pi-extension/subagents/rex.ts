/**
 * Rex backend for the surface layer in tmux.ts.
 *
 * Surfaces are Rex block ids (e.g. `block:01a1…`). The first subagent pane is
 * a right split off the parent pi's block (`$REX_BLOCK`); later ones stack
 * below the most recent live subagent pane, so the parent keeps half the
 * window instead of being halved on every spawn.
 */
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** Subagent blocks created by this process that are still open, oldest first. */
const liveSurfaces: string[] = [];

function sessionArgs(): string[] {
  const session = process.env.REX_SESSION;
  return session ? ["-s", session] : [];
}

function split(
  name: string,
  direction: "right" | "left" | "above" | "below",
  anchor?: string,
): string {
  const args = ["split", ...sessionArgs()];
  if (anchor) args.push("-b", anchor);
  args.push("--split", direction, "--focus=false", "-c", process.cwd(), "--json");
  if (name) args.push("--label", name);

  const out = execFileSync("rex", args, { encoding: "utf8" });
  const block = JSON.parse(out)?.block_ids?.[0];
  if (typeof block !== "string" || !block.startsWith("block:")) {
    throw new Error(`Unexpected rex split output: ${out.trim()}`);
  }
  return block;
}

export function rexCreateSurface(name: string): string {
  const parent = process.env.REX_BLOCK;
  const last = liveSurfaces[liveSurfaces.length - 1];

  let block: string | undefined;
  if (last) {
    try {
      block = split(name, "below", last);
    } catch {
      // The user may have closed that pane by hand; fall back to the parent.
      liveSurfaces.length = 0;
    }
  }
  block ??= split(name, "right", parent);

  liveSurfaces.push(block);
  return block;
}

export function rexCreateSurfaceSplit(
  name: string,
  direction: "left" | "right" | "up" | "down",
  fromSurface?: string,
): string {
  const rexDirection = direction === "up" ? "above" : direction === "down" ? "below" : direction;
  const block = split(name, rexDirection, fromSurface ?? process.env.REX_BLOCK);
  liveSurfaces.push(block);
  return block;
}

/** Type text literally (via stdin, so leading dashes are safe) and press Return. */
export function rexSendCommand(surface: string, command: string): void {
  execFileSync("rex", ["send", "-b", surface], { input: command, encoding: "utf8" });
  execFileSync("rex", ["send-key", "-b", surface, "enter"], { encoding: "utf8" });
}

/**
 * `rex capture` prints the whole scrollback, so keep only the tail. tmux's
 * equivalent returns the visible screen plus `lines` of history; a small
 * margin keeps short reads (the exit sentinel) from missing it behind a
 * multi-line prompt.
 */
function tail(text: string, lines: number): string {
  const keep = Math.max(1, lines) + 20;
  return text.replace(/\n+$/, "").split("\n").slice(-keep).join("\n") + "\n";
}

const CAPTURE_OPTIONS = { encoding: "utf8", maxBuffer: 128 * 1024 * 1024 } as const;

export function rexReadScreen(surface: string, lines: number): string {
  return tail(execFileSync("rex", ["capture", "-b", surface, "--trim"], CAPTURE_OPTIONS), lines);
}

export async function rexReadScreenAsync(surface: string, lines: number): Promise<string> {
  const { stdout } = await execFileAsync(
    "rex",
    ["capture", "-b", surface, "--trim"],
    CAPTURE_OPTIONS,
  );
  return tail(stdout, lines);
}

export function rexCloseSurface(surface: string): void {
  const index = liveSurfaces.indexOf(surface);
  if (index !== -1) liveSurfaces.splice(index, 1);
  execFileSync("rex", ["block", "close", surface], { encoding: "utf8" });
}

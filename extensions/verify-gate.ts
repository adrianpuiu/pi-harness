/**
 * verify-gate.ts — executable verification as an escalation tier (report §5.2).
 *
 * Pi has no Stop hook, so this gates at `agent_settled`: when the agent
 * finishes and a check is configured, the harness runs it. Failure loops the
 * agent back with a typed digest (steer message), max 3 cycles per task.
 *
 * Zero-config check discovery (first match wins):
 *   1. .harness/verify.sh        — project-owned check script
 *   2. package.json scripts.test — npm test
 *
 * Auto-verify fires only when the agent mutated files during the task, so
 * pure Q&A runs never trigger tests.
 *
 * Psychology (DESIGN.md):
 * - Peak-end rule: a green "checks green" card is the last thing seen after a
 *   run — the run *ends* on verification, not on tool noise.
 * - Predictable feedback: every mutation is followed by a deterministic ✓/✗
 *   within a fixed budget. Variable feedback breeds anxiety and mistrust.
 *
 * Bug-hunt hardening (F01/F03/F08): a killed or timed-out child is NEVER a
 * green check; check failures crash-proof the gate (stuck state is worse
 * than a red card); checks are abortable per task so stale ones cannot
 * linger as zombie processes.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { truncateTail } from "@earendil-works/pi-coding-agent";
import { VERIFY_ENTRY, type VerifyData } from "./lib/constants.ts";

const MAX_CYCLES = 3;
const TIMEOUT_MS = 180_000;

interface Check {
	label: string;
	command: string;
	args: string[];
}

interface CheckOutcome {
	ok: boolean;
	killed: boolean;
	digest: string;
	seconds: number;
}

interface GateState {
	cycles: number;
	mutated: boolean;
	controller: AbortController | undefined;
}

function detectCheck(cwd: string): Check | undefined {
	const script = join(cwd, ".harness", "verify.sh");
	if (existsSync(script)) return { label: ".harness/verify.sh", command: "bash", args: [script] };
	return detectNpmTest(cwd);
}

function detectNpmTest(cwd: string): Check | undefined {
	const pkgPath = join(cwd, "package.json");
	if (!existsSync(pkgPath)) return undefined;
	try {
		const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { scripts?: Record<string, string> };
		if (pkg.scripts?.test) return { label: "npm test", command: "npm", args: ["test"] };
	} catch {
		return undefined;
	}
	return undefined;
}

async function runCheck(pi: ExtensionAPI, check: Check, signal?: AbortSignal): Promise<CheckOutcome> {
	const started = Date.now();
	const result = await pi.exec(check.command, check.args, { timeout: TIMEOUT_MS, signal });
	const seconds = (Date.now() - started) / 1000;
	const output = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
	// F01: a killed child (timeout/abort) exits with code null→0 — never green.
	const ok = result.code === 0 && !result.killed;
	const digest =
		ok ? output : truncateTail(output || "(no output)", { maxLines: 20, maxBytes: 1200 }).content;
	return { ok, killed: result.killed === true, digest, seconds };
}

/** A superseded check (its task ended) must not judge or steer the next task. */
function isSuperseded(outcome: CheckOutcome, signal: AbortSignal | undefined): boolean {
	return outcome.killed && signal?.aborted === true;
}

function appendVerify(pi: ExtensionAPI, data: VerifyData): void {
	pi.appendEntry(VERIFY_ENTRY, data satisfies VerifyData);
}

async function verifyTask(pi: ExtensionAPI, ctx: ExtensionContext, check: Check, state: GateState): Promise<void> {
	const signal = state.controller?.signal;
	try {
		const outcome = await runCheck(pi, check, signal);
		if (isSuperseded(outcome, signal)) {
			appendVerify(pi, { status: "gave-up", label: check.label, seconds: outcome.seconds, digest: "check aborted — task superseded" });
			return;
		}
		if (outcome.ok) {
			state.mutated = false;
			state.cycles = 0;
			appendVerify(pi, { status: "ok", label: check.label, seconds: outcome.seconds });
			return;
		}
		if (state.cycles >= MAX_CYCLES) {
			state.mutated = false;
			state.cycles = 0;
			appendVerify(pi, { status: "gave-up", label: check.label, seconds: outcome.seconds, digest: outcome.digest });
			ctx.ui.notify(`Checks still red after ${MAX_CYCLES} fix cycles — handing back to you.`, "warning");
			return;
		}
		state.cycles += 1;
		appendVerify(pi, { status: "failed", label: check.label, seconds: outcome.seconds, digest: outcome.digest });
		if (ctx.mode === "print") {
			// E2E finding: a -p session is disposed at settle — a steer cannot start
			// another run and spooks stale-ctx events. Record the verdict for the
			// transcript instead; the interactive fix loop stays TUI-only.
			return;
		}
		pi.sendUserMessage(
			`Verification failed (${check.label}). Fix the failures and make checks pass before settling.\n\n${outcome.digest}`,
			{ deliverAs: "steer" },
		);
	} catch (error) {
		// F03: a crashed check (spawn ENOENT, npm missing) must never wedge the
		// gate — clear the mutation flag and surface a red card instead.
		state.mutated = false;
		appendVerify(pi, {
			status: "gave-up",
			label: check.label,
			seconds: 0,
			digest: `check crashed: ${(error as Error).message}`,
		});
	}
}

export default function (pi: ExtensionAPI) {
	const state: GateState = { cycles: 0, mutated: false, controller: undefined };
	let inFlight: Promise<void> | undefined;

	pi.on("before_agent_start", async () => {
		// F08: a stale check from the previous task dies with its controller.
		state.controller?.abort();
		state.controller = new AbortController();
	});

	pi.on("tool_execution_end", async (event) => {
		if (event.toolName === "write" || event.toolName === "edit") state.mutated = true;
	});

	pi.on("agent_settled", async (_event, ctx) => {
		if (inFlight) return; // F10: one check at a time — never race test runs
		const check = detectCheck(ctx.cwd);
		if (!check) {
			state.mutated = false; // no check configured — never carry a stale mutation flag
			return;
		}
		if (!state.mutated) return;
		inFlight = verifyTask(pi, ctx, check, state).finally(() => {
			inFlight = undefined;
		});
		await inFlight;
	});

	pi.registerCommand("verify", {
		description: "Run the verification check now and show the result",
		handler: async (_args, ctx) => {
			const check = detectCheck(ctx.cwd);
			if (!check) {
				ctx.ui.notify("No check found — add .harness/verify.sh or a package.json test script.", "warning");
				return;
			}
			if (inFlight) {
				ctx.ui.notify("A check is already running — its card will land when it settles.", "info");
				return;
			}
			ctx.ui.setStatus("harness.verify", "running checks…");
			inFlight = (async () => {
				try {
					const outcome = await runCheck(pi, check, state.controller?.signal);
					appendVerify(pi, {
						status: outcome.ok ? "ok" : "failed",
						label: check.label,
						seconds: outcome.seconds,
						digest: outcome.digest,
					});
					ctx.ui.notify(outcome.ok ? "Checks green ✓" : "Checks failed ✗ (see card)", outcome.ok ? "info" : "warning");
				} catch (error) {
					appendVerify(pi, { status: "gave-up", label: check.label, seconds: 0, digest: `check crashed: ${(error as Error).message}` });
					ctx.ui.notify("Check crashed (see card)", "warning");
				} finally {
					ctx.ui.setStatus("harness.verify", undefined); // F03: never leave the status stuck
					inFlight = undefined;
				}
			})();
			await inFlight;
		},
	});
}

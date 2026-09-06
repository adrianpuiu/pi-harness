/**
 * long-run.ts — cross-window continuity for multi-session tasks.
 *
 * Ports the long-running-agent pattern (Anthropic engineering, Nov 2025):
 * agents fail across context windows by one-shotting (context death mid-
 * feature, undocumented half-work) or premature victory (a later session
 * sees progress and declares done). Their harness: an initializer prompt
 * scaffolds environment + feature ledger; every later session runs an
 * orientation ritual (progress file → git log → smoke check) BEFORE new
 * work, then makes incremental progress and leaves a clean state.
 *
 * Mapping onto pi hooks:
 * - /longrun <goal> — initializer steer (explicit invocation, no mind-reading)
 * - resume ritual   — session_start{resume|fork} in TUI when MISSION.md exists
 * - /ritual         — manual orientation trigger
 * - ledger guard    — deterministic no-fake-progress validation of MISSION.md /
 *   features.json edits: ticks may only close, open steps/features may not
 *   vanish or have their text rewritten into "done". Course-changes (adding
 *   or rewriting steps) stay legal — mission-control explicitly allows them;
 *   the guard only protects *progress honesty* (§10.1: advisory instructions
 *   never confer capability — this one is deterministic).
 *
 * Print-mode lesson (.harness/memories/pi-print-mode.md): no auto-steers in
 * `-p` — the resume ritual is TUI-only. /longrun works everywhere because
 * the user invokes it explicitly.
 */

import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { AUDIT_ENTRY, type AuditData } from "./lib/constants.ts";

export interface LedgerViolation {
	rule: string;
	detail: string;
}

interface MissionStep {
	ticked: boolean;
	body: string;
}

interface FeatureItem {
	description?: string;
	steps?: unknown;
	passes?: boolean;
}

function stepsOf(text: string): MissionStep[] {
	const steps: MissionStep[] = [];
	for (const line of text.split("\n")) {
		const match = /^- \[( |x|X)\]\s*(.*)$/.exec(line.trim());
		if (match) steps.push({ ticked: match[1] !== " ", body: match[2] ?? "" });
	}
	return steps;
}

/** Ticks may only close ([ ]→[x]); open steps may not vanish; un-ticking is rollback. */
export function validateMissionTransition(oldText: string, newText: string): LedgerViolation[] {
	const before = stepsOf(oldText);
	const after = stepsOf(newText);
	const afterByBody = new Map(after.map((step) => [step.body, step.ticked]));
	const violations: LedgerViolation[] = [];
	for (const step of before) {
		const afterState = afterByBody.get(step.body);
		if (afterState === undefined) {
			if (!step.ticked) violations.push({ rule: "ledger:open-step-removed", detail: step.body.slice(0, 80) });
			continue;
		}
		if (step.ticked && !afterState) violations.push({ rule: "ledger:progress-rollback", detail: step.body.slice(0, 80) });
	}
	return violations;
}

/** Feature entries are immutable except passes false→true; entries may be added, never removed. */
export function validateFeaturesTransition(oldRaw: string, newRaw: string): LedgerViolation[] {
	let before: FeatureItem[];
	let after: FeatureItem[];
	try {
		const parsedOld = JSON.parse(oldRaw);
		const parsedNew = JSON.parse(newRaw);
		if (!Array.isArray(parsedOld) || !Array.isArray(parsedNew)) return [];
		before = parsedOld;
		after = parsedNew;
	} catch {
		return [];
	}
	const afterByDescription = new Map(after.map((item) => [String(item.description ?? ""), item]));
	const violations: LedgerViolation[] = [];
	for (const item of before) {
		const key = String(item.description ?? "");
		const match = afterByDescription.get(key);
		if (!match) {
			violations.push({ rule: "ledger:feature-removed", detail: key.slice(0, 80) });
			continue;
		}
		if (JSON.stringify(item.steps) !== JSON.stringify(match.steps)) {
			violations.push({ rule: "ledger:feature-edited", detail: key.slice(0, 80) });
		}
		if (item.passes === true && match.passes !== true) {
			violations.push({ rule: "ledger:passes-rollback", detail: key.slice(0, 80) });
		}
	}
	return violations;
}

/* ------------------------------ prompts ------------------------------ */

const INITIALIZER = (goal: string) =>
	[
		"You are the INITIALIZER session for a long-running task. You set up the",
		"environment for future sessions — you do NOT implement features now.",
		"",
		`1. Write .harness/MISSION.md: one-line goal ("${goal}"), a constraints line,`,
		"   and an ordered checklist of concrete verifiable steps (all unticked), under 15 steps.",
		"2. If the task is feature-driven (an app or tool with user-visible behavior),",
		'   write .harness/features.json: a JSON array — [{"category": string,',
		'"description": string, "steps": string[], "passes": false}] — covering EVERY',
		"   required behavior (10–50 entries). This ledger is append-and-tick-only:",
		'   descriptions and steps are immutable; only "passes" may flip false→true',
		"   after careful end-to-end testing. It is unacceptable to remove or edit entries.",
		"3. Ensure a verification check exists: .harness/verify.sh (exit 0 = green)",
		"   or a package.json test script.",
		"4. Commit the scaffolding with a descriptive message.",
		"",
		"Reply with the mission digest (goal, step count, feature count) and stop.",
	].join("\n");

const RITUAL = [
	"Mission resume ritual — orientation BEFORE any new work:",
	"1. Read .harness/MISSION.md; restate goal and open steps in one line.",
	"2. Read .harness/memories/index.md if present — prior sessions' lessons.",
	"3. Run: git log --oneline -20 — recent work and where it stopped.",
	"4. Run the smoke check (.harness/verify.sh, or npm test). If red: fix the",
	"   inherited breakage FIRST — building on a broken base compounds it.",
	"5. Post a one-line state digest (mission progress bar, smoke ✓/✗, next",
	"   open step), then STOP and wait for direction.",
	"",
	"Do not start new features in this turn.",
].join("\n");

/* ------------------------------ wiring ------------------------------ */

function missionFile(cwd: string): string {
	return join(cwd, ".harness", "MISSION.md");
}

export default function (pi: ExtensionAPI) {
	const snapshots = new Map<string, { path: string; content: string }>();

	const ledgerTarget = (toolName: string, input: Record<string, unknown>): string | undefined => {
		if (toolName !== "write" && toolName !== "edit") return undefined;
		const base = String(input.path ?? "").split("/").pop() ?? "";
		return base === "MISSION.md" || base === "features.json" ? String(input.path) : undefined;
	};

	const auditViolation = (violation: LedgerViolation): void => {
		const data: AuditData = { tool: "mission-ledger", decision: "denied", rule: violation.rule, detail: violation.detail, risk: "caution" };
		pi.appendEntry(AUDIT_ENTRY, data satisfies AuditData);
	};

	pi.on("tool_call", async (event, ctx) => {
		const path = ledgerTarget(event.toolName, event.input as Record<string, unknown>);
		if (!path) return undefined;
		let content = "";
		try {
			content = readFileSync(resolve(ctx.cwd, path), "utf8");
		} catch {
			content = ""; // first scaffold — nothing to protect yet
		}
		snapshots.set(event.toolCallId, { path, content });
		return undefined;
	});

	pi.on("tool_execution_end", async (event, ctx) => {
		const snapshot = snapshots.get(event.toolCallId);
		if (!snapshot) return;
		snapshots.delete(event.toolCallId);
		let after = "";
		try {
			after = readFileSync(resolve(ctx.cwd, snapshot.path), "utf8");
		} catch {
			return;
		}
		if (after === snapshot.content) return;
		const violations = snapshot.path.endsWith("features.json")
			? validateFeaturesTransition(snapshot.content, after)
			: validateMissionTransition(snapshot.content, after);
		if (violations.length === 0) return;
		for (const violation of violations) auditViolation(violation);
		const [first] = violations;
		if (!first) return;
		pi.sendUserMessage(
			`Ledger guard: ${first.rule} — "${first.detail}". ` +
				"Restore the removed or rolled-back step/feature exactly as it was. " +
				"If the course genuinely changed, ask the user to approve rewriting the ledger explicitly. " +
				"Progress must stay honest.",
			{ deliverAs: "steer" },
		);
	});

	pi.on("session_start", async (event, ctx) => {
		if (ctx.mode !== "tui") return; // print-mode lesson: no auto-steers in -p
		if (event.reason !== "resume" && event.reason !== "fork") return;
		if (!existsSync(missionFile(ctx.cwd))) return;
		// Idle at session start → the ritual runs as the first turn (A4: get
		// bearings before new work). MISSION.md existing is the long-run opt-in.
		pi.sendUserMessage(RITUAL);
	});

	pi.registerCommand("longrun", {
		description: "Initialize a long-running multi-session task (initializer steer)",
		handler: async (args, ctx) => {
			const goal = args.trim();
			if (!goal) {
				ctx.ui.notify("Usage: /longrun <one-line goal>", "warning");
				return;
			}
			if (existsSync(missionFile(ctx.cwd))) {
				ctx.ui.notify("MISSION.md already exists — continuing the existing mission (resume ritual handles orientation).", "info");
				return;
			}
			pi.sendUserMessage(INITIALIZER(goal));
		},
	});

	pi.registerCommand("ritual", {
		description: "Run the mission orientation ritual now (mission + git log + smoke check)",
		handler: async (_args, ctx) => {
			if (!existsSync(missionFile(ctx.cwd))) {
				ctx.ui.notify("No .harness/MISSION.md — run /longrun <goal> first.", "warning");
				return;
			}
			pi.sendUserMessage(RITUAL);
		},
	});
}

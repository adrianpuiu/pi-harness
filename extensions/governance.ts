/**
 * governance.ts — deterministic gates, enforced by the harness (report §10.1).
 *
 * Precedence: deny → ask → allow. A broad deny can never be punctured by an
 * allow; hook errors fail safe (block).
 *
 * Psychology of the approval dialog (DESIGN.md):
 * - Default bias / loss aversion: silence and timeouts resolve to DENY.
 *   Allowing is always an explicit keystroke ("a"), never a reflex Enter.
 * - Trust calibration: the dialog shows the matched rule and the exact
 *   payload — operators approve actions they understand, not vibes.
 * - Salience: border color encodes risk (red = irreversible, amber = caution);
 *   nothing else in the UI competes for those hues.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { matchesKey, truncateToWidth, visibleWidth, type Component } from "@earendil-works/pi-tui";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { AUDIT_ENTRY, type AuditData, type Decision, type Risk } from "./lib/constants.ts";
import { riskColor } from "./lib/render.ts";

interface Verdict {
	action: "deny" | "ask" | "allow";
	rule: string;
	risk: Risk;
	detail: string;
}

type Pattern = [RegExp, string, Risk?];

interface Match {
	rule: string;
	risk: Risk;
	detail: string;
}

/** Always blocked — no operator prompt can override (managed-deny analog). */
const DENY_BASH: Pattern[] = [
	[/\b(curl|wget)\b[^|\n]*\|\s*(sudo\s+)?(ba)?sh\b/i, "pipe-to-shell"],
	[/\bmkfs(\.\w+)?\b/i, "disk-format"],
	[/\bdd\b[^|\n]*\bof=/i, "raw-disk-write"],
	[/:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;/, "fork-bomb"],
];

/** Requires explicit human approval; timeout resolves to deny. */
interface AskRule {
	rule: string;
	risk?: Risk;
	match(command: string): string | undefined;
}

function regexRule(regex: RegExp, rule: string, risk?: Risk): AskRule {
	return { rule, risk, match: (command) => regex.exec(command)?.[0] };
}

/** Flag tokens (-abc, --long) that follow `cmd`, up to the next pipeline/chain boundary. */
function flagsAfter(command: string, cmd: string): string[] {
	const segment = new RegExp(`\\b${cmd}\\b([^|;&]*)`).exec(command)?.[1] ?? "";
	return segment.match(/(?:^|\s)(-{1,2}[A-Za-z][\w-]*)/g)?.map((token) => token.trim()) ?? [];
}

/** True when any short-flag cluster (-abc) contains `letter`. */
function shortFlag(flags: string[], letter: string): boolean {
	return flags.some((flag) => !flag.startsWith("--") && flag.slice(1).includes(letter));
}

/** F02: recursive delete in ANY flag form — bare `rm -r`, `rm -r -f`, `rm -fr`, `--recursive`. */
const rmRecursive: AskRule = {
	rule: "recursive-delete",
	risk: "irreversible",
	match: (command) => {
		if (!/\brm\b/.test(command)) return undefined;
		const flags = flagsAfter(command, "rm");
		return flags.includes("--recursive") || shortFlag(flags, "r") ? flags.join(" ") : undefined;
	},
};

/** F02: force push — `-f`/`--force`, but NOT `--force-with-lease` (the safe variant). */
const pushForce: AskRule = {
	rule: "force-push",
	risk: "irreversible",
	match: (command) => {
		if (!/\bgit\s+push\b/.test(command)) return undefined;
		const flags = flagsAfter(command, "push");
		return flags.includes("-f") || flags.includes("--force") ? flags.join(" ") : undefined;
	},
};

const cleanForce: AskRule = {
	rule: "git-clean-force",
	risk: "irreversible",
	match: (command) => {
		if (!/\bgit\s+clean\b/.test(command)) return undefined;
		const flags = flagsAfter(command, "clean");
		return flags.includes("--force") || shortFlag(flags, "f") ? flags.join(" ") : undefined;
	},
};

const ASK_RULES: AskRule[] = [
	rmRecursive,
	pushForce,
	regexRule(/\bgit\s+reset\s+--hard\b/, "hard-reset", "irreversible"),
	cleanForce,
	regexRule(/\bterraform\s+destroy\b/, "infra-destroy", "irreversible"),
	regexRule(/\bsudo\b/, "elevated-privileges", "caution"),
	regexRule(/\b(chmod|chown)\b[^|\n]*777/, "open-permissions", "caution"),
	regexRule(/\bnpm\s+(publish|link)\b/, "supply-chain-publish", "caution"),
];

/** F02: PowerShell has different verbs — bash rm/sudo patterns miss `Remove-Item -Recurse -Force`. */
const PWSH_ASK_RULES: AskRule[] = [
	pushForce,
	regexRule(/\b(remove-item|rmdir|rd)\b[^|\n]*(-recurse|-force)\b/i, "recursive-delete", "irreversible"),
	regexRule(/\bterraform\s+destroy\b/, "infra-destroy", "irreversible"),
];

/** Paths writes/edits may never touch without approval. */
const PROTECTED_PATHS: Array<[string, Risk]> = [
	["~/.ssh", "irreversible"],
	["~/.aws", "irreversible"],
	[".env", "irreversible"],
	[".git/", "caution"],
	["node_modules/", "caution"],
	[".harness/settings", "caution"],
];

const TIMEOUT_SECONDS = 45;

function firstMatch(patterns: Pattern[], text: string): Match | undefined {
	for (const [regex, rule, risk] of patterns) {
		const hit = regex.exec(text);
		if (hit) return { rule, risk: risk ?? "irreversible", detail: hit[0] };
	}
	return undefined;
}

function firstAsk(command: string, rules: AskRule[]): Match | undefined {
	for (const rule of rules) {
		const detail = rule.match(command);
		if (detail !== undefined) return { rule: rule.rule, risk: rule.risk ?? "irreversible", detail };
	}
	return undefined;
}

function expandHome(path: string): string {
	// F12: only bare `~`/`~/…` means $HOME — `~user/x` is a different home, not ours to expand.
	if (path !== "~" && !path.startsWith("~/")) return path;
	return join(homedir(), path.slice(1));
}

function segments(path: string): string[] {
	return path.split("/").filter(Boolean);
}

/** True when `needle`'s segments appear contiguously in `haystack`'s. */
function containsSegments(haystack: string[], needle: string[]): boolean {
	for (let i = 0; i + needle.length <= haystack.length; i++) {
		if (needle.every((seg, j) => haystack[i + j] === seg)) return true;
	}
	return false;
}

function classifyPath(rawPath: string): Match | undefined {
	if (!rawPath) return undefined; // F12: "" would resolve to cwd and spuriously match cwd-relative rules
	const candidate = resolve(isAbsolute(rawPath) ? rawPath : expandHome(rawPath));
	const candidateSegments = segments(candidate);
	for (const [entry, risk] of PROTECTED_PATHS) {
		const base = expandHome(entry);
		const matches = isAbsolute(base)
			? candidate === base || candidate.startsWith(`${base}/`)
			: containsSegments(candidateSegments, segments(base));
		if (matches) return { rule: `protected-path:${entry}`, risk, detail: rawPath };
	}
	return undefined;
}

function classify(toolName: string, input: Record<string, unknown>): Verdict {
	if (toolName === "bash" || toolName === "powershell") {
		const command = String(input.command ?? "");
		const denied = firstMatch(DENY_BASH, command);
		if (denied) return { ...denied, action: "deny" };
		const ask = firstAsk(command, toolName === "powershell" ? PWSH_ASK_RULES : ASK_RULES);
		if (ask) return { ...ask, action: "ask" };
	}
	if (toolName === "write" || toolName === "edit") {
		const hit = classifyPath(String(input.path ?? ""));
		if (hit) return { ...hit, action: "ask" };
	}
	return { action: "allow", rule: "default", risk: "safe", detail: "" };
}

export { classify };

/* ------------------------------ approval dialog ------------------------------ */

class ApprovalDialog implements Component {
	private remaining: number;
	private timer: ReturnType<typeof setInterval> | undefined;
	private finished = false;

	constructor(
		private readonly opts: {
			themeRef: import("@earendil-works/pi-coding-agent").Theme;
			title: string;
			body: string[];
			risk: Risk;
			timeoutSeconds: number;
			requestRender: () => void;
			onDone: (allowed: boolean) => void;
		},
	) {
		this.remaining = opts.timeoutSeconds;
		this.timer = setInterval(() => {
			this.remaining -= 1;
			if (this.remaining <= 0) this.finish(false);
			else opts.requestRender();
		}, 1000);
	}

	private finish(allowed: boolean): void {
		if (this.finished) return;
		this.finished = true;
		if (this.timer) clearInterval(this.timer);
		this.opts.onDone(allowed);
	}

	handleInput(data: string): void {
		if (matchesKey(data, "a")) this.finish(true);
		else if (matchesKey(data, "d") || matchesKey(data, "escape")) this.finish(false);
	}

	/** F09: pi calls dispose on overlay teardown — resolve to deny (silence = deny) and stop the timer. */
	dispose(): void {
		this.finish(false);
	}

	invalidate(): void {}

	render(width: number): string[] {
		const t = this.opts.themeRef;
		const color = (s: string) => riskColor(t, this.opts.risk, s);
		const title = t.bold(color(` ⛨ ${this.opts.title} `));
		const frame = "─".repeat(Math.max(0, width - 2));
		const lines = [
			color(`╭${frame}╮`),
			truncateToWidth(`│${title}${" ".repeat(Math.max(1, width - 2 - visibleWidth(title)))}│`, width),
			`│${" ".repeat(width - 2)}│`,
		];
		for (const body of this.opts.body) {
			const styled = ` ${body} `;
			const padded = `${styled}${" ".repeat(Math.max(0, width - 4 - visibleWidth(styled)))}`;
			lines.push(truncateToWidth(`│${color(padded)}│`, width));
		}
		const hint = ` a allow once · d deny · auto-deny in ${this.remaining}s `;
		lines.push(`│${" ".repeat(width - 2)}│`);
		lines.push(truncateToWidth(`│${t.fg("dim", hint)}${" ".repeat(Math.max(1, width - 2 - visibleWidth(hint)))}│`, width));
		lines.push(color(`╰${frame}╯`));
		return lines;
	}
}

/* ---------------------------------- wiring ---------------------------------- */

function audit(pi: ExtensionAPI, tool: string, decision: Decision, rule: string, detail: string, risk: Risk): void {
	pi.appendEntry(AUDIT_ENTRY, { tool, decision, rule, detail, risk } satisfies AuditData);
}

export default function (pi: ExtensionAPI) {
	pi.on("tool_call", async (event, ctx) => {
		const verdict = classify(event.toolName, event.input as Record<string, unknown>);
		if (verdict.action === "allow") return undefined;

		if (verdict.action === "deny") {
			audit(pi, event.toolName, "blocked", verdict.rule, verdict.detail, verdict.risk);
			return { block: true, reason: `Policy: ${verdict.rule} — ${verdict.detail}`, terminate: true };
		}

		if (ctx.mode !== "tui") {
			audit(pi, event.toolName, "blocked", verdict.rule, verdict.detail, verdict.risk);
			return { block: true, reason: `${verdict.rule} requires approval (no interactive UI)` };
		}

		const body = [
			`rule:    ${verdict.rule}`,
			`payload: ${verdict.detail || "(see transcript)"}`,
		];
		const allowed = await ctx.ui.custom<boolean>(
			(tui, theme, _keybindings, done) =>
				new ApprovalDialog({
					themeRef: theme,
					title: `Approval required — ${event.toolName}`,
					body,
					risk: verdict.risk,
					timeoutSeconds: TIMEOUT_SECONDS,
					requestRender: () => tui.requestRender(),
					onDone: done,
				}),
			{ overlay: true, overlayOptions: { width: "62%", minWidth: 56, anchor: "center" } },
		);

		const decision: Decision = allowed === true ? "allowed-once" : "denied";
		audit(pi, event.toolName, decision, verdict.rule, verdict.detail, verdict.risk);
		if (allowed !== true) return { block: true, reason: `Denied by gate: ${verdict.rule}` };
		return undefined;
	});

	pi.registerCommand("policy", {
		description: "Show harness governance policy summary",
		handler: async (_args, ctx) => {
			ctx.ui.notify(`Gates: ${DENY_BASH.length} hard-denied patterns, ${ASK_RULES.length} approval patterns, ${PROTECTED_PATHS.length} protected paths. Deny > ask > allow.`, "info");
			ctx.ui.notify(`Approvals auto-deny after ${TIMEOUT_SECONDS}s. Audit trail is in the session file (harness.audit entries).`, "info");
		},
	});
}

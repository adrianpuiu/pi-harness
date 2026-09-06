/**
 * Small rendering helpers shared by harness extensions.
 *
 * Design constraints (see DESIGN.md):
 * - Calm by default: muted tones, saturated color only for salience.
 * - One hue = one meaning (semantic color consistency).
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import type { Risk } from "./constants.ts";

type Token =
	| "accent"
	| "success"
	| "error"
	| "warning"
	| "muted"
	| "dim"
	| "toolTitle";

const RISK_TOKEN: Record<Risk, Token> = {
	irreversible: "error",
	caution: "warning",
	safe: "success",
};

/** Semantic color for a risk level — red/amber/green, never reused elsewhere. */
export function riskColor(theme: Theme, risk: Risk, text: string): string {
	return theme.fg(RISK_TOKEN[risk], text);
}

/** Quiet progress bar: ▰▰▱▱▱ — calm glyphs, low visual noise. */
export function progressBar(theme: Theme, done: number, total: number, width = 10): string {
	// F17: NaN input and empty bars render as unknown, never a crash or a fake-full bar.
	if (total <= 0 || !Number.isFinite(done)) return theme.fg("dim", "▱".repeat(width));
	const clamped = Math.max(0, Math.min(done, total));
	const filled = Math.floor((clamped / total) * width); // floor: 95% of a 10-bar is 9 ▰, not a full bar
	const bar = "▰".repeat(filled) + "▱".repeat(Math.max(0, width - filled));
	return theme.fg(clamped === total ? "success" : "accent", bar);
}

/** 1234 -> "1.2k"; 0.42 stays 0.42. */
export function fmtNum(n: number): string {
	if (!Number.isFinite(n)) return "—";
	if (Math.abs(n) >= 1000) return `${(n / 1000).toFixed(1)}k`;
	return `${Math.round(n * 100) / 100}`;
}

/** money formatting for the footer: $0.421 */
export function fmtCost(n: number): string {
	if (!Number.isFinite(n)) return "$—";
	return `$${n.toFixed(n < 10 ? 3 : 2)}`;
}

/** Percentage 0..1 -> "76%"; "—" only when unknown (0% is a real measurement). */
export function fmtPct(fraction: number | undefined): string {
	if (fraction === undefined || !Number.isFinite(fraction)) return "—";
	const clamped = Math.max(0, Math.min(1, fraction)); // F17: never render 101%
	return `${Math.round(clamped * 100)}%`;
}

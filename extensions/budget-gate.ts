/**
 * budget-gate.ts — spend governor for long runs.
 *
 * Research finding (Anthropic multi-agent post): token spend explains 80%
 * of performance variance, and long runs fail financially before they fail
 * technically. This gate makes the ceiling a deterministic harness concern.
 *
 * Opt-in: .harness/budget.json {"maxCostUsd": 5, "maxTokens": 2_000_000}
 * (either or both; file absent = gate off). Usage source: assistant usage
 * entries on the session branch — the same data the footer renders.
 *
 * Thresholds, checked at turn_end:
 * - ≥80% of either ceiling (once): wrap-up steer — finish, commit, no new scope.
 * - ≥100%: abort the run + exceeded card. No steer — the run is over; the
 *   card and MISSION.md carry the state forward (checkpoint discipline).
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { BUDGET_ENTRY, type BudgetData } from "./lib/constants.ts";

export interface BudgetConfig {
	maxCostUsd?: number;
	maxTokens?: number;
}

export interface UsageTotals {
	cost: number;
	tokens: number;
}

export type BudgetAction =
	| { kind: "none" }
	| { kind: "warn" | "abort"; unit: "usd" | "tokens"; used: number; max: number; pct: number };

export function parseBudgetConfig(raw: string): BudgetConfig | undefined {
	try {
		const parsed = JSON.parse(raw) as BudgetConfig;
		const maxCostUsd = typeof parsed.maxCostUsd === "number" && parsed.maxCostUsd > 0 ? parsed.maxCostUsd : undefined;
		const maxTokens = typeof parsed.maxTokens === "number" && parsed.maxTokens > 0 ? parsed.maxTokens : undefined;
		return maxCostUsd === undefined && maxTokens === undefined ? undefined : { maxCostUsd, maxTokens };
	} catch {
		return undefined;
	}
}

/** Pure decision: report whichever ceiling is closest to breach (the dominant one). */
export function computeBudgetAction(totals: UsageTotals, config: BudgetConfig, warned: boolean): BudgetAction {
	const candidates: Array<{ unit: "usd" | "tokens"; ratio: number; used: number; max: number }> = [];
	if (config.maxCostUsd !== undefined) {
		candidates.push({ unit: "usd", ratio: totals.cost / config.maxCostUsd, used: totals.cost, max: config.maxCostUsd });
	}
	if (config.maxTokens !== undefined) {
		candidates.push({ unit: "tokens", ratio: totals.tokens / config.maxTokens, used: totals.tokens, max: config.maxTokens });
	}
	if (candidates.length === 0) return { kind: "none" };
	const dominant = candidates.reduce((a, b) => (b.ratio > a.ratio ? b : a));
	if (dominant.ratio >= 1) {
		return { kind: "abort", unit: dominant.unit, used: dominant.used, max: dominant.max, pct: Math.round(dominant.ratio * 100) };
	}
	if (dominant.ratio >= 0.8 && !warned) {
		return { kind: "warn", unit: dominant.unit, used: dominant.used, max: dominant.max, pct: Math.round(dominant.ratio * 100) };
	}
	return { kind: "none" };
}

export function usageTotals(ctx: ExtensionContext): UsageTotals {
	const totals: UsageTotals = { cost: 0, tokens: 0 };
	for (const entry of ctx.sessionManager.getBranch()) {
		if (entry.type !== "message" || entry.message.role !== "assistant") continue;
		const usage = (entry.message as AssistantMessage).usage;
		totals.cost += usage?.cost?.total ?? 0;
		totals.tokens += (usage?.input ?? 0) + (usage?.output ?? 0);
	}
	return totals;
}

export default function (pi: ExtensionAPI) {
	let warned = false;
	let stopped = false;

	const readConfig = (cwd: string): BudgetConfig | undefined => {
		const file = join(cwd, ".harness", "budget.json");
		return existsSync(file) ? parseBudgetConfig(readFileSync(file, "utf8")) : undefined;
	};

	const appendBudget = (status: BudgetData["status"], action: Extract<BudgetAction, { kind: "warn" | "abort" }>): void => {
		pi.appendEntry(BUDGET_ENTRY, { status, used: action.used, max: action.max, unit: action.unit, pct: action.pct } satisfies BudgetData);
	};

	pi.on("turn_end", async (_event, ctx) => {
		if (stopped) return;
		const config = readConfig(ctx.cwd);
		if (!config) return;
		const action = computeBudgetAction(usageTotals(ctx), config, warned);
		if (action.kind === "none") return;
		if (action.kind === "warn") {
			warned = true;
			appendBudget("warning", action);
			pi.sendUserMessage(
				`Budget ${action.pct}% consumed (${action.unit}) — wrap up current work, commit, and summarize. No new scope this session.`,
				{ deliverAs: "followUp" },
			);
			return;
		}
		appendBudget("exceeded", action);
		stopped = true;
		ctx.ui.notify(`Budget exhausted (${action.pct}% ${action.unit}) — stopping the run. State lives in MISSION.md.`, "warning");
		ctx.abort(); // no steer: the run is over; the card carries the verdict
	});
}

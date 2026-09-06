/**
 * Shared constants and data shapes for the pi-harness package.
 *
 * Custom entry types follow the `harness.*` namespace so they can be
 * rendered by ui.ts and persisted via pi.appendEntry() without ever
 * entering LLM context (TUI-only, audit-safe).
 */

/** Audit trail entry: every governance decision lands here (report §10.5). */
export const AUDIT_ENTRY = "harness.audit";

/** Run summary card appended at agent_settled (peak-end rule). */
export const SUMMARY_ENTRY = "harness.summary";

/** Verification check result card. */
export const VERIFY_ENTRY = "harness.verify";

/** Budget governor card (budget-gate.ts). */
export const BUDGET_ENTRY = "harness.budget";

/** Mission control file: goal + checklist the widget and recitation skill share. */
export const MISSION_FILE = ".harness/MISSION.md";

export type Risk = "irreversible" | "caution" | "safe";

export type Decision = "allowed" | "allowed-once" | "denied" | "blocked";

export interface AuditData {
	tool: string;
	decision: Decision;
	rule: string;
	detail: string;
	risk: Risk;
}

export interface SummaryData {
	turns: number;
	tokensIn: number;
	tokensOut: number;
	cost: number;
	cacheHit?: number; // 0..1 when measured; undefined = unknown (0 is a real measurement)
}

export interface VerifyData {
	status: "ok" | "failed" | "gave-up";
	label: string;
	seconds: number;
	digest?: string;
}

export interface BudgetData {
	status: "warning" | "exceeded";
	used: number;
	max: number;
	unit: "usd" | "tokens";
	pct: number;
}

/**
 * ui.ts — the harness frontend.
 *
 * Human-psychology design goals (full rationale in DESIGN.md):
 *
 * 1. Peak-start & peak-end (Kahneman): a calm 3-line header opens the session;
 *    a quiet summary card closes every agent run. Ends are remembered, tool
 *    spam is not.
 * 2. Serial-position effect: identity lives in the header (start), live state
 *    in the footer (end). Critical info is never buried in the middle.
 * 3. Miller's 7±2 / cognitive load: the footer carries at most 4 chunks;
 *    detail is behind expand (Ctrl+O), never on screen by default.
 * 4. Goal-gradient + Zeigarnik: the mission widget shows a progress bar and
 *    the next open step, keeping unfinished work cognitively active and
 *    accelerating the final stretch. Also defeats goal drift (report §4.6).
 * 5. Von Restorff isolation effect: everything is muted except what needs
 *    action. If everything is highlighted, nothing is.
 * 6. Processing fluency: slow "breathing" spinner and aligned columns reduce
 *    perceived anxiety while waiting.
 */

import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { Box, Text, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { AUDIT_ENTRY, BUDGET_ENTRY, CONTRACT_ENTRY, MISSION_FILE, SUMMARY_ENTRY, VERIFY_ENTRY, type AuditData, type BudgetData, type ContractData, type SummaryData, type VerifyData } from "./lib/constants.ts";
import { fmtCost, fmtNum, fmtPct, progressBar } from "./lib/render.ts";
import { parseBudgetConfig, type BudgetConfig } from "./budget-gate.ts";

interface Stats {
	inTok: number;
	outTok: number;
	cacheRead: number;
	cost: number;
	turns: number;
}

interface Mission {
	goal: string;
	done: number;
	total: number;
	next?: string;
}

type BranchEntry = ReturnType<ExtensionContext["sessionManager"]["getBranch"]>[number];

// F04: render-path caches (singletons per extension instance).
let missionCache: { path: string; mtimeMs: number; mission: Mission | undefined } | undefined;
let statsCache: { key: string; view: { stats: Stats; hit: number | undefined } } | undefined;
let budgetCache: { path: string; mtimeMs: number; config: BudgetConfig | undefined } | undefined;

function budgetConfigFor(ctx: ExtensionContext): BudgetConfig | undefined {
	const path = join(ctx.cwd, ".harness", "budget.json");
	try {
		const { mtimeMs } = statSync(path);
		if (budgetCache?.path === path && budgetCache.mtimeMs === mtimeMs) return budgetCache.config;
		const config = parseBudgetConfig(readFileSync(path, "utf8"));
		budgetCache = { path, mtimeMs, config };
		return config;
	} catch {
		return undefined;
	}
}

/** Footer budget marker (⛁%) only when a budget is configured. */
function budgetMarker(ctx: ExtensionContext, stats: Stats, theme: Theme): string {
	const config = budgetConfigFor(ctx);
	if (!config) return "";
	const ratios: number[] = [];
	if (config.maxCostUsd !== undefined) ratios.push(stats.cost / config.maxCostUsd);
	if (config.maxTokens !== undefined) ratios.push((stats.inTok + stats.outTok) / config.maxTokens);
	if (ratios.length === 0) return "";
	const pct = Math.round(Math.max(...ratios) * 100);
	const tone = pct >= 100 ? "error" : pct >= 80 ? "warning" : "dim";
	return `${theme.fg(tone, `⛁${fmtPct(Math.max(...ratios))}`)} `;
}

/** Latest-message cache hit rate: cached/(cached+uncached input); undefined when unknown. */
function scanStats(branch: BranchEntry[]): { stats: Stats; hit: number | undefined } {
	const stats: Stats = { inTok: 0, outTok: 0, cacheRead: 0, cost: 0, turns: 0 };
	let lastUsage: AssistantMessage["usage"] | undefined;
	for (const entry of branch) {
		if (entry.type !== "message" || entry.message.role !== "assistant") continue;
		const msg = entry.message as AssistantMessage;
		stats.inTok += msg.usage?.input ?? 0;
		stats.outTok += msg.usage?.output ?? 0;
		stats.cacheRead += msg.usage?.cacheRead ?? 0;
		stats.cost += msg.usage?.cost?.total ?? 0;
		stats.turns += 1;
		lastUsage = msg.usage;
	}
	const denom = (lastUsage?.cacheRead ?? 0) + (lastUsage?.input ?? 0);
	const hit = lastUsage && denom > 0 ? (lastUsage.cacheRead ?? 0) / denom : undefined;
	return { stats, hit };
}

/** F04: one scan per render, cached until the branch tip changes. */
function cachedStats(ctx: ExtensionContext): { stats: Stats; hit: number | undefined } {
	const branch = ctx.sessionManager.getBranch();
	const key = `${branch.length}:${branch[branch.length - 1]?.id ?? "none"}`;
	if (statsCache?.key === key) return statsCache.view;
	const view = scanStats(branch);
	statsCache = { key, view };
	return view;
}

function parseMission(ctx: ExtensionContext): Mission | undefined {
	const path = join(ctx.cwd, MISSION_FILE);
	try {
		// F04: stat is cheap; only re-read when the file actually changed.
		const { mtimeMs } = statSync(path);
		if (missionCache?.path === path && missionCache.mtimeMs === mtimeMs) return missionCache.mission;
		const mission = readMission(path);
		missionCache = { path, mtimeMs, mission };
		return mission;
	} catch {
		return undefined;
	}
}

function readMission(path: string): Mission | undefined {
	try {
		const raw = readFileSync(path, "utf8");
		const lines = raw.split("\n").map((l) => l.trim());
		const goalLine = lines.find((l) => l.startsWith("# ")) ?? lines.find((l) => l.startsWith("Goal:"));
		// F18: `- [X]` is a legal GitHub-style checked box — count it.
		const items = lines.filter((l) => /^- \[[ xX]\]/.test(l));
		const done = items.filter((l) => /^- \[[xX]\]/.test(l)).length;
		const next = items.find((l) => l.startsWith("- [ ]"))?.replace(/^- \[\s?\]\s*/, "");
		if (!goalLine && items.length === 0) return undefined;
		return { goal: (goalLine ?? "").replace(/^#\s*|^Goal:\s*/, ""), done, total: items.length, next };
	} catch {
		return undefined;
	}
}

/* ---------------------------------- header ---------------------------------- */

function renderHeader(theme: Theme, ctx: ExtensionContext): string[] {
	const mark = theme.fg("accent", "◈ H A R N E S S");
	const tagline = theme.fg("muted", "reliability, manufactured here");
	const project = theme.fg("dim", ctx.cwd.split("/").filter(Boolean).pop() ?? "~");
	const line = truncateToWidth(`${mark}   ${tagline}`, 96);
	return [line, truncateToWidth(`${theme.fg("dim", "└")} ${project} · ${theme.fg("dim", "/plan drafts a mission · /policy shows gates")}`, 96)];
}

/* ---------------------------------- footer ---------------------------------- */

function renderFooterLine(width: number, theme: Theme, ctx: ExtensionContext): string[] {
	const mission = parseMission(ctx);
	const left = mission
		? `${progressBar(theme, mission.done, mission.total, 8)} ${theme.fg("muted", `${mission.done}/${mission.total}`)}`
		: theme.fg("dim", "◇ ready");
	const view = cachedStats(ctx);
	const hit = fmtPct(view.hit);
	const right = budgetMarker(ctx, view.stats, theme) + theme.fg(
		"dim",
		`↑${fmtNum(view.stats.inTok)} ↓${fmtNum(view.stats.outTok)} R${hit} ${fmtCost(view.stats.cost)}`,
	);
	const gap = Math.max(2, width - visibleWidth(left) - visibleWidth(right) - 2);
	return [truncateToWidth(`${left}${" ".repeat(gap)}${right}`, width)];
}

/* ---------------------------------- widget ---------------------------------- */

function missionWidgetLines(theme: Theme, ctx: ExtensionContext): string[] {
	const mission = parseMission(ctx);
	if (!mission) {
		return [theme.fg("dim", "◇ no mission yet — run /plan to draft one")];
	}
	const head = theme.fg("toolTitle", "◈ MISSION ") + theme.fg("muted", truncateToWidth(mission.goal, 72));
	const nextPart = mission.next ? theme.fg("dim", ` next: ${truncateToWidth(mission.next, 56)}`) : theme.fg("success", " all steps done ✓");
	const bar = progressBar(theme, mission.done, mission.total, 10);
	return [head, truncateToWidth(`${bar} ${theme.fg("muted", `${mission.done}/${mission.total}`)}${nextPart}`, 96)];
}

function refreshWidget(ctx: ExtensionContext): void {
	if (ctx.mode !== "tui") return;
	const theme = ctx.ui.theme;
	ctx.ui.setWidget("harness.mission", missionWidgetLines(theme, ctx));
}

/* ------------------------------ transcript cards ----------------------------- */

function summaryCard(data: SummaryData, theme: Theme, expanded: boolean): Text {
	const head =
		theme.fg("success", "✓ settled ") +
		theme.fg(
			"muted",
			`· ${data.turns} turns · ↑${fmtNum(data.tokensIn)} ↓${fmtNum(data.tokensOut)} · cache ${fmtPct(data.cacheHit)} · ${fmtCost(data.cost)}`,
		);
	if (!expanded) return new Text(truncateToWidth(head, 96), 0, 0);
	const detail = theme.fg(
		"dim",
		`  in ${data.tokensIn} tok · out ${data.tokensOut} tok · cost ${fmtCost(data.cost)} · cache hit ${fmtPct(data.cacheHit)}`,
	);
	return new Text(`${head}\n${detail}`, 0, 0);
}

function auditCard(data: AuditData, theme: Theme): Text {
	const tone = data.decision === "blocked" ? "error" : data.decision === "denied" ? "warning" : "dim";
	const icon = data.decision === "allowed-once" ? "⛨" : data.decision === "blocked" ? "⛔" : "⛨";
	const line =
		theme.fg(tone, `${icon} ${data.tool} ${data.decision}`) +
		theme.fg("dim", ` · ${data.rule} · ${truncateToWidth(data.detail, 56)}`);
	return new Text(truncateToWidth(line, 96), 0, 0);
}

function verifyCard(data: VerifyData, theme: Theme, expanded: boolean): Text {
	if (data.status === "ok") {
		return new Text(theme.fg("success", `✓ checks green — ${data.label} (${data.seconds.toFixed(1)}s)`), 0, 0);
	}
	const head = theme.fg("error", `✗ checks failed — ${data.label}`);
	if (!expanded || !data.digest) return new Text(truncateToWidth(head, 96), 0, 0);
	const box = new Box(1, 0, (s: string) => theme.fg("dim", s));
	box.addChild(new Text(theme.fg("error", data.digest), 0, 0));
	return new Text(`${head}\n${box.render(96).join("\n")}`, 0, 0);
}

function budgetCard(data: BudgetData, theme: Theme): Text {
	const tone = data.status === "exceeded" ? "error" : "warning";
	const icon = data.status === "exceeded" ? "⏹" : "⚠";
	const detail = data.unit === "usd" ? `$${data.used.toFixed(2)} / $${data.max.toFixed(2)}` : `${fmtNum(data.used)} / ${fmtNum(data.max)} tok`;
	return new Text(truncateToWidth(theme.fg(tone, `${icon} budget ${data.status} — ${data.pct}% · ${detail}`), 96), 0, 0);
}

function contractCard(data: ContractData, theme: Theme): Text {
	const tone = data.verdict === "approved" ? "success" : "warning";
	const icon = data.verdict === "approved" ? "✓" : "✍";
	return new Text(
		truncateToWidth(theme.fg(tone, `${icon} contract ${data.verdict} — ${truncateToWidth(data.feature, 60)}`) + theme.fg("dim", ` · ${data.contractPath}`), 96),
		0,
		0,
	);
}

/* ---------------------------------- wiring ---------------------------------- */

export default function (pi: ExtensionAPI) {
	let turnCount = 0;

	pi.on("session_start", async (_event, ctx) => {
		turnCount = 0;
		if (ctx.mode !== "tui") return;
		ctx.ui.setHeader((_tui, theme) => ({
			render: (_width: number) => renderHeader(theme, ctx),
			invalidate() {},
		}));
		// Breathing indicator: slow, low-arousal motion (processing fluency).
		ctx.ui.setWorkingIndicator({
			frames: [ctx.ui.theme.fg("dim", "·"), ctx.ui.theme.fg("muted", "•"), ctx.ui.theme.fg("accent", "●"), ctx.ui.theme.fg("muted", "•")],
			intervalMs: 220,
		});
		ctx.ui.setFooter((tui, theme, footerData) => {
			const unsub = footerData.onBranchChange(() => tui.requestRender());
			return {
				dispose: unsub,
				invalidate() {},
				render(width: number) {
					return renderFooterLine(width, theme, ctx);
				},
			};
		});
		refreshWidget(ctx);
	});

	pi.on("before_agent_start", async () => {
		turnCount = 0;
	});

	pi.on("turn_start", async (_event, ctx) => {
		turnCount += 1;
		if (ctx.mode !== "tui") return;
		refreshWidget(ctx);
		ctx.ui.setStatus("harness", ctx.ui.theme.fg("dim", ` turn ${turnCount}`));
	});

	pi.on("turn_end", async (_event, ctx) => {
		if (ctx.mode !== "tui") return;
		refreshWidget(ctx);
		ctx.ui.setStatus("harness", undefined);
	});

	pi.on("agent_settled", async (_event, ctx) => {
		const { stats, hit } = cachedStats(ctx);
		pi.appendEntry(SUMMARY_ENTRY, {
			turns: stats.turns,
			tokensIn: stats.inTok,
			tokensOut: stats.outTok,
			cost: stats.cost,
			cacheHit: hit,
		} satisfies SummaryData);
		if (ctx.mode !== "tui") return;
		refreshWidget(ctx);
	});

	pi.registerCommand("mission", {
		description: "Open .harness/MISSION.md status in a card",
		handler: async (_args, ctx) => {
			const mission = parseMission(ctx);
			if (!mission) {
				ctx.ui.notify(`No ${MISSION_FILE} — run /plan first`, "info");
				return;
			}
			ctx.ui.notify(`${mission.goal}: ${mission.done}/${mission.total} done`, "info");
		},
	});

	pi.registerEntryRenderer(SUMMARY_ENTRY, (entry, { expanded }, theme) =>
		summaryCard(entry.data as SummaryData, theme, expanded),
	);
	pi.registerEntryRenderer(AUDIT_ENTRY, (entry, _opts, theme) => auditCard(entry.data as AuditData, theme));
	pi.registerEntryRenderer(VERIFY_ENTRY, (entry, { expanded }, theme) => verifyCard(entry.data as VerifyData, theme, expanded));
	pi.registerEntryRenderer(BUDGET_ENTRY, (entry, _opts, theme) => budgetCard(entry.data as BudgetData, theme));
	pi.registerEntryRenderer(CONTRACT_ENTRY, (entry, _opts, theme) => contractCard(entry.data as ContractData, theme));
}

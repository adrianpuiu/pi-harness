/**
 * scouts.ts — parallel read-only investigation with specialist profiles
 * (report §8; vendored hyperpowers hunter/refactorer agents).
 *
 * The rule: **parallelize read-only work, serialize state-mutating decisions.**
 * Each scout is an ephemeral `pi -p` subprocess. Default policy is read-only
 * (read, grep, find, ls). Profiles (agents/*.md, from this package or user
 * dirs) specialize a scout: a persona prompt plus a tool policy. Profiles
 * with `tools: none` (the triage aggregators) run with NO tools and operate
 * solely on the material passed in the objective — isolated aggregation, no
 * anchoring on the hunt conversation.
 *
 * Full outputs land in .harness/scouts/ artifacts; the model gets digests +
 * references (report §8.2: artifact references over transcript copies).
 *
 * Psychology (DESIGN.md): concurrent scouts stream progress as each lands —
 * latency felt as progress, not silence; a hard cap of 5 keeps the choice
 * space scannable (Hick's law); every scout ends ✓ or ✗ with a reason
 * (predictable feedback); /scouts shows the roster (trust calibration).
 */

import { mkdir, readdir, readFile, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";
import { Type } from "typebox";

const MAX_SCOUTS = 5;
const MAX_ARTIFACTS = 100; // F05: cap .harness/scouts/ — scratch history, not an archive
const DEFAULT_DIGEST_WORDS = 300;
const MAX_DIGEST_WORDS = 1200;
const TIMEOUT_MS = 600_000;
const READ_ONLY_TOOLS = "read,grep,find,ls";

interface ScoutSpec {
	objective: string;
	hints?: string;
	profile?: string;
	digestWords?: number;
}

interface ScoutRunContext {
	cwd: string;
	signal?: AbortSignal;
	model?: { provider: string; id: string };
}

interface ScoutProfile {
	name: string;
	description: string;
	body: string;
	toolPolicy: "read-only" | "none";
	source: string;
}

interface ScoutOutcome {
	objective: string;
	profile?: string;
	ok: boolean;
	digest: string;
	artifact?: string;
}

const ScoutParams = Type.Object({
	scouts: Type.Array(
		Type.Object({
			objective: Type.String({ description: "Single, well-bounded question or material to work on", minLength: 1 }),
			hints: Type.Optional(Type.String({ description: "Files, dirs, or search terms to start from" })),
			profile: Type.Optional(Type.String({ description: "Specialist profile (see /scouts), e.g. logic-hunter, bug-triage" })),
			digestWords: Type.Optional(Type.Integer({ minimum: 100, maximum: MAX_DIGEST_WORDS })),
		}),
		{ minItems: 1, maxItems: MAX_SCOUTS, description: `1–${MAX_SCOUTS} parallel agents` },
	),
});

/* ------------------------------- profiles ------------------------------- */

function packageAgentsDir(): string {
	return fileURLToPath(new URL("../agents/", import.meta.url));
}

function packageSkillsDir(): string {
	return fileURLToPath(new URL("../skills/", import.meta.url));
}

function profileDirs(cwd: string): string[] {
	return [packageAgentsDir(), join(cwd, ".pi", "agents"), join(homedir(), ".pi", "agent", "agents")];
}

function fold(text: string): string {
	return text.replace(/\s+/g, " ").trim();
}

function parseProfile(raw: string, file: string): ScoutProfile | undefined {
	const match = /^---\n([\s\S]*?)\n---\n?/.exec(raw);
	if (!match) return undefined;
	const fm = String(match[1] ?? "");
	const fallbackName = file.split("/").pop()?.replace(/\.md$/, "") ?? "unnamed";
	const name = /^name:\s*(.+)$/m.exec(fm)?.[1]?.trim() || fallbackName;
	const folded = /^description:\s*>?-?\s*\n((?:[ \t]+.*\n?)+)/m.exec(fm)?.[1];
	const description = fold(folded ?? /^description:\s*(.+)$/m.exec(fm)?.[1] ?? "");
	const body = raw.slice(match[0].length).trim();
	const toolsLine = /^tools:\s*(.+)$/m.exec(fm)?.[1]?.trim() || "read-only";
	return { name, description, body, toolPolicy: toolsLine === "none" ? "none" : "read-only", source: file };
}

async function loadProfiles(cwd: string): Promise<Map<string, ScoutProfile>> {
	const profiles = new Map<string, ScoutProfile>();
	for (const dir of profileDirs(cwd)) {
		let entries: string[] = [];
		try {
			entries = (await readdir(dir)).filter((entry) => entry.endsWith(".md"));
		} catch {
			continue; // dir absent — fine
		}
		for (const entry of entries) {
			const file = join(dir, entry);
			const profile = parseProfile(await readFile(file, "utf8"), file);
			if (profile) profiles.set(profile.name, profile); // later dirs override the package
		}
	}
	return profiles;
}

function referenceFooter(skillsDir: string, profile: ScoutProfile | undefined): string {
	if (profile?.toolPolicy === "none") {
		return "You have no tools. Work solely from the material in the objective above.";
	}
	return [
		"---",
		"Reference library (skills are NOT pre-loaded): when instructions mention a skill,",
		`read it first with your read tool from ${skillsDir}/<skill-name>/SKILL.md.`,
		'If instructions say a skill is "already loaded", ignore that phrasing and read it from the library instead.',
	].join("\n");
}

/* ------------------------------- execution ------------------------------- */

function scoutPrompt(spec: ScoutSpec, profile: ScoutProfile | undefined, skillsDir: string): string {
	const words = spec.digestWords ?? DEFAULT_DIGEST_WORDS;
	const persona = profile ? `${profile.body}\n\n---\n` : "";
	const hints = spec.hints ? `\nStarting points: ${spec.hints}` : "";
	const rules =
		profile?.toolPolicy === "none"
			? ""
			: "\nRules: you may only read (no writes, no network). Cite exact file paths with line numbers.";
	return [
		`${persona}`,
		`Objective: ${spec.objective}${hints}`,
		`Return ONLY a digest of at most ${words} words: findings/proposals first, then file:line evidence. No preamble.${rules}`,
		referenceFooter(skillsDir, profile),
	].join("\n\n");
}

function toolArgs(profile: ScoutProfile | undefined): string[] {
	return profile?.toolPolicy === "none" ? ["--no-tools"] : ["--tools", READ_ONLY_TOOLS];
}

let artifactSeq = 0; // F16: same-millisecond calls collide on Date.now alone

function artifactPath(dir: string, index: number, spec: ScoutSpec): string {
	const slug = spec.objective
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.slice(0, 32)
		.replace(/^-+|-+$/g, ""); // F19: strip every leading/trailing dash, not just one
	artifactSeq += 1;
	return join(dir, `${Date.now()}-${process.pid}-${artifactSeq}-${index}-${slug || "scout"}.md`);
}

/** F05: keep only the newest MAX_ARTIFACTS files (names sort by timestamp). */
async function pruneArtifacts(dir: string): Promise<void> {
	const entries = (await readdir(dir)).filter((name) => name.endsWith(".md")).sort();
	const excess = entries.length - MAX_ARTIFACTS;
	for (const name of excess > 0 ? entries.slice(0, excess) : []) {
		await unlink(join(dir, name)).catch(() => {}); // raced away — fine
	}
}

/** F19: honest fallback text — killed is not "exited 0", and success with no output is not an error. */
function fallbackDigest(result: { code: number; killed: boolean; stderr: string }): string {
	const tail = Array.from(result.stderr).slice(0, 200).join(""); // code-point safe
	if (result.killed) return `scout killed (timeout or abort): ${tail}`;
	return result.code === 0 ? "(scout produced no output)" : `scout exited ${result.code}: ${tail}`;
}

async function runScout(
	pi: ExtensionAPI,
	ctx: ScoutRunContext,
	spec: ScoutSpec,
	index: number,
	profile: ScoutProfile | undefined,
	dir: string,
): Promise<ScoutOutcome> {
	const path = artifactPath(dir, index, spec);
	const modelArgs = ctx.model ? ["--model", `${ctx.model.provider}/${ctx.model.id}`] : [];
	try {
		const result = await pi.exec(
			"pi",
			["-p", "--no-session", "--no-extensions", "--no-skills", ...toolArgs(profile), ...modelArgs, scoutPrompt(spec, profile, packageSkillsDir())],
			{ cwd: ctx.cwd, signal: ctx.signal, timeout: TIMEOUT_MS },
		);
		const digest = result.stdout.trim();
		const label = profile ? `${profile.name} scout` : "scout";
		const body = `# ${label} ${index + 1}: ${spec.objective}\n\n${digest || result.stderr.trim()}\n`;
		await writeFile(path, body, "utf8");
		const ok = result.code === 0 && !result.killed;
		return {
			objective: spec.objective,
			profile: profile?.name,
			ok,
			digest: digest || fallbackDigest(result),
			artifact: path,
		};
	} catch (error) {
		return { objective: spec.objective, profile: profile?.name, ok: false, digest: `scout failed: ${(error as Error).message}` };
	}
}

function renderOutcomes(outcomes: ScoutOutcome[]): string {
	const sections = outcomes.map((outcome, index) => {
		const mark = outcome.ok ? "✓" : "✗";
		const profile = outcome.profile ? ` (${outcome.profile})` : "";
		const artifact = outcome.artifact ? `\n(full output: ${outcome.artifact})` : "";
		return `${mark}${profile} agent ${index + 1}: ${truncateToWidth(outcome.objective, 80)}\n${outcome.digest}${artifact}`;
	});
	return sections.join("\n\n");
}

export default function (pi: ExtensionAPI) {
	pi.registerTool({
		name: "scout",
		label: "Scout",
		description:
			`Spawn 1–${MAX_SCOUTS} parallel ephemeral agents (isolated contexts). Default: read-only ` +
			"investigation (read/grep/find/ls). Specialist profiles (see /scouts) load a persona, e.g. " +
			"hunters (logic-hunter, concurrency-hunter, resource-hunter, boundary-hunter), refactorers, " +
			"and tools:none aggregators (bug-triage, refactor-triage) that work solely from material in " +
			"the objective. Full outputs land in .harness/scouts/ artifacts.",
		promptSnippet: "Run parallel isolated agents for read-only investigation and aggregation",
		promptGuidelines: [
			"Use scout for broad read-only investigation or specialist analysis (profiles via /scouts). " +
				"Give each agent one bounded objective. Do not use scout for writes or decisions.",
		],
		parameters: ScoutParams,
		async execute(_toolCallId, params, signal, onUpdate, ctx) {
			const dir = join(ctx.cwd, ".harness", "scouts");
			await mkdir(dir, { recursive: true });
			const profiles = await loadProfiles(ctx.cwd);
			const unknown = params.scouts.filter((spec) => spec.profile !== undefined && !profiles.has(spec.profile));
			if (unknown.length > 0) {
				throw new Error(`Unknown profile(s): ${unknown.map((spec) => spec.profile).join(", ")}. Available: ${[...profiles.keys()].join(", ")}`);
			}
			let settled = 0;
			const promises = params.scouts.map((spec, index) => {
				const profile = spec.profile ? profiles.get(spec.profile) : undefined;
				const runCtx: ScoutRunContext = { cwd: ctx.cwd, signal, model: ctx.model };
				return runScout(pi, runCtx, spec, index, profile, dir).then((outcome) => {
					settled += 1;
					onUpdate?.({
						content: [{ type: "text", text: `${settled}/${params.scouts.length} agents done — ${outcome.ok ? "✓" : "✗"} ${truncateToWidth(spec.objective, 60)}` }],
						details: {},
					});
					return outcome;
				});
			});
			const outcomes = await Promise.all(promises);
			await pruneArtifacts(dir);
			const failed = outcomes.filter((outcome) => !outcome.ok).length;
			const summary = failed === 0 ? "all agents ✓" : `${failed}/${outcomes.length} agents ✗`;
			return {
				content: [{ type: "text", text: `${summary}\n\n${renderOutcomes(outcomes)}` }],
				details: { outcomes, artifacts: outcomes.map((outcome) => outcome.artifact) },
			};
		},
	});

	pi.registerCommand("scouts", {
		description: "List available scout profiles",
		handler: async (_args, ctx) => {
			const profiles = await loadProfiles(ctx.cwd);
			if (profiles.size === 0) {
				ctx.ui.notify("No scout profiles found (searched: package agents/, .pi/agents/, ~/.pi/agent/agents/)", "info");
				return;
			}
			const lines = [...profiles.values()].map(
				(profile) => `  ${profile.name} [${profile.toolPolicy}] — ${truncateToWidth(profile.description, 90)}`,
			);
			ctx.ui.notify(`Scout profiles (${profiles.size}) — specify profile per scout in the tool call:\n${lines.join("\n")}`, "info");
		},
	});
}

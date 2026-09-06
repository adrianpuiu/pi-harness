/**
 * context-compiler.ts — the runtime context compiler (report §7).
 *
 * Two passes:
 *
 * 1. Deterministic pass (`context` event, before every LLM call):
 *    prune stale bash tool outputs, keeping the most recent few. The marker
 *    is *restorable* (Manus rule, report §4.6): the command text survives in
 *    the preceding assistant tool-call message, so the model can always
 *    recompute the output by rerunning — the window holds the working set,
 *    the repo holds the truth (report §4.7).
 *
 * 2. Model-assisted pass (`session_before_compact`): replace pi's default
 *    compaction prompt with harness-specific instructions that preserve
 *    decisions, unresolved bugs, exact paths, and user corrections. Falls
 *    back to pi's default on any error — compaction must never wedge a run.
 */

import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { generateSummaryWithUsage } from "@earendil-works/pi-coding-agent";

const KEEP_RECENT_BASH = 6;

const SUMMARY_INSTRUCTIONS = `Summarize this agent transcript for continuation by another agent instance.
Preserve exactly:
- architectural decisions and their rationale
- unresolved bugs, failing tests, and error messages
- exact file paths, branch names, and command lines worth rerunning
- user corrections and stated preferences
- current workflow position (what step is next)
Drop freely:
- redundant tool outputs, exploratory dead ends (keep a one-line lesson each)`;

function isPrunableBashResult(message: AgentMessage): boolean {
	if (message.role !== "toolResult") return false;
	if (message.toolName !== "bash") return false;
	const result = message as { isError?: boolean; content?: Array<{ type: string; text?: string }> };
	if (result.isError) return false; // errors are tiny and load-bearing
	const text = result.content?.find((block) => block.type === "text")?.text ?? "";
	return text.length > 400;
}

function pruneOldBashOutputs(messages: AgentMessage[]): AgentMessage[] {
	const prunable = messages.filter(isPrunableBashResult);
	const cutoff = Math.max(0, prunable.length - KEEP_RECENT_BASH);
	const stale = new Set(prunable.slice(0, cutoff));
	if (stale.size === 0) return messages;
	return messages.map((message) => {
		if (!stale.has(message)) return message;
		return {
			...message,
			content: [
				{
					type: "text",
					text: "[pruned by context compiler — rerun the command (above) or read the file to see this output]",
				},
			],
		} as AgentMessage;
	});
}

export default function (pi: ExtensionAPI) {
	pi.on("context", async (event) => {
		try {
			return { messages: pruneOldBashOutputs(event.messages) };
		} catch {
			return undefined; // F13: the deterministic pass must never reject an LLM call
		}
	});
	pi.on("session_before_compact", async (event, ctx) => {
		const { preparation } = event;
		if (!ctx.model || preparation.messagesToSummarize.length === 0) return undefined;
		try {
			const auth = ctx.modelRegistry.getProviderAuth(ctx.model.provider) as { apiKey?: string } | undefined;
			const reserve = preparation.settings?.reserveTokens ?? 16384;
			const { text, usage } = await generateSummaryWithUsage(
				preparation.messagesToSummarize,
				ctx.model,
				reserve,
				auth?.apiKey,
				undefined,
				event.signal,
				SUMMARY_INSTRUCTIONS,
				preparation.previousSummary,
			);
			return {
				compaction: {
					summary: text,
					firstKeptEntryId: preparation.firstKeptEntryId,
					tokensBefore: preparation.tokensBefore,
					usage,
				},
			};
		} catch (error) {
			// F13: a user abort must propagate — falling back to default compaction
			// here would retry the call the user just cancelled.
			if ((error as Error).name === "AbortError" || event.signal?.aborted) throw error;
			return undefined; // any other failure — use pi default compaction
		}
	});
}

export { pruneOldBashOutputs };

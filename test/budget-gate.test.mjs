import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { parseBudgetConfig, computeBudgetAction } = await jiti.import(new URL("../extensions/budget-gate.ts", import.meta.url).href);

let fail = 0;
function check(name, actual, expected) {
	const ok = JSON.stringify(actual) === JSON.stringify(expected);
	if (!ok) fail++;
	console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : ` got ${JSON.stringify(actual)}`}`);
}

// --- config parsing ---
check("valid config parses", parseBudgetConfig('{"maxCostUsd": 5, "maxTokens": 1000}'), { maxCostUsd: 5, maxTokens: 1000 });
check("invalid JSON → off", parseBudgetConfig("{bad"), undefined);
check("zero/negative ceilings → off", parseBudgetConfig('{"maxCostUsd": 0}'), undefined);
check("empty object → off", parseBudgetConfig("{}"), undefined);

// --- threshold logic ---
const cfg = { maxCostUsd: 1, maxTokens: 1000 };
check("below 80% → none", computeBudgetAction({ cost: 0.5, tokens: 100 }, cfg, false).kind, "none");
check(
	"at 80% → warn once",
	computeBudgetAction({ cost: 0.8, tokens: 0 }, cfg, false),
	{ kind: "warn", unit: "usd", used: 0.8, max: 1, pct: 80 },
);
check("already warned at 85% → none (warn fires once)", computeBudgetAction({ cost: 0.85, tokens: 0 }, cfg, true).kind, "none");
check(
	"at 100% → abort even after warning",
	computeBudgetAction({ cost: 1.0, tokens: 0 }, cfg, true).kind,
	"abort",
);
check(
	"dominant unit wins (tokens breach first)",
	computeBudgetAction({ cost: 0.1, tokens: 1000 }, cfg, false),
	{ kind: "abort", unit: "tokens", used: 1000, max: 1000, pct: 100 },
);
check("no ceilings configured → none", computeBudgetAction({ cost: 999, tokens: 999 }, {}, false).kind, "none");

console.log(fail === 0 ? "ALL-PASS" : `${fail} FAILURES`);
process.exit(fail === 0 ? 0 : 1);

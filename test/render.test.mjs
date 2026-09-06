import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { fmtPct, fmtNum, fmtCost, progressBar } = await jiti.import(new URL("../extensions/lib/render.ts", import.meta.url).href);

// Regression test for the hunt finding: 0% is a real measurement, not "unknown".
const cases = [
	[fmtPct(0), "0%", "measured 0% renders as 0%, not unknown"],
	[fmtPct(0.76), "76%", "fractional rate renders"],
	[fmtPct(1), "100%", "full rate renders"],
	[fmtPct(undefined), "—", "unknown renders as em-dash"],
	[fmtPct(Number.NaN), "—", "NaN renders as unknown"],
	[fmtPct(1.2), "100%", "F17: >1 clamps to 100%, never 101%"],
	[fmtNum(Number.NaN), "—", "F17: fmtNum NaN renders as unknown"],
	[fmtCost(Number.NaN), "$—", "F17: fmtCost NaN renders as unknown"],
	[progressBar({ fg: (_t, s) => s }, 95, 100, 10), "▰▰▰▰▰▰▰▰▰▱", "F17: 95% is 9/10, not a full success bar"],
	[progressBar({ fg: (_t, s) => s }, 100, 100, 10), "▰▰▰▰▰▰▰▰▰▰", "100% renders a full bar"],
];

let fail = 0;
for (const [actual, expected, name] of cases) {
	const ok = actual === expected;
	if (!ok) fail++;
	console.log(`${ok ? "PASS" : "FAIL"} ${name} -> ${actual}${ok ? "" : ` (expected ${expected})`}`);
}
console.log(fail === 0 ? "ALL-PASS" : `${fail} FAILURES`);
process.exit(fail === 0 ? 0 : 1);

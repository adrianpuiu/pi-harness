import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { pruneOldBashOutputs } = await jiti.import(new URL("../extensions/context-compiler.ts", import.meta.url).href);

const bigText = "x".repeat(500);
const smallText = "tiny output";

function bashResult(text, isError = false, callId = "c") {
	return { role: "toolResult", toolName: "bash", toolCallId: callId, isError, content: [{ type: "text", text }] };
}
function other(role, text) {
	return { role, content: [{ type: "text", text }] };
}

let fail = 0;
function check(name, actual, expected) {
	const ok = JSON.stringify(actual) === JSON.stringify(expected);
	if (!ok) fail++;
	console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : ` got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`}`);
}

// 8 large bash outputs -> first 2 pruned, last 6 intact
const eight = Array.from({ length: 8 }, (_, i) => bashResult(`out-${i}-${bigText}`, false, `c${i}`));
const pruned = pruneOldBashOutputs(eight);
check("count preserved", pruned.length, 8);
check("first two pruned", pruned.slice(0, 2).map((m) => m.content[0].text.includes("[pruned by context compiler")), [true, true]);
check("last six intact", pruned.slice(2).every((m) => m.content[0].text.startsWith("out-")), true);

// small outputs never pruned — and the noop fast path returns the same array
const smalls = Array.from({ length: 8 }, (_, i) => bashResult(smallText, false, `s${i}`));
check("small outputs intact", pruneOldBashOutputs(smalls).every((m) => m.content[0].text === smallText), true);
check("noop returns same reference", pruneOldBashOutputs(smalls) === smalls, true);

// error results never pruned (load-bearing)
const withError = [...Array.from({ length: 7 }, (_, i) => bashResult(`out-${i}-${bigText}`, false, `c${i}`)), bashResult(" Boom failed", true, "err")];
const prunedError = pruneOldBashOutputs(withError);
check("error result intact", prunedError[7].content[0].text === " Boom failed", true);

// non-bash tool results untouched
const mixed = [bashResult(bigText, false, "b0"), { role: "toolResult", toolName: "read", toolCallId: "r0", isError: false, content: [{ type: "text", text: bigText }] }];
check("read result intact", pruneOldBashOutputs(mixed)[1].content[0].text, bigText);

// original array not mutated
check("input array untouched", eight[0].content[0].text.startsWith("out-0"), true);

console.log(fail === 0 ? "ALL-PASS" : `${fail} FAILURES`);
process.exit(fail === 0 ? 0 : 1);

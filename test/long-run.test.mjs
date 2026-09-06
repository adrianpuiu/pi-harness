import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { validateMissionTransition, validateFeaturesTransition } = await jiti.import(
	new URL("../extensions/long-run.ts", import.meta.url).href,
);

let fail = 0;
function check(name, actual, expected) {
	const ok = JSON.stringify(actual) === JSON.stringify(expected);
	if (!ok) fail++;
	console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : ` got ${JSON.stringify(actual)}`}`);
}

const mission = (steps) => steps.map(([t, s]) => `- [${t}] ${s}`).join("\n");

// --- mission ledger transitions ---
check("ticking a step is legal", validateMissionTransition(mission([[" ", "a"]]), mission([["x", "a"]])), []);
check(
	"un-ticking is rollback",
	validateMissionTransition(mission([["x", "a"]]), mission([[" ", "a"]]))[0]?.rule,
	"ledger:progress-rollback",
);
check(
	"removing an open step is a violation",
	validateMissionTransition(mission([[" ", "a"], [" ", "b"]]), mission([[" ", "b"]]))[0]?.rule,
	"ledger:open-step-removed",
);
check("removing a DONE step is legal (cleanup)", validateMissionTransition(mission([["x", "a"], [" ", "b"]]), mission([[" ", "b"]])), []);
check("adding a step is legal (course change)", validateMissionTransition(mission([[" ", "a"]]), mission([[" ", "a"], [" ", "c"]])), []);
check("rewriting an open step body flags the removed original", validateMissionTransition(mission([[" ", "old"]]), mission([[" ", "new"]]))[0]?.rule, "ledger:open-step-removed");
check("uppercase [X] counts as ticked", validateMissionTransition(mission([["X", "a"]]), mission([[" ", "a"]]))[0]?.rule, "ledger:progress-rollback");

// --- features.json ledger transitions ---
const feature = (desc, passes) => JSON.stringify([{ category: "functional", description: desc, steps: ["do it"], passes }]);
check("flipping passes false→true is legal", validateFeaturesTransition(feature("f", false), feature("f", true)), []);
check(
	"flipping passes true→false is rollback",
	validateFeaturesTransition(feature("f", true), feature("f", false))[0]?.rule,
	"ledger:passes-rollback",
);
check(
	"removing a feature is a violation",
	validateFeaturesTransition(JSON.stringify([{ description: "a", passes: false }, { description: "b", passes: false }]), JSON.stringify([{ description: "b", passes: false }]))[0]?.rule,
	"ledger:feature-removed",
);
check(
	"editing feature steps is a violation",
	validateFeaturesTransition(feature("f", false), JSON.stringify([{ description: "f", steps: ["changed"], passes: false }])),
	[{ rule: "ledger:feature-edited", detail: "f" }],
);
check("adding a feature is legal", validateFeaturesTransition(JSON.stringify([]), feature("new", false)), []);
check("invalid JSON is skipped (guard never crashes)", validateFeaturesTransition("{bad", "[]"), []);
check("non-array JSON is skipped", validateFeaturesTransition("{}", "[]"), []);

console.log(fail === 0 ? "ALL-PASS" : `${fail} FAILURES`);
process.exit(fail === 0 ? 0 : 1);

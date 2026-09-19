import assert from "node:assert/strict";
import test from "node:test";
import { loadTsCommonJs } from "./helpers/loadTsCommonJs.mjs";

const {
	decideDshHostStart,
	dshHostStartClearsUserStop,
} = loadTsCommonJs("src/main/dsh/dshHostStartGate.ts");

test("decideDshHostStart: already running is a no-op", () => {
	assert.equal(
		decideDshHostStart({ isRunning: true, userStopped: true, reason: "warmup" }),
		"already-running",
	);
	assert.equal(
		decideDshHostStart({ isRunning: true, userStopped: false, reason: "explicit" }),
		"already-running",
	);
});

test("decideDshHostStart: user stop blocks warmup and implicit reads", () => {
	assert.equal(
		decideDshHostStart({ isRunning: false, userStopped: true }),
		"skip-user-stopped",
	);
	assert.equal(
		decideDshHostStart({ isRunning: false, userStopped: true, reason: "implicit" }),
		"skip-user-stopped",
	);
	assert.equal(
		decideDshHostStart({ isRunning: false, userStopped: true, reason: "warmup" }),
		"skip-user-stopped",
	);
});

test("decideDshHostStart: session use and explicit start override the stop flag", () => {
	assert.equal(
		decideDshHostStart({ isRunning: false, userStopped: true, reason: "session" }),
		"start",
	);
	assert.equal(
		decideDshHostStart({ isRunning: false, userStopped: true, reason: "explicit" }),
		"start",
	);
});

test("decideDshHostStart: not stopped always starts when not running", () => {
	assert.equal(
		decideDshHostStart({ isRunning: false, userStopped: false, reason: "warmup" }),
		"start",
	);
	assert.equal(
		decideDshHostStart({ isRunning: false, userStopped: false }),
		"start",
	);
});

test("dshHostStartClearsUserStop only for session and explicit", () => {
	assert.equal(dshHostStartClearsUserStop("session"), true);
	assert.equal(dshHostStartClearsUserStop("explicit"), true);
	assert.equal(dshHostStartClearsUserStop("warmup"), false);
	assert.equal(dshHostStartClearsUserStop("implicit"), false);
	assert.equal(dshHostStartClearsUserStop(undefined), false);
});

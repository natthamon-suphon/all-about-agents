import assert from "node:assert/strict";
import test from "node:test";

import {
  NATIVE_PHASES,
  NATIVE_STATUSES,
  NativeStateError,
  createNativeIntegrationRecord,
  nativeIntegrationStatus,
  validateNativeIntegrationRecord
} from "../../adapters/shared/native-state.mjs";

const completePhases = () => Object.fromEntries(NATIVE_PHASES.map((phase) => [phase, {
  status: "pass",
  evidence: `${phase} evidence observed in a disposable native check`
}]));

const input = (overrides = {}) => ({
  surface: "claude",
  feature: "statusline",
  phases: completePhases(),
  sourcePath: "adapters/claude/adapter.mjs",
  manualSteps: [],
  ...overrides
});

const rawRecord = (overrides = {}) => ({
  kind: "native-integration",
  ...input(overrides)
});

test("native lifecycle exposes fixed phases and statuses", () => {
  assert.deepEqual(NATIVE_PHASES, ["rendered", "validated", "registered", "trusted", "active", "runtimeVerified"]);
  assert.deepEqual(NATIVE_STATUSES, ["pass", "fail", "not-run", "not-run-unavailable"]);
});

test("complete native integration records are frozen and pass", () => {
  const record = createNativeIntegrationRecord(input({ manualSteps: ["Reload the native product session."] }));
  assert.deepEqual(record, {
    kind: "native-integration",
    surface: "claude",
    feature: "statusline",
    phases: completePhases(),
    sourcePath: "adapters/claude/adapter.mjs",
    manualSteps: ["Reload the native product session."]
  });
  assert.equal(Object.isFrozen(record), true);
  assert.equal(Object.isFrozen(record.phases), true);
  assert.ok(NATIVE_PHASES.every((phase) => Object.isFrozen(record.phases[phase])));
  assert.equal(Object.isFrozen(record.manualSteps), true);
  assert.equal(nativeIntegrationStatus(record), "pass");
});

test("partial and unavailable lifecycle records remain fail-closed", () => {
  const partial = createNativeIntegrationRecord(input({
    phases: {
      ...completePhases(),
      active: { status: "not-run", evidence: "The product session was not opened." },
      runtimeVerified: { status: "not-run", evidence: "Runtime verification was not attempted." }
    }
  }));
  assert.equal(nativeIntegrationStatus(partial), "not-run");

  const unavailable = createNativeIntegrationRecord(input({
    phases: {
      ...completePhases(),
      trusted: { status: "not-run-unavailable", evidence: "This product has no trust concept for this feature." },
      active: { status: "not-run-unavailable", evidence: "Active state cannot be observed without a trust concept." },
      runtimeVerified: { status: "not-run-unavailable", evidence: "Runtime verification is unavailable for this product." }
    }
  }));
  assert.equal(nativeIntegrationStatus(unavailable), "not-run-unavailable");
});

test("a later phase cannot pass after an unavailable earlier phase", () => {
  const result = validateNativeIntegrationRecord(rawRecord({
    phases: {
      ...completePhases(),
      rendered: { status: "not-run-unavailable", evidence: "Rendering is unavailable on this product." }
    }
  }));
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.code === "state-order" && error.path === "/phases/validated/status"));
});

test("failed lifecycle phase makes the overall status fail", () => {
  const failed = createNativeIntegrationRecord(input({
    phases: {
      ...completePhases(),
      validated: { status: "fail", evidence: "Schema validation rejected the rendered package." },
      registered: { status: "not-run", evidence: "Registration stopped after validation failed." },
      trusted: { status: "not-run", evidence: "Trust was not checked after validation failed." },
      active: { status: "not-run", evidence: "Active state was not checked after validation failed." },
      runtimeVerified: { status: "not-run", evidence: "Runtime verification stopped after validation failed." }
    }
  }));
  assert.equal(nativeIntegrationStatus(failed), "fail");
});

test("validation reports missing phases, invalid status and evidence, and stable paths", () => {
  const phases = completePhases();
  delete phases.validated;
  phases.registered = { status: "not-a-status", evidence: "registered evidence" };
  phases.trusted = { status: "not-run", evidence: "   " };
  phases.active = { status: "not-run", evidence: "Active state was not checked." };
  phases.runtimeVerified = { status: "not-run", evidence: "Runtime verification was not checked." };
  const result = validateNativeIntegrationRecord(rawRecord({ phases }));
  assert.equal(result.valid, false);
  assert.ok(result.errors.every((error) => error instanceof NativeStateError));
  assert.deepEqual(result.errors.map((error) => error.path), [
    "/phases/registered/status",
    "/phases/trusted/evidence",
    "/phases/validated"
  ]);
});

test("validation rejects skipped state, invalid trust unavailability, and unexpected fields", () => {
  const phases = completePhases();
  phases.validated = { status: "not-run", evidence: "Validation was not run." };
  phases.registered = { status: "pass", evidence: "Registration was observed." };
  phases.trusted = {
    status: "not-run-unavailable",
    evidence: "The trust probe was unavailable."
  };
  phases.active = { status: "pass", evidence: "Active state was observed." };
  const result = validateNativeIntegrationRecord(rawRecord({
    phases,
    unexpected: true
  }));
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.path === "/unexpected" && error.code === "unexpected-field"));
  assert.ok(result.errors.some((error) => error.path === "/phases/registered/status" && error.code === "state-order"));
  assert.ok(result.errors.some((error) => error.path === "/phases/trusted/evidence" && error.code === "trust-evidence"));
  assert.ok(result.errors.some((error) => error.path === "/phases/active/status" && error.code === "state-order"));
});

test("validation rejects unsafe source paths and secret-bearing evidence", () => {
  const unsafe = validateNativeIntegrationRecord(rawRecord({
    sourcePath: "../outside/record.mjs",
    phases: {
      ...completePhases(),
      rendered: { status: "pass", evidence: "Authorization: Bearer abcdefghijklmnop" }
    }
  }));
  assert.equal(unsafe.valid, false);
  assert.ok(unsafe.errors.some((error) => error.code === "unsafe-source-path" && error.path === "/sourcePath"));
  assert.ok(unsafe.errors.some((error) => error.path === "/phases/rendered/evidence" && error.code === "secret-evidence"));

  const unsafeSourceCases = [
    ["/tmp/record.mjs", "absolute-source-path"],
    ["C:/tmp/record.mjs", "absolute-source-path"],
    ["https://example.test/record.mjs", "absolute-source-path"],
    ["adapters\\claude\\adapter.mjs", "noncanonical-source-path"]
  ];
  for (const [sourcePath, code] of unsafeSourceCases) {
    const result = validateNativeIntegrationRecord(rawRecord({ sourcePath }));
    assert.equal(result.valid, false, sourcePath);
    assert.ok(result.errors.some((error) => error.code === code && error.path === "/sourcePath"), `${code} missing for ${sourcePath}`);
  }
  const control = validateNativeIntegrationRecord(rawRecord({
    phases: { ...completePhases(), rendered: { status: "pass", evidence: "line one\u0000line two" } }
  }));
  assert.equal(control.valid, false);
  assert.ok(control.errors.some((error) => error.code === "invalid-evidence" && error.path === "/phases/rendered/evidence"));
});

test("manual steps allow the exact public SSH deny token but reject private home paths", () => {
  const canonical = createNativeIntegrationRecord(input({
    manualSteps: ["Retain write_file(/home/user/.ssh) as the documented emergency deny."]
  }));
  assert.equal(canonical.manualSteps.length, 1);

  for (const manualStep of [
    "Inspect /home/user/.ssh directly.",
    "Retain write_file(/home/user/.ssh/private-key).",
    "Retain write_file(/home/alice/.ssh)."
  ]) {
    assert.throws(() => createNativeIntegrationRecord(input({ manualSteps: [manualStep] })), /secret-manual-step/u, manualStep);
  }
});

test("createNativeIntegrationRecord clones input and rejects invalid records", () => {
  const source = input({ manualSteps: ["Review the native product status."] });
  const record = createNativeIntegrationRecord(source);
  source.phases.rendered.status = "fail";
  source.manualSteps.push("Unexpected command");
  assert.equal(record.phases.rendered.status, "pass");
  assert.deepEqual(record.manualSteps, ["Review the native product status."]);
  assert.throws(() => createNativeIntegrationRecord(input({ phases: { ...completePhases(), registered: undefined } })), TypeError);
  assert.throws(() => createNativeIntegrationRecord(input({ manualSteps: ["   "] })), TypeError);
});

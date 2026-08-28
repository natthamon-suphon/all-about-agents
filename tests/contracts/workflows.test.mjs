import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { validateSchema } from "../../installers/lib/validate-schema.mjs";

const workflowIds = [
  "design-change",
  "implement-change",
  "fix-bug",
  "review-and-audit",
  "improve-skill",
  "release-qualification"
];

const requiredSequences = {
  "design-change": ["discover-context", "clarify", "compare-approaches", "approve-design", "write-review-spec", "plan"],
  "implement-change": ["approved-plan", "red-test", "scoped-implementation", "green-refactor", "self-review", "independent-review", "verification"],
  "fix-bug": ["reproduce", "collect-evidence", "isolate-root-cause", "regression-red", "smallest-fix", "green", "verification"],
  "review-and-audit": ["resolve-scope", "gather-evidence", "correctness-security-architecture-review", "prioritized-findings", "explicit-not-run"],
  "improve-skill": ["baseline-control", "failure-rationalization-capture", "smallest-wording-resource-change", "repeated-adversarial-evaluation", "cross-harness-qualification"],
  "release-qualification": ["static-validation", "deterministic-contracts", "native-integration", "repeated-behavioral-evaluation", "evidence-limitation-report"]
};

const mutatingEdges = {
  "design-change": new Set(["approve-design->write-review-spec", "write-review-spec->plan"]),
  "implement-change": new Set(["red-test->scoped-implementation", "scoped-implementation->green-refactor"]),
  "fix-bug": new Set(["regression-red->smallest-fix", "smallest-fix->green"]),
  "review-and-audit": new Set(),
  "improve-skill": new Set(["failure-rationalization-capture->smallest-wording-resource-change", "smallest-wording-resource-change->repeated-adversarial-evaluation"]),
  "release-qualification": new Set(["repeated-behavioral-evaluation->evidence-limitation-report"])
};

const requiredOutputs = [
  "core/workflows/design-change/workflow.json",
  "core/workflows/implement-change/workflow.json",
  "core/workflows/fix-bug/workflow.json",
  "core/workflows/review-and-audit/workflow.json",
  "core/workflows/improve-skill/workflow.json",
  "core/workflows/release-qualification/workflow.json",
  "tests/contracts/workflows.test.mjs"
];

test("T006 creates every owned artifact", async () => {
  assert.ok(requiredOutputs.length > 0);
  for (const relativePath of requiredOutputs) {
    await access(resolve(process.cwd(), relativePath));
  }
});

async function readWorkflows() {
  return Promise.all(workflowIds.map(async (id) => {
    const sourcePath = resolve(process.cwd(), `core/workflows/${id}/workflow.json`);
    return { id, sourcePath, record: JSON.parse(await readFile(sourcePath, "utf8")) };
  }));
}

function stateId(state) {
  return typeof state === "string" ? state : state?.id;
}

function outgoing(workflow, from) {
  return workflow.transitions.filter((transition) => transition.from === from);
}

function edgeId(transition) {
  return `${transition.from}->${transition.to}`;
}

function isMutatingTransition(workflow, transition) {
  return mutatingEdges[workflow.id]?.has(edgeId(transition)) === true;
}

function recoveryErrors(workflow) {
  const errors = [];
  const durableState = workflow.recovery?.durableState;
  const compaction = workflow.recovery?.compaction;
  const resume = workflow.recovery?.resume;
  if (durableState?.required !== true || durableState?.writeOnEveryTransition !== true || durableState?.writeBeforeCompaction !== true) {
    errors.push("recovery has no durable state written before compaction");
  }
  if (compaction?.conversationSummaryIsAuthoritative !== false || compaction?.resumeSource !== "durableState") {
    errors.push("compaction resume does not use durable state");
  }
  if (resume?.verifyFromDisk !== true || resume?.revalidateCurrentState !== true || resume?.rejectIfMissingOrInvalid !== true) {
    errors.push("resume does not verify durable state from disk");
  }
  return errors;
}

function graphErrors(workflow, roles = {}) {
  const errors = [];
  const states = workflow.states.map(stateId);
  const stateSet = new Set(states);
  const workflowRoles = new Set(Array.isArray(workflow.allowedRoles) ? workflow.allowedRoles : []);
  if (!Array.isArray(workflow.allowedRoles)) errors.push("workflow allowedRoles is not an array");
  if (!stateSet.has(workflow.initialState)) errors.push("initial state is not declared");
  if (stateSet.size !== states.length) errors.push("duplicate state ID");
  const terminalStates = new Set(workflow.states.filter((state) => typeof state === "object" && state.terminal === true).map(stateId));
  const reachable = new Set([workflow.initialState]);
  const queue = [workflow.initialState];
  while (queue.length > 0) {
    const from = queue.shift();
    for (const transition of outgoing(workflow, from)) {
      if (!stateSet.has(transition.to)) errors.push(`transition points to unknown state ${transition.to}`);
      else if (!reachable.has(transition.to)) {
        reachable.add(transition.to);
        queue.push(transition.to);
      }
    }
  }
  for (const state of states) if (!reachable.has(state)) errors.push(`unreachable state ${state}`);
  for (const state of workflow.states) {
    if (terminalStates.has(stateId(state))) {
      if (typeof state.stopCondition !== "string" || state.stopCondition.length === 0) errors.push(`terminal state ${stateId(state)} has no stop condition`);
      if (typeof state.durableOutput !== "string" || state.durableOutput.length === 0) errors.push(`terminal state ${stateId(state)} has no durable output`);
    } else if (outgoing(workflow, stateId(state)).length === 0) {
      errors.push(`non-terminal state ${stateId(state)} has no continuation`);
    }
  }
  for (const transition of workflow.transitions) {
    if (!stateSet.has(transition.from)) errors.push(`transition starts at unknown state ${transition.from}`);
    if (terminalStates.has(transition.from)) errors.push(`terminal state ${transition.from} has outgoing transition`);
    for (const roleId of transition.allowedRoles || []) {
      if (!workflowRoles.has(roleId)) errors.push(`role ${roleId} is not allowed by workflow ${workflow.id}`);
      if (workflowRoles.size === 0) errors.push(`empty workflow allowedRoles denies role ${roleId}`);
    }
    if (transition.command && transition.requiresApproval !== true) errors.push(`command ${transition.command} skips approval`);
    if (isMutatingTransition(workflow, transition) && transition.requiresApproval !== true && (!Array.isArray(transition.allowedRoles) || transition.allowedRoles.length === 0)) {
      errors.push(`mutating transition ${transition.id || transition.on} is unauthorized`);
    }
    if (isMutatingTransition(workflow, transition)) for (const roleId of transition.allowedRoles || []) {
      if (roles[roleId]?.mutationScope === "none") errors.push(`mutating transition ${transition.id || transition.on} is assigned to read-only role ${roleId}`);
    }
  }
  const expectedEdges = requiredSequences[workflow.id]?.slice(0, -1).map((from, index) => `${from}->${requiredSequences[workflow.id][index + 1]}`) || [];
  if (JSON.stringify(workflow.transitions.map(edgeId)) !== JSON.stringify(expectedEdges)) errors.push("transition edge chain differs from canonical sequence");
  for (const gate of workflow.gates) {
    const state = typeof gate === "string" ? null : gate.state;
    const onFailure = typeof gate === "string" ? null : gate.onFailure;
    if (state && !stateSet.has(state)) errors.push(`gate ${gate.id} names unknown state ${state}`);
    if (onFailure && !stateSet.has(onFailure)) errors.push(`gate ${gate.id} stops at unknown state ${onFailure}`);
    if (state && onFailure && onFailure !== state) errors.push(`gate ${gate.id} does not stop at the smallest responsible state`);
  }
  errors.push(...recoveryErrors(workflow));
  return errors;
}

test("canonical workflows validate against the strict schema and expose the six approved sequences", async () => {
  const schema = JSON.parse(await readFile(resolve(process.cwd(), "core/schemas/workflow.schema.json"), "utf8"));
  const records = await readWorkflows();
  assert.deepEqual(records.map(({ record }) => record.id), workflowIds);
  for (const { id, sourcePath, record } of records) {
    assert.equal(validateSchema({ schema, value: record, sourcePath }).valid, true);
    assert.equal(record.initialState, requiredSequences[id][0]);
    assert.deepEqual(record.states.map(stateId).filter((state) => requiredSequences[id].includes(state)), requiredSequences[id]);
    assert.ok(record.allowedRoles instanceof Array, `${id} must declare allowedRoles`);
    assert.deepEqual(record.allowedRoles, [], `${id} must deny by default until canonical roles are bound`);
    assert.equal(record.recovery?.durableState?.revision?.field, "revision", `${id} must declare its durable revision field`);
    assert.equal(record.recovery?.durableState?.revision?.positiveInteger, true, `${id} must require positive durable revisions`);
    assert.ok(record.successCriteria instanceof Array || typeof record.successCriteria === "string", `${id} must declare successCriteria`);
  }
});

test("workflow graphs have no unreachable states, missing stops, or unauthorized mutation", async () => {
  const records = await readWorkflows();
  for (const { id, record } of records) assert.deepEqual(graphErrors(record), [], `${id} graph is invalid`);
});

test("workflow graph checks reject skipped approval, unreachable states, missing stops, and unauthorized mutations", async () => {
  const [{ record }] = await readWorkflows();
  const bad = structuredClone(record);
  bad.states.push({ id: "orphan", description: "Unreachable test state." });
  bad.states.find((state) => state.id === "plan").stopCondition = "";
  bad.transitions.push({ id: "bad-command", from: "approve-design", to: "plan", on: "write-plan", command: "design", requiresApproval: false });
  const badMutation = bad.transitions.find((transition) => edgeId(transition) === "approve-design->write-review-spec");
  badMutation.requiresApproval = false;
  badMutation.allowedRoles = ["reviewer"];
  bad.transitions.push({ id: "terminal-bypass", from: "plan", to: "discover-context", on: "restart" });
  bad.recovery.durableState.writeBeforeCompaction = false;
  const errors = graphErrors(bad, { reviewer: { mutationScope: "none" } });
  assert.ok(errors.some((error) => /unreachable state orphan/u.test(error)));
  assert.ok(errors.some((error) => /command design skips approval/u.test(error)));
  assert.ok(errors.some((error) => /mutating transition design-approved is assigned to read-only role reviewer/u.test(error)));
  assert.ok(errors.some((error) => /terminal state plan has no stop condition/u.test(error)));
  assert.ok(errors.some((error) => /terminal state plan has outgoing transition/u.test(error)));
  assert.ok(errors.some((error) => /empty workflow allowedRoles denies role reviewer/u.test(error)));
  assert.ok(errors.some((error) => /transition edge chain differs from canonical sequence/u.test(error)));
  assert.ok(errors.some((error) => /recovery has no durable state/u.test(error)));

  const noApproval = structuredClone(record);
  const designWrite = noApproval.transitions.find((transition) => edgeId(transition) === "approve-design->write-review-spec");
  designWrite.requiresApproval = false;
  designWrite.allowedRoles = [];
  assert.ok(graphErrors(noApproval).some((error) => /mutating transition design-approved is unauthorized/u.test(error)));

  const wrongWorkflowRole = structuredClone(record);
  wrongWorkflowRole.transitions[3].allowedRoles = ["reviewer"];
  assert.ok(graphErrors(wrongWorkflowRole).some((error) => /role reviewer is not allowed by workflow design-change/u.test(error)));

  const gateBypass = structuredClone(record);
  gateBypass.recovery.terminalFailureStates = ["plan"];
  gateBypass.gates[0].onFailure = "plan";
  assert.ok(graphErrors(gateBypass).some((error) => /gate context-evidence does not stop at the smallest responsible state/u.test(error)));
});

test("compaction and resume verify durable workflow state from disk", async () => {
  const records = await readWorkflows();
  const root = await mkdtemp(join(tmpdir(), "aaa-t006-resume-"));
  try {
    for (const { id, record } of records) {
      assert.equal(record.recovery?.durableState?.required, true, `${id} must require durable state`);
      assert.equal(record.recovery?.resume?.verifyFromDisk, true, `${id} must verify disk state on resume`);
      assert.equal(record.recovery?.compaction?.conversationSummaryIsAuthoritative, false, `${id} must distrust summaries`);
      const configuredPath = record.recovery.durableState.path.replace("{workflowId}", id);
      assert.equal(configuredPath, `.aaa/state/workflows/${id}.json`, `${id} durable path drifted from the configured contract`);
      for (const state of record.states) assert.equal(state.durableOutput, record.recovery.durableState.path, `${id} state ${stateId(state)} does not use configured durable path`);
      const path = resolve(root, configuredPath);
      await mkdir(dirname(path), { recursive: true });
      const expectedRevision = 2;
      const durable = { workflowId: id, state: record.initialState, checkpoint: `disk-${id}`, revision: expectedRevision, evidence: [] };
      const conversationSummary = { workflowId: id, state: "stale-summary", checkpoint: "stale", revision: 99 };

      await writeFile(path, `${JSON.stringify(durable)}\n`, "utf8");
      const resumed = JSON.parse(await readFile(path, "utf8"));
      const acceptsDiskCheckpoint = (checkpoint) => checkpoint?.workflowId === id && record.states.map(stateId).includes(checkpoint.state) && Number.isInteger(checkpoint.revision) && checkpoint.revision === expectedRevision && Array.isArray(checkpoint.evidence);
      assert.equal(acceptsDiskCheckpoint(resumed), true);
      assert.deepEqual(resumed, durable);
      assert.equal(acceptsDiskCheckpoint(conversationSummary), false);
      assert.notDeepEqual(resumed, conversationSummary, `${id} resume trusted conversation summary`);

      await rm(path);
      await assert.rejects(readFile(path, "utf8"), /ENOENT/u, `${id} missing durable state was accepted`);

      await writeFile(path, "{\n", "utf8");
      await assert.rejects((async () => JSON.parse(await readFile(path, "utf8")))(), SyntaxError, `${id} malformed durable state was accepted`);

      const staleValid = { ...durable, revision: expectedRevision - 1 };
      await writeFile(path, `${JSON.stringify(staleValid)}\n`, "utf8");
      const staleDisk = JSON.parse(await readFile(path, "utf8"));
      assert.equal(acceptsDiskCheckpoint(staleDisk), false, `${id} wrong-revision durable state was accepted`);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

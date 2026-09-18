import defaultEmojiRegistry from "../presentation/emoji-registry.json" with { type: "json" };
import defaultProgressContract from "../presentation/progress-contract.json" with { type: "json" };

const EVENT_TYPES = Object.freeze(["announcement", "checklist", "completion"]);
const MAX_EVENTS = 64;
const KINDS = Object.freeze(["skill", "role", "subagent", "hook", "profile"]);
const STATUSES = Object.freeze(["pending", "in-progress", "completed", "blocked", "failed", "not-run", "skipped"]);
const EXCEPTIONAL_STATUSES = new Set(["blocked", "failed", "not-run", "skipped"]);
const TERMINAL_STATUSES = new Set(["completed", ...EXCEPTIONAL_STATUSES]);
const ID_PATTERN = /^[a-z0-9][a-z0-9-]*(?::[a-z0-9][a-z0-9-]*)?$/u;
const ASCII_KEY_PATTERN = /^[\x21-\x7e]+$/u;
const CONTROL_OR_FORMAT_PATTERN = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;
const HTML_PATTERN = /<[^>]*>/u;
const KIND_CATEGORY = Object.freeze({ skill: "skills", role: "roles", subagent: "subagents", command: "commands", workflow: "workflows", hook: "hooks", profile: "profiles" });

function issue(code, path, message) {
  return { code, path, message };
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function pointerSegment(value) {
  const segment = String(value);
  if (!ASCII_KEY_PATTERN.test(segment) || /[<>]/u.test(segment)) return "unsafe-field";
  return segment.replaceAll("~", "~0").replaceAll("/", "~1");
}

function pathJoin(path, segment) {
  return `${path}/${pointerSegment(segment)}`;
}

function safeId(value) {
  return typeof value === "string" && ID_PATTERN.test(value) && value.length <= 128;
}

function safeText(value, maxLength, { singleLine = false } = {}) {
  return typeof value === "string"
    && value.trim().length > 0
    && value.length <= maxLength
    && !CONTROL_OR_FORMAT_PATTERN.test(value)
    && !HTML_PATTERN.test(value)
    && (!singleLine || !/[\r\n]/u.test(value));
}

function checkObjectKeys(value, expected, path, errors) {
  if (!isObject(value)) {
    errors.push(issue("type", path, "value must be an object"));
    return;
  }
  const keys = Object.keys(value);
  for (const key of keys) {
    if (!ASCII_KEY_PATTERN.test(key)) errors.push(issue("non-ascii-field", pathJoin(path, key), "field names must use printable ASCII"));
    if (!expected.includes(key)) errors.push(issue("unknown-field", pathJoin(path, key), "object contains an unknown field"));
  }
  const expectedPresent = expected.filter((key) => Object.hasOwn(value, key));
  if (keys.some((key, index) => key !== expectedPresent[index]) || keys.length !== expectedPresent.length) {
    errors.push(issue("field-order", path, `fields must use this order: ${expected.join(", ")}`));
  }
}

function expectedEmoji(presentation, kind, id) {
  const registry = presentation?.emojiRegistry;
  const category = KIND_CATEGORY[kind];
  if (!category || !isObject(registry?.[category])) return null;
  const entry = registry[category][id] ?? (kind === "subagent" ? registry[category].default : undefined);
  return isObject(entry) && typeof entry.emoji === "string" ? entry.emoji : null;
}

function expectedLabel(presentation, kind, id) {
  const emoji = expectedEmoji(presentation, kind, id);
  return emoji ? `${id} ${emoji}` : null;
}

function presentationErrors(presentation) {
  const errors = [];
  if (!isObject(presentation)) {
    errors.push(issue("presentation-required", "/presentation", "presentation must be an object"));
    return errors;
  }
  if (!isObject(presentation.emojiRegistry)) errors.push(issue("presentation-registry", "/presentation/emojiRegistry", "emojiRegistry must be an object"));
  if (!isObject(presentation.progressContract?.states)) errors.push(issue("presentation-progress", "/presentation/progressContract/states", "progressContract.states must be an object"));
  return errors;
}

function fingerprintChecklist(checklist) {
  return JSON.stringify(checklist.items
    .map((item) => [safeId(item?.id) ? item.id : null, STATUSES.includes(item?.status) ? item.status : null])
    .sort(([leftId], [rightId]) => String(leftId).localeCompare(String(rightId))));
}

function checkAnnouncement(event, path, presentation, state, errors) {
  checkObjectKeys(event, ["type", "kind", "id", "label", "reason"], path, errors);
  if (event.type !== "announcement") errors.push(issue("event-type", pathJoin(path, "type"), "announcement event type is required"));
  if (!KINDS.includes(event.kind)) errors.push(issue("unknown-kind", pathJoin(path, "kind"), "invocation kind is not registered"));
  if (!safeId(event.id)) errors.push(issue("unsafe-id", pathJoin(path, "id"), "invocation ID must be a safe lowercase ASCII identifier"));
  if (!safeText(event.label, 160)) errors.push(issue("unsafe-label", pathJoin(path, "label"), "label must be a safe non-empty string"));
  if (!safeText(event.reason, 160, { singleLine: true })) errors.push(issue("short-reason-required", pathJoin(path, "reason"), "announcement reason must be one short safe sentence"));

  if (KINDS.includes(event.kind) && safeId(event.id)) {
    const label = expectedLabel(presentation, event.kind, event.id);
    if (label === null) errors.push(issue("unknown-presentation-id", pathJoin(path, "id"), `no registered label exists for ${event.kind} ${event.id}`));
    else if (event.label !== label) {
      const code = typeof event.label === "string" && event.label.endsWith(` ${label.split(" ").at(-1)}`) && !event.label.startsWith(`${event.id} `)
        ? "emoji-before-name"
        : "label-mismatch";
      errors.push(issue(code, pathJoin(path, "label"), "label must exactly match the registered presentation label"));
    }
  }

  if (!state.announcement) state.announcement = event;
  else errors.push(issue("multiple-announcements", path, "a trace must contain exactly one announcement"));
}

function checkChecklist(event, path, presentation, state, errors) {
  checkObjectKeys(event, ["type", "revision", "owner", "items"], path, errors);
  if (event.type !== "checklist") errors.push(issue("event-type", pathJoin(path, "type"), "checklist event type is required"));
  if (!Number.isInteger(event.revision) || event.revision < 1) errors.push(issue("invalid-revision", pathJoin(path, "revision"), "revision must be a positive integer"));
  if (!safeId(event.owner)) errors.push(issue("unsafe-owner", pathJoin(path, "owner"), "checklist owner must be a safe lowercase ASCII identifier"));
  if (!Array.isArray(event.items) || event.items.length < 2 || event.items.length > 7) {
    errors.push(issue("checklist-size", pathJoin(path, "items"), "checklist must contain between 2 and 7 items"));
    return;
  }

  const itemIds = new Set();
  for (const [index, item] of event.items.entries()) {
    const itemPath = pathJoin(pathJoin(path, "items"), index);
    checkObjectKeys(item, ["id", "text", "status", "owner", "reason"], itemPath, errors);
    if (!isObject(item)) continue;
    if (!safeId(item?.id)) errors.push(issue("unsafe-id", pathJoin(itemPath, "id"), "checklist item ID must be a safe lowercase ASCII identifier"));
    else if (itemIds.has(item.id)) errors.push(issue("duplicate-item-id", pathJoin(itemPath, "id"), `duplicate checklist item ID ${item.id}`));
    else itemIds.add(item.id);
    if (!safeText(item?.text, 240)) errors.push(issue("invalid-item-text", pathJoin(itemPath, "text"), "checklist item text must be a safe non-empty string"));
    if (!STATUSES.includes(item?.status)) errors.push(issue("unknown-state", pathJoin(itemPath, "status"), "checklist state is not registered"));
    if (Object.hasOwn(item, "owner") && !safeId(item.owner)) errors.push(issue("unsafe-owner", pathJoin(itemPath, "owner"), "item owner must be a safe lowercase ASCII identifier"));
    if (EXCEPTIONAL_STATUSES.has(item?.status) && !safeText(item?.reason, 160, { singleLine: true })) errors.push(issue("terminal-reason-required", pathJoin(itemPath, "reason"), `${item.status} items require a short reason`));
    if (Object.hasOwn(item, "reason") && !safeText(item.reason, 160, { singleLine: true })) errors.push(issue("invalid-reason", pathJoin(itemPath, "reason"), "item reason must be one short safe sentence"));
  }

  if (Number.isInteger(event.revision) && state.lastRevision !== null) {
    if (event.revision <= state.lastRevision) errors.push(issue("revision-order", pathJoin(path, "revision"), "checklist revisions must strictly increase"));
    if (event.revision === state.lastRevision) errors.push(issue("revision-duplicate", pathJoin(path, "revision"), "checklist revisions must be unique"));
  }
  if (state.lastChecklist) {
    const priorIds = state.lastChecklist.items.map((item) => safeId(item?.id) ? item.id : null);
    const currentIds = event.items.map((item) => safeId(item?.id) ? item.id : null);
    if (JSON.stringify(priorIds) !== JSON.stringify(currentIds)) errors.push(issue("unstable-item-ids", pathJoin(path, "items"), "checklist item IDs must stay stable across revisions"));
    if (fingerprintChecklist(state.lastChecklist) === fingerprintChecklist(event)) errors.push(issue("checklist-unchanged", path, "do not repeat an unchanged checklist revision"));
    const priorById = new Map(state.lastChecklist.items.filter((item) => isObject(item) && safeId(item.id)).map((item) => [item.id, item]));
    for (const [index, item] of event.items.entries()) {
      if (!isObject(item) || !safeId(item.id)) continue;
      const prior = priorById.get(item.id);
      if (prior && TERMINAL_STATUSES.has(prior.status) && !TERMINAL_STATUSES.has(item.status)) {
        errors.push(issue("terminal-regression", pathJoin(pathJoin(pathJoin(path, "items"), index), "status"), "a terminal checklist item must not be reopened"));
      }
    }
  }

  if (state.checklistOwner !== null && event.owner !== state.checklistOwner) {
    errors.push(issue("checklist-owner-change", pathJoin(path, "owner"), "one invocation must keep one checklist owner across revisions"));
  }

  const active = event.items.filter((item) => isObject(item) && item.status === "in-progress");
  if (active.length > 1) {
    if (event.owner !== "parallel") errors.push(issue("parallel-owner-required", pathJoin(path, "owner"), "parallel in-progress work must use the parallel checklist owner"));
    const owners = active.map((item) => item.owner);
    if (owners.some((owner) => !safeId(owner))) errors.push(issue("parallel-owner-required", pathJoin(path, "items"), "parallel in-progress items require named owners"));
    const uniqueOwners = new Set(owners.filter((owner) => safeId(owner)));
    if (uniqueOwners.size !== owners.filter((owner) => safeId(owner)).length) errors.push(issue("parallel-owner-conflict", pathJoin(path, "items"), "each parallel owner may own only one in-progress item"));
  } else if (active.length === 1 && event.owner === "parallel" && !safeId(active[0].owner)) {
    errors.push(issue("parallel-owner-required", pathJoin(path, "items"), "parallel in-progress items require named owners"));
  }

  state.checklists.push(event);
  if (state.checklistOwner === null) state.checklistOwner = event.owner;
  if (Number.isInteger(event.revision)) state.lastRevision = event.revision;
  state.lastChecklist = event;
  state.lastChecklistIndex = state.currentChecklistIndex;
}

function checkCompletion(event, path, state, errors) {
  checkObjectKeys(event, ["type"], path, errors);
  if (event.type !== "completion") errors.push(issue("event-type", pathJoin(path, "type"), "completion event type is required"));
  if (state.completion) errors.push(issue("multiple-completions", path, "a trace must contain exactly one completion event"));
  state.completion = event;
  if (!state.lastChecklist) errors.push(issue("checklist-required", path, "completion requires a checklist"));
  else {
    for (const [index, item] of state.lastChecklist.items.entries()) {
      if (!TERMINAL_STATUSES.has(item?.status)) errors.push(issue("completion-has-active-item", pathJoin(pathJoin(pathJoin(`/trace/events/${state.lastChecklistIndex}`, "items"), index), "status"), "completion requires every item to have a terminal state"));
    }
  }
}

function validateEventShape(event, path, presentation, state, errors) {
  if (!isObject(event)) {
    errors.push(issue("type", path, "event must be an object"));
    return;
  }
  if (!EVENT_TYPES.includes(event.type)) {
    checkObjectKeys(event, ["type"], path, errors);
    errors.push(issue("unknown-event-type", pathJoin(path, "type"), "event type is not registered"));
    return;
  }
  if (event.type === "announcement") checkAnnouncement(event, path, presentation, state, errors);
  else if (event.type === "checklist") {
    state.currentChecklistIndex = Number(path.split("/").at(-1));
    checkChecklist(event, path, presentation, state, errors);
  } else checkCompletion(event, path, state, errors);
}

function makeSummary(trace, state) {
  const finalChecklist = state.lastChecklist;
  const finalItems = finalChecklist?.items ?? [];
  const terminalExceptionalStates = finalItems
    .filter((item) => EXCEPTIONAL_STATUSES.has(item?.status))
    .map((item) => ({
      id: safeId(item?.id) ? item.id : null,
      status: item.status,
      reason: safeText(item?.reason, 160, { singleLine: true }) ? item.reason : null
    }));
  return {
    invocationId: safeId(trace?.invocationId) ? trace.invocationId : null,
    eventCount: Array.isArray(trace?.events) ? trace.events.length : 0,
    announcementCount: state.announcement ? 1 : 0,
    announcement: state.announcement ? {
      kind: KINDS.includes(state.announcement.kind) ? state.announcement.kind : null,
      id: safeId(state.announcement.id) ? state.announcement.id : null,
      label: safeText(state.announcement.label, 160) ? state.announcement.label : null
    } : null,
    checklistRevisions: state.checklists.length,
    checklistOwners: state.checklists.map((checklist) => safeId(checklist.owner) ? checklist.owner : null),
    finalStatuses: finalItems.map((item) => STATUSES.includes(item?.status) ? item.status : null),
    pendingCount: finalItems.filter((item) => item?.status === "pending").length,
    inProgressCount: finalItems.filter((item) => item?.status === "in-progress").length,
    completed: Boolean(state.completion),
    terminalExceptionalStates
  };
}

function orderedErrors(errors) {
  return [...errors].sort((left, right) => {
    const leftMatch = /^\/trace\/events\/(\d+)/u.exec(left.path);
    const rightMatch = /^\/trace\/events\/(\d+)/u.exec(right.path);
    const leftIndex = leftMatch ? Number(leftMatch[1]) : -1;
    const rightIndex = rightMatch ? Number(rightMatch[1]) : -1;
    return leftIndex - rightIndex;
  });
}

/** Audit structured invocation evidence without parsing model prose or vendor UI output. */
export function auditPresentationTrace({ trace, presentation = { emojiRegistry: defaultEmojiRegistry, progressContract: defaultProgressContract } } = {}) {
  const errors = [];
  const state = { announcement: null, completion: null, checklists: [], checklistOwner: null, lastChecklist: null, lastRevision: null, lastChecklistIndex: null, currentChecklistIndex: null };
  if (!isObject(trace)) {
    errors.push(issue("type", "/trace", "trace must be an object"));
    return { valid: false, errors: orderedErrors(errors), summary: makeSummary(null, state) };
  }
  checkObjectKeys(trace, ["invocationId", "events"], "/trace", errors);
  if (!safeId(trace.invocationId)) errors.push(issue("unsafe-id", "/trace/invocationId", "invocationId must be a safe lowercase ASCII identifier"));
  const presentationValue = presentation ?? { emojiRegistry: defaultEmojiRegistry, progressContract: defaultProgressContract };
  errors.push(...presentationErrors(presentationValue));
  if (!Array.isArray(trace.events)) {
    errors.push(issue("type", "/trace/events", "events must be an array"));
  } else {
    if (trace.events.length < 2) errors.push(issue("event-count", "/trace/events", "trace must contain at least an announcement and checklist"));
    if (trace.events.length > MAX_EVENTS) errors.push(issue("event-count", "/trace/events", `trace must contain at most ${MAX_EVENTS} events`));
    const boundedEvents = trace.events.slice(0, MAX_EVENTS);
    if (boundedEvents.length > 0 && boundedEvents[0]?.type !== "announcement") errors.push(issue("announcement-first", "/trace/events/0", "the announcement must be the first event"));
    for (const [index, event] of boundedEvents.entries()) validateEventShape(event, `/trace/events/${index}`, presentationValue, state, errors);
    const completionIndex = boundedEvents.findIndex((event) => event?.type === "completion");
    if (completionIndex >= 0 && completionIndex !== boundedEvents.length - 1) errors.push(issue("completion-not-last", `/trace/events/${completionIndex}`, "completion must be the final event"));
    if (state.checklists.length === 0) errors.push(issue("checklist-required", "/trace/events", "a trace must contain at least one checklist event"));
  }
  if (!state.announcement) errors.push(issue("announcement-required", "/trace/events", "trace must contain exactly one announcement"));
  if (!state.completion) errors.push(issue("completion-required", "/trace/events", "trace must contain one completion event"));
  return { valid: errors.length === 0, errors: orderedErrors(errors), summary: makeSummary(trace, state) };
}

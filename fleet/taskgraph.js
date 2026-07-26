"use strict";
const fs = require("fs");
const path = require("path");

const TASK_ID = /^[A-Za-z][A-Za-z0-9_-]{1,63}$/;
const VALID_STATUS = new Set([
  "todo",
  "running",
  "accepted",
  "merged",
  "failed",
  "blocked",
  "blocked_human",
]);
function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}
function normalizeGraph(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new Error("task graph must be an object");
  if (!raw.tasks || typeof raw.tasks !== "object" || Array.isArray(raw.tasks))
    throw new Error("task graph requires a tasks object");
  // `owns` and `needs` are the reviewable task-plan vocabulary. Keep the
  // internal ownedFiles alias so older scheduler code never trusts agent input.
  const tasks = Object.fromEntries(
    Object.entries(raw.tasks).map(([id, task]) => [
      id,
      {
        ...task,
        ownedFiles: task && task.owns ? task.owns : task && task.ownedFiles,
      },
    ]),
  );
  return {
    version: raw.version || 1,
    integrationVerify: raw.integrationVerify,
    tasks,
  };
}
function validateGraph(raw, { lanes = null } = {}) {
  const graph = normalizeGraph(raw);
  const errors = [];
  const activeOwners = new Map();
  if (
    typeof graph.integrationVerify !== "string" ||
    !graph.integrationVerify.trim()
  )
    errors.push("missing integrationVerify command");
  for (const [id, task] of Object.entries(graph.tasks)) {
    if (!TASK_ID.test(id)) errors.push(`${id}: invalid task id`);
    if (!task || typeof task !== "object" || Array.isArray(task)) {
      errors.push(`${id}: task must be an object`);
      continue;
    }
    if (typeof task.title !== "string" || !task.title.trim())
      errors.push(`${id}: missing title`);
    if (typeof task.lane !== "string" || !task.lane.trim())
      errors.push(`${id}: missing lane`);
    else if (lanes && !lanes.has(task.lane))
      errors.push(`${id}: unknown lane ${task.lane}`);
    if (!Array.isArray(task.deps)) errors.push(`${id}: deps must be an array`);
    // `needs` documents consumed contracts/APIs, including non-blocking ones.
    // `deps` alone drives readiness, so documentation never accidentally
    // serialises independent lanes.
    if (!Array.isArray(task.needs))
      errors.push(`${id}: needs must be an array`);
    if (!Array.isArray(task.owns) || !task.owns.length)
      errors.push(`${id}: owns must be a non-empty array`);
    if (typeof task.verify !== "string" || !task.verify.trim())
      errors.push(`${id}: missing verify command`);
    const status = task.status || "todo";
    if (!VALID_STATUS.has(status))
      errors.push(`${id}: invalid status ${status}`);
    const ownsContracts = (task.ownedFiles || []).includes(
      "fleet/contracts/contracts.ts",
    );
    if (ownsContracts)
      errors.push(`${id}: contracts.ts is human-only and cannot be lane-owned`);
    const controlPlane = (task.ownedFiles || []).some((f) =>
      /^(worker\.js|config\.js|AGENT_PROMPT\.md|fastcapture\/|fleet\/)/.test(f),
    );
    if (controlPlane && task.requiresHumanApproval !== true)
      errors.push(`${id}: control-plane work requiresHumanApproval: true`);
    for (const f of task.ownedFiles || []) {
      if (typeof f !== "string" || !f || path.isAbsolute(f) || f.includes(".."))
        errors.push(`${id}: invalid owned file ${String(f)}`);
      if (["running", "accepted"].includes(status) && activeOwners.has(f))
        errors.push(
          `${id}: active ownership overlaps ${activeOwners.get(f)} at ${f}`,
        );
      if (["running", "accepted"].includes(status)) activeOwners.set(f, id);
    }
  }
  for (const [id, task] of Object.entries(graph.tasks))
    for (const dep of task.deps || []) {
      if (!graph.tasks[dep])
        errors.push(`${id}: dependency ${dep} does not exist`);
      if (dep === id) errors.push(`${id}: task depends on itself`);
    }
  const visiting = new Set(),
    visited = new Set();
  function visit(id, trail) {
    if (visiting.has(id)) {
      errors.push(`dependency cycle: ${[...trail, id].join(" -> ")}`);
      return;
    }
    if (visited.has(id)) return;
    visiting.add(id);
    for (const d of graph.tasks[id].deps || [])
      if (graph.tasks[d]) visit(d, [...trail, id]);
    visiting.delete(id);
    visited.add(id);
  }
  Object.keys(graph.tasks).forEach((id) => visit(id, []));
  return { ok: errors.length === 0, errors, graph };
}
function loadGraph(file, options) {
  const result = validateGraph(readJson(file), options);
  if (!result.ok)
    throw new Error(`Invalid task graph:\n- ${result.errors.join("\n- ")}`);
  return result.graph;
}
function saveGraph(file, graph) {
  // A supervisor can be killed at any point overnight. Rename is atomic on the
  // same filesystem, so readers see either the old complete graph or the new one.
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(graph, null, 2) + "\n");
  fs.renameSync(tmp, file);
}
module.exports = {
  VALID_STATUS,
  readJson,
  normalizeGraph,
  validateGraph,
  loadGraph,
  saveGraph,
};

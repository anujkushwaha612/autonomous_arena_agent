"use strict";
function depsDone(task, tasks) {
  return (task.deps || []).every(
    (id) => tasks[id] && tasks[id].status === "merged",
  );
}
function files(task) {
  return task.ownedFiles || task.owns || [];
}
function overlaps(a, b) {
  return files(a).some((f) => files(b).includes(f));
}
function eligibleNow(task, now = Date.now()) {
  return !task.nextEligibleAt || Date.parse(task.nextEligibleAt) <= now;
}
function readyTasks(
  graph,
  { lanes = null, running = [], now = Date.now() } = {},
) {
  const candidates = Object.entries(graph.tasks)
    .filter(
      ([, t]) =>
        t.status === "todo" &&
        eligibleNow(t, now) &&
        depsDone(t, graph.tasks) &&
        (!t.requiresHumanApproval || t.humanApproved === true) &&
        (!lanes || lanes.has(t.lane)),
    )
    .map(([id, task]) => ({ id, task }));
  const selected = [];
  for (const item of candidates) {
    if (
      running.some((r) => overlaps(item.task, r.task || r)) ||
      selected.some((r) => overlaps(item.task, r.task))
    )
      continue;
    selected.push(item);
  }
  return selected;
}
function nextWave(graph, { lanes = null, capacity = Infinity } = {}) {
  const running = Object.entries(graph.tasks)
    .filter(([, t]) => ["running", "accepted"].includes(t.status))
    .map(([id, task]) => ({ id, task }));
  const available = Math.max(
    0,
    capacity - running.filter((x) => x.task.status === "running").length,
  );
  const occupiedLanes = new Set(
    running.filter((x) => x.task.status === "running").map((x) => x.task.lane),
  );
  return readyTasks(graph, { lanes, running })
    .filter((x) => !occupiedLanes.has(x.task.lane))
    .slice(0, available);
}
module.exports = { depsDone, overlaps, eligibleNow, readyTasks, nextWave };

#!/usr/bin/env node
"use strict";
/** Deterministic fleet supervisor. It owns state, retries, and merge truth. */
const fs = require("fs");
const path = require("path");
const { spawn, execFileSync } = require("child_process");
const { loadGraph, saveGraph } = require("./taskgraph");
const { nextWave } = require("./scheduler");
const { createWorktree, removeWorktree } = require("./worktree-manager");
const {
  mergeBranch,
  shell,
  ensureIntegration,
} = require("./merge-coordinator");
const { logEvent } = require("./log");

const ROOT = path.resolve(__dirname, "..");
let TARGET_ROOT = ROOT;
let TARGET = null;
function prepareProject(project) {
  const manifest = path.join(
    ROOT,
    "fleet",
    "projects",
    project,
    "project.json",
  );
  if (!fs.existsSync(manifest)) return; // legacy controller-local project
  TARGET = JSON.parse(fs.readFileSync(manifest, "utf8"));
  TARGET_ROOT =
    process.env.FLEET_PROJECT_DIR ||
    path.join(ROOT, ".fleet", "targets", project);
  if (!fs.existsSync(path.join(TARGET_ROOT, ".git"))) {
    fs.mkdirSync(path.dirname(TARGET_ROOT), { recursive: true });
    require("child_process").execFileSync(
      "git",
      ["clone", TARGET.repoUrl, TARGET_ROOT],
      { stdio: "inherit" },
    );
  }
  require("child_process").execFileSync("git", ["fetch", "origin"], {
    cwd: TARGET_ROOT,
    stdio: "inherit",
  });
  require("child_process").execFileSync(
    "git",
    ["checkout", TARGET.baseBranch || "main"],
    { cwd: TARGET_ROOT, stdio: "inherit" },
  );
  require("child_process").execFileSync("git", ["pull", "--ff-only"], {
    cwd: TARGET_ROOT,
    stdio: "inherit",
  });
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function args(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i];
    if (!x.startsWith("--")) out._.push(x);
    else {
      const [k, v] = x.slice(2).split("=");
      out[k] =
        v === undefined
          ? argv[i + 1] && !argv[i + 1].startsWith("--")
            ? argv[++i]
            : true
          : v;
    }
  }
  return out;
}
function projectDir(project) {
  return path.join(ROOT, "fleet", "projects", project);
}
function graphFile(project) {
  return TARGET
    ? path.join(TARGET_ROOT, TARGET.taskGraph)
    : path.join(projectDir(project), "taskgraph.json");
}
function lanesFromRoot() {
  const dir = path.join(ROOT, "fleet", "lanes");
  return new Set(
    fs
      .readdirSync(dir)
      .filter((x) => x.endsWith(".json"))
      .map((x) => path.basename(x, ".json")),
  );
}
function taskFile(id) {
  return TARGET ? `${TARGET.taskDirectory}/${id}.md` : `fleet/tasks/${id}.md`;
}
function parseLanes(value) {
  return value
    ? new Set(
        String(value)
          .split(",")
          .map((x) => x.trim())
          .filter(Boolean),
      )
    : null;
}
function validate(project) {
  const graph = loadGraph(graphFile(project), { lanes: lanesFromRoot() });
  for (const id of Object.keys(graph.tasks))
    if (!fs.existsSync(path.join(TARGET_ROOT, taskFile(id))))
      throw new Error(`${id}: missing ${taskFile(id)}`);
  return graph;
}
function runProcess(command, argv, opts, timeoutMs) {
  return new Promise((resolve) => {
    const child = spawn(command, argv, opts);
    let settled = false;
    const finish = (r) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve(r);
      }
    };
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 5000).unref();
      finish({ ok: false, code: -1, timedOut: true });
    }, timeoutMs);
    child.on("error", (e) => finish({ ok: false, code: -1, error: e.message }));
    child.on("close", (code) => finish({ ok: code === 0, code }));
  });
}
function failure(graph, id, reason) {
  const task = graph.tasks[id];
  const attempts = task.attempts || 0;
  task.lastError = reason;
  if (attempts >= 3) {
    task.status = "blocked_human";
    task.blockedAt = new Date().toISOString();
    delete task.nextEligibleAt;
    return "quarantined";
  }
  task.status = "todo";
  if (attempts === 2)
    task.nextEligibleAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  else delete task.nextEligibleAt;
  return "requeued";
}
function git(args) {
  return execFileSync("git", args, {
    cwd: TARGET_ROOT,
    stdio: ["ignore", "pipe", "pipe"],
  })
    .toString()
    .trim();
}
function publishIntegration() {
  const branch = TARGET?.integrationBranch || "integration";
  // State lives on integration, never on main. Publish before assignments so
  // remote Arena sandboxes clone the exact base the coordinator will merge.
  git(["switch", branch]);
  if (git(["status", "--porcelain"]).trim()) {
    git(["add", TARGET?.taskGraph || "fleet/taskgraph.json"]);
    git(["commit", "-m", "fleet: persist task state"]);
  }
  git(["push", "-u", "origin", branch]);
}
function recoverOrphans(project) {
  const graph = validate(project);
  let n = 0;
  for (const [id, task] of Object.entries(graph.tasks))
    if (task.status === "running") {
      task.status = "todo";
      task.lastError = "supervisor_crash: running outcome unknown";
      task.recoveredAt = new Date().toISOString();
      n++;
      logEvent(ROOT, "orphan_requeued", {
        project,
        taskId: id,
        lane: task.lane,
      });
    }
  if (n) saveGraph(graphFile(project), graph);
  return n;
}

async function executeTask(project, item, slot, options) {
  const { id, task } = item;
  const file = graphFile(project);
  let graph = validate(project);
  if (graph.tasks[id].status !== "todo")
    throw new Error(`${id} is no longer todo`);
  graph.tasks[id].status = "running";
  graph.tasks[id].attempts = (graph.tasks[id].attempts || 0) + 1;
  saveGraph(file, graph);
  const wt = createWorktree(TARGET_ROOT, { lane: task.lane, taskId: id });
  logEvent(ROOT, "agent_started", {
    project,
    taskId: id,
    lane: task.lane,
    branch: wt.branch,
  });
  const env = {
    ...process.env,
    FLEET_WORKTREE_ROOT: wt.dir,
    REPO_URL: TARGET?.repoUrl || process.env.REPO_URL,
    FLEET_REPO_REF: TARGET?.integrationBranch || "integration",
    TASKS: "1",
    FLEET_TASK_ID: id,
    FLEET_LANE: task.lane,
    FLEET_TASK_FILE: taskFile(id),
    FLEET_ALLOWED_FILES: JSON.stringify(task.ownedFiles),
    FLEET_VERIFY_CMD: task.verify,
    FLEET_NO_PUSH: "true",
    ARENA_PROFILE_DIR: path.join(ROOT, ".arena-profiles", task.lane),
    DROP_DIR: path.join(ROOT, ".fleet", "drops", `${task.lane}-${id}`),
    INGEST_PORT: String(8787 + slot),
  };
  const worker = await runProcess(
    process.execPath,
    [path.join(ROOT, "worker.js")],
    { cwd: wt.dir, env, stdio: "inherit" },
    options.workerTimeoutMs,
  );
  graph = validate(project);
  if (!worker.ok) {
    const state = failure(
      graph,
      id,
      worker.timedOut
        ? "dead_session: worker timeout"
        : `worker exited ${worker.code}`,
    );
    saveGraph(file, graph);
    logEvent(ROOT, "agent_failed", {
      project,
      taskId: id,
      lane: task.lane,
      state,
      reason: graph.tasks[id].lastError,
    });
    removeWorktree(TARGET_ROOT, { lane: task.lane, taskId: id });
    return { id, ok: false };
  }
  const laneGate = shell(wt.dir, task.verify);
  if (!laneGate.ok) {
    const state = failure(graph, id, laneGate.output);
    saveGraph(file, graph);
    logEvent(ROOT, "lane_gate_failed", {
      project,
      taskId: id,
      lane: task.lane,
      state,
      reason: laneGate.output,
    });
    removeWorktree(TARGET_ROOT, { lane: task.lane, taskId: id });
    return { id, ok: false };
  }
  graph.tasks[id].status = "accepted";
  delete graph.tasks[id].lastError;
  saveGraph(file, graph);
  logEvent(ROOT, "lane_accepted", {
    project,
    taskId: id,
    lane: task.lane,
    branch: wt.branch,
  });
  return { id, ok: true, branch: wt.branch };
}
async function mergeAccepted(project, results) {
  for (const result of results
    .filter((x) => x.ok)
    .sort((a, b) => a.id.localeCompare(b.id))) {
    const graph = validate(project);
    const task = graph.tasks[result.id];
    const merged = mergeBranch(TARGET_ROOT, {
      branch: result.branch,
      taskId: result.id,
      verify: graph.integrationVerify,
    });
    if (merged.ok) {
      task.status = "merged";
      task.mergedCommit = merged.commit;
      delete task.lastError;
      logEvent(ROOT, "task_merged", {
        project,
        taskId: result.id,
        branch: result.branch,
        commit: merged.commit,
      });
      console.log(`✓ merged ${result.id}`);
    } else {
      const state = failure(
        graph,
        result.id,
        `${merged.stage}: ${merged.reason}`,
      );
      logEvent(ROOT, "integration_failed", {
        project,
        taskId: result.id,
        state,
        stage: merged.stage,
        reason: merged.reason,
      });
      console.error(`✗ ${state} ${result.id}: ${merged.stage}`);
    }
    saveGraph(graphFile(project), graph);
    publishIntegration();
    removeWorktree(TARGET_ROOT, { lane: task.lane, taskId: result.id });
  }
}
async function run(project, options) {
  ensureIntegration(TARGET_ROOT, TARGET?.baseBranch || "main");
  publishIntegration();
  const lanes = parseLanes(options.lanes);
  const cap = Number(options["max-parallel"] || 1);
  const staggerMs = Number(options["stagger-ms"] || 60000);
  const workerTimeoutMs = Number(
    options["worker-timeout-ms"] || 25 * 60 * 1000,
  );
  const once = options.once === true;
  if (!Number.isInteger(cap) || cap < 1)
    throw new Error("--max-parallel must be a positive integer");
  const recovered = recoverOrphans(project);
  if (recovered) console.log(`Requeued ${recovered} orphaned task(s).`);
  while (true) {
    const graph = validate(project);
    const wave = nextWave(graph, { lanes, capacity: cap });
    if (!wave.length) {
      if (once) return;
      console.log("No eligible work; sleeping 60s.");
      await sleep(60000);
      continue;
    }
    console.log(`Starting: ${wave.map((x) => x.id).join(", ")}`);
    const results = await Promise.all(
      wave.map(async (item, i) => {
        if (i) await sleep(staggerMs * i);
        return executeTask(project, item, i, { workerTimeoutMs });
      }),
    );
    await mergeAccepted(project, results);
    if (once) return;
  }
}
async function runOne(project, id) {
  ensureIntegration(TARGET_ROOT, TARGET?.baseBranch || "main");
  publishIntegration();
  const graph = validate(project);
  if (!graph.tasks[id]) throw new Error(`unknown task ${id}`);
  if (graph.tasks[id].requiresHumanApproval && !graph.tasks[id].humanApproved)
    throw new Error(`${id} requires human approval`);
  const result = await executeTask(project, { id, task: graph.tasks[id] }, 0, {
    workerTimeoutMs: 25 * 60 * 1000,
  });
  await mergeAccepted(project, [result]);
  if (!result.ok) process.exitCode = 1;
}
async function main() {
  const o = args(process.argv.slice(2));
  const command = o._[0] || "help";
  const project = o.project || "default";
  prepareProject(project);
  if (command === "validate") {
    validate(project);
    console.log(`✓ ${project} task graph is valid`);
    return;
  }
  if (command === "approve") {
    const id = o._[1];
    const graph = validate(project);
    if (!id || !graph.tasks[id])
      throw new Error("usage: approve TASK_ID --project name");
    graph.tasks[id].humanApproved = true;
    saveGraph(graphFile(project), graph);
    logEvent(ROOT, "human_approved", { project, taskId: id });
    return;
  }
  if (command === "run") return run(project, o);
  if (command === "run-task") return runOne(project, o._[1]);
  console.log(
    "Usage: fleet <validate|approve|run|run-task> --project NAME [--lanes a,b] [--max-parallel N] [--once]",
  );
}
main().catch((e) => {
  console.error(`fleet supervisor: ${e.message}`);
  process.exit(1);
});

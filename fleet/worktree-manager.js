"use strict";
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
function git(root, args) {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}
function safe(s) {
  if (!/^[A-Za-z0-9_-]+$/.test(s)) throw new Error(`unsafe identifier: ${s}`);
  return s;
}
function branchFor(lane, taskId) {
  return `agent/${safe(lane)}/${safe(taskId)}`;
}
function worktreePath(root, lane, taskId) {
  return path.join(
    root,
    ".fleet",
    "worktrees",
    `${safe(lane)}-${safe(taskId)}`,
  );
}
function createWorktree(root, { lane, taskId, base = "integration" }) {
  const dir = worktreePath(root, lane, taskId);
  const branch = branchFor(lane, taskId);
  fs.mkdirSync(path.dirname(dir), { recursive: true });
  if (fs.existsSync(dir)) throw new Error(`worktree already exists: ${dir}`);
  git(root, ["show-ref", "--verify", "--quiet", `refs/heads/${base}`]);
  let exists = false;
  try {
    git(root, ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`]);
    exists = true;
  } catch {}
  if (exists) throw new Error(`branch already exists: ${branch}`);
  git(root, ["worktree", "add", "--detach", dir, base]);
  try {
    git(dir, ["switch", "-c", branch]);
  } catch (e) {
    try {
      git(root, ["worktree", "remove", "--force", dir]);
    } catch {}
    throw e;
  }
  return { dir, branch };
}
function removeWorktree(root, { lane, taskId }) {
  const dir = worktreePath(root, lane, taskId);
  if (fs.existsSync(dir)) git(root, ["worktree", "remove", "--force", dir]);
}
module.exports = { branchFor, worktreePath, createWorktree, removeWorktree };

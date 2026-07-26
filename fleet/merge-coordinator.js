"use strict";
const { execFileSync } = require("child_process");
function git(root, args) {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}
function shell(root, command, timeout = 300000) {
  try {
    execFileSync(
      process.platform === "win32" ? "cmd.exe" : "sh",
      process.platform === "win32"
        ? ["/d", "/s", "/c", command]
        : ["-lc", command],
      { cwd: root, stdio: "pipe", timeout },
    );
    return { ok: true, output: "" };
  } catch (e) {
    return {
      ok: false,
      output: [e.stdout, e.stderr, e.message]
        .filter(Boolean)
        .map(String)
        .join("\n")
        .slice(-8000),
    };
  }
}
function ensureIntegration(root, base = "main") {
  try {
    git(root, ["show-ref", "--verify", "--quiet", "refs/heads/integration"]);
  } catch {
    git(root, ["branch", "integration", base]);
  }
}
function mergeBranch(
  root,
  { branch, taskId, integration = "integration", verify },
) {
  ensureIntegration(root);
  git(root, ["switch", integration]);
  const before = git(root, ["rev-parse", "HEAD"]);
  try {
    git(root, ["merge", "--no-ff", "--no-commit", branch]);
  } catch (e) {
    git(root, ["merge", "--abort"]);
    return { ok: false, stage: "merge", reason: String(e.stderr || e.message) };
  }
  const check = shell(root, verify);
  if (!check.ok) {
    git(root, ["reset", "--hard", before]);
    return { ok: false, stage: "integration-gate", reason: check.output };
  }
  try {
    git(root, ["commit", "-m", `fleet: merge ${taskId} (${branch})`]);
    return { ok: true, commit: git(root, ["rev-parse", "HEAD"]) };
  } catch (e) {
    git(root, ["reset", "--hard", before]);
    return {
      ok: false,
      stage: "commit",
      reason: String(e.stderr || e.message),
    };
  }
}
module.exports = { mergeBranch, ensureIntegration, shell };

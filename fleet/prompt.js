"use strict";
const fs = require("fs");
const path = require("path");
function buildAssignmentPrompt({
  repoUrl,
  repoRef = null,
  taskId,
  lane,
  ingestUrl,
  ingestToken,
  round,
  taskFile,
  ownedFiles,
  verify,
  nonce,
}) {
  const role = fs.readFileSync(
    path.join(__dirname, "roles", "implementer.md"),
    "utf8",
  );
  return `${role}

You are assigned exactly one task.

LANE: ${lane}
TASK_ID: ${taskId}
TASK FILE: ${taskFile}

Clone ${repoUrl}${repoRef ? ` at branch ${repoRef}` : ""} into a fresh directory and read ${taskFile}. Read fleet/contracts/contracts.ts when it exists. Do only this task.

Use this exact clone command so your patch is based on the fleet integration state:
    git clone ${repoRef ? `--branch ${repoRef} ` : ""}${repoUrl} forgeguard-work
    cd forgeguard-work

HARD BOUNDARIES
- You may modify ONLY these repository-relative files: ${ownedFiles.map((f) => `\`${f}\``).join(", ")}.
- Do NOT edit taskgraph.json, any task status, fleet/supervisor.js, fleet/scheduler.js, fleet/merge-coordinator.js, worker.js, config.js, or fastcapture/.
- Do not change a file outside the allowed list merely to fix lint, formatting, or a pre-existing issue.
- Do not create a git commit or push. The deterministic supervisor owns commits, task state, and merging.
- Do not choose another task. If blocked, report HANDOFF_FAILED.

Verification required by this assignment:
    ${verify}
Run it and fix failures caused by your work before uploading.

Upload your staged binary patch exactly as follows:
    git add -A
    git diff --cached --binary | gzip -9 -c > /tmp/patch.gz
    curl -sS --fail --retry 3 --max-time 60 \\
      -H "x-agent-token: ${ingestToken}" \\
      -H "content-type: application/octet-stream" \\
      --data-binary @/tmp/patch.gz \\
      "${ingestUrl}/patch?kind=patch&lane=${encodeURIComponent(lane)}&task=${encodeURIComponent(taskId)}&attempt=1&round=${round}"

Return only the receipt in this exact form after a successful upload:
%%%RECEIPT:xxxxxxxxxxxx%%%
If you cannot complete the assigned task, return:
%%%HANDOFF_FAILED%%% one-line reason

###WORKER_ANCHOR_${nonce}###`;
}
module.exports = { buildAssignmentPrompt };

"use strict";
const fs = require("fs");
const path = require("path");
function logEvent(root, event, data = {}) {
  const file = path.join(root, "fleet", "fleet-log.jsonl");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(
    file,
    JSON.stringify({ ts: new Date().toISOString(), event, ...data }) + "\n",
  );
}
module.exports = { logEvent };

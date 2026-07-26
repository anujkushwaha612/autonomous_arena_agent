"use strict";
const assert = require("assert");
const { validateGraph } = require("./taskgraph");
const { nextWave } = require("./scheduler");
const lanes = new Set(["core", "cli"]);
const base = {
  version: 1,
  integrationVerify: "node --version",
  tasks: {
    "FG-001": {
      title: "core",
      lane: "core",
      status: "merged",
      deps: [],
      needs: ["contracts"],
      owns: ["src/core.ts"],
      verify: "node --check src/core.ts",
    },
    "FG-002": {
      title: "cli",
      lane: "cli",
      status: "todo",
      deps: ["FG-001"],
      needs: ["Policy"],
      owns: ["src/cli.ts"],
      verify: "node --check src/cli.ts",
    },
    "FG-003": {
      title: "conflict",
      lane: "core",
      status: "todo",
      deps: ["FG-001"],
      needs: ["Policy"],
      owns: ["src/cli.ts"],
      verify: "node --check src/cli.ts",
    },
  },
};
assert(validateGraph(base, { lanes }).ok);
const wave = nextWave(base, { lanes, capacity: 2 });
assert.deepStrictEqual(
  wave.map((x) => x.id),
  ["FG-002"],
);
const bad = structuredClone(base);
bad.tasks["FG-001"].deps = ["FG-002"];
assert(!validateGraph(bad, { lanes }).ok);
console.log("fleet self-test passed");

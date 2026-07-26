# Fleet control plane

`fleet/projects/<project>/taskgraph.json` is supervisor-owned truth. Agents never edit it. Each task declares exact `owns` paths, `needs` contracts/APIs for boundary documentation, and `deps` for scheduling. A task is runnable only when all dependencies are `merged`, its lane is free, and its owned files do not overlap another active assignment.

Create a project graph and matching `fleet/tasks/<TASK_ID>.md` files, then use:

```sh
npm run fleet -- validate --project forgeguard
npm run fleet -- run --project forgeguard --lanes core,cli --max-parallel 2
```

Each worker has an isolated worktree, branch, browser profile, ingest port, and drop directory. Accepted branches merge one at a time into `integration`; status becomes `merged` only after the integration gate passes.

## Operating rule

The task graph and task files must be committed and available at the repository URL before an Arena worker starts: the remote sandbox clones that URL. After a merged wave, publish the reviewed `integration` branch before scheduling tasks that depend on it. The supervisor intentionally never pushes `main`.

## ForgeGuard bootstrap

`fleet/projects/forgeguard/taskgraph.json` is intentionally empty until the
product owner freezes ForgeGuard's API and adds scoped task files. The supplied
lane split is `core`, `ledger`, `mcp`, `cli`, and `docs`; create task ownership
under `src/<lane>/**` so lanes do not overlap. ForgeGuard's root `tsconfig.json`
must explicitly contain `"include": ["src/**/*.ts"]`; the integration command
must run a real `pnpm typecheck && pnpm test`, not a file-by-file compiler call.

## Human approval

Tasks that touch worker, scheduler, prompt, ingest, gate, or merge-control files must declare `requiresHumanApproval: true`. They are not schedulable until:

```sh
npm run fleet -- approve INFRA-003 --project forgeguard
```

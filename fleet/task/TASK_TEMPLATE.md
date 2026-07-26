# TASK-ID: concise title

## Goal

Describe the single implementation outcome.

## Acceptance criteria

- Observable behavior one
- Observable behavior two

## Allowed files

- Must exactly match `owns` in the project task graph.

## Consumed contracts / APIs

- Must exactly match the task's `needs` entries. These document boundaries;
  only `deps` controls scheduler readiness.

## Verification command

```sh
command from taskgraph.json
```

## Non-goals

- Explicitly state excluded adjacent work.

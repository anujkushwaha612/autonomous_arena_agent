# AgentChain — RepLog, a gym & strength-training tracker

The **task brain**. Each agent completes exactly **one** task, then hands off.

Protocol lives in `AGENT_PROMPT.md` (the worker pastes it into Arena each round).

Summary: clone → read this file + `NEXT.md` → do the first unfinished task →
flip it to `DONE` → upload the patch via curl → print `%%%RECEIPT:xxxxxxxxxxxx%%%`.

**Never paste a diff or base64 into chat.** The patch is uploaded out-of-band.

---

## Product direction

RepLog is a premium, self-hostable strength-training platform: fast enough to use one-handed at a rack, rigorous enough to analyse training over years, and secure enough for personal health-adjacent data.

### Chosen architecture

- **Monorepo:** pnpm workspaces + Turborepo.
- **Web:** Next.js (App Router), React, TypeScript, Tailwind CSS, shadcn/ui primitives, React Hook Form + Zod, TanStack Query, Recharts.
- **API:** NestJS, TypeScript, REST with OpenAPI/Swagger. Feature modules own their controllers, services, DTOs, and tests.
- **Database:** PostgreSQL 16, Prisma ORM with versioned migrations. UUID primary keys, UTC timestamps, explicit constraints and indexes.
- **Jobs/cache:** Redis + BullMQ for exports, reminders, and aggregate refreshes. The app remains usable without workers for core logging.
- **Auth:** Auth.js-compatible credential/OAuth flow, Argon2id password hashing, secure HTTP-only sessions, RBAC.
- **Local development/deployment:** Docker Compose; production images are multi-stage, non-root, health-checked containers. Object storage is S3-compatible.
- **Quality:** ESLint, Prettier, strict TypeScript, Vitest, Playwright, Testcontainers, GitHub Actions, OpenTelemetry, structured logging.

### Non-negotiable engineering rules

1. Every change is TypeScript unless the ecosystem requires another language.
2. Never commit secrets. Update `.env.example` when adding configuration.
3. Prisma schema changes require a migration, indexes where query patterns need them, and a rollback note in the task receipt.
4. API inputs are validated at the boundary; responses use stable versioned `/api/v1` contracts and documented error envelopes: `{ "error": { "code", "message", "details?" } }`.
5. Store all timestamps in UTC. User-facing dates/times are rendered in the user’s IANA timezone. Training weights are stored in kilograms and display units are a user preference.
6. Use transactions for multi-record writes. Never silently discard data.
7. A task is complete only after its stated tests and all pre-existing checks pass. Add focused tests with each behavioural task.
8. Maintain accessibility: keyboard operation, semantic HTML, labels, focus states, reduced-motion support, and WCAG AA contrast.
9. Mobile performance matters: no blocking network dependency to log a set; optimistic UI changes must reconcile safely.
10. Keep modules cohesive. No business logic in React components or HTTP controllers.

### Core domain conventions

- A **training session** has started/completed timestamps, notes, a timezone, and optional routine instance.
- A **set** has exercise, order, kind (`warmup`, `working`, `drop`, `amrap`, `failure`), weightKg, reps, optional RPE/RIR, timestamps, and optional duration/distance for conditioning.
- An **exercise** is versioned library data with muscle allocation percentages, equipment, instructions, and aliases.
- Personal data is private to an organisation/account boundary from day one, even though the first UX is single-user.

### Agent operating procedure

1. Read `NEXT.md`, this file, the current schema, and neighbouring modules before changing code.
2. Complete only the first `TODO` task below. Do not begin a later task.
3. Mark that task `DONE` in this file and advance `NEXT.md` to the following task with a concise handoff: decisions, migration name, test commands, and known risks.
4. Run the required task tests plus the full relevant suite. Do not claim success on unrun checks.
5. Upload the patch out-of-band and print only the required receipt marker after the normal concise handoff.

---

## Delivery plan

### Foundation and developer experience

#### T01 — Repository and workspace bootstrap
**STATUS: TODO**

Create the pnpm/Turborepo workspace with `apps/web`, `apps/api`, `packages/ui`, `packages/config`, and `packages/types`. Add root scripts for dev, build, lint, typecheck, test, test:e2e, format, and db commands. Pin Node/pnpm versions and configure strict TypeScript.

**Acceptance:** clean clone installs and `pnpm lint`, `pnpm typecheck`, and `pnpm build` run successfully.

#### T02 — Local services and environment contract
**STATUS: TODO**

Add Docker Compose for PostgreSQL, Redis, MinIO, MailHog, API, worker, and web development profiles. Provide `.env.example`, startup documentation, health checks, volumes, and no real credentials.

**Acceptance:** `docker compose up` starts dependencies and documented local URLs work.

#### T03 — API application skeleton
**STATUS: TODO**

Create the NestJS API with `/api/v1`, global validation, secure defaults (Helmet, CORS allowlist, request IDs), consistent error serialization, OpenAPI generation, and `/health/live` plus `/health/ready`.

**Acceptance:** health endpoints and generated Swagger JSON are tested.

#### T04 — Web application shell and design system
**STATUS: TODO**

Create the Next.js application shell, font loading, dark/light system-aware theme, responsive navigation, error boundary, loading states, and shared UI primitives.

**Acceptance:** visual smoke test verifies navigation, theme contrast, and responsive layout.

#### T05 — CI, code quality, and commit safeguards
**STATUS: TODO**

Add ESLint, Prettier, import ordering, Husky/lint-staged, Vitest baseline config, and GitHub Actions for install, lint, typecheck, unit tests, build, and dependency audit.

**Acceptance:** CI workflow is validated locally where possible and catches a deliberate lint violation.

#### T06 — Observability foundation
**STATUS: TODO**

Add structured JSON logging with request ID/user ID correlation, OpenTelemetry traces, Prometheus metrics, Sentry-compatible error reporting configuration, and redaction of credentials/body secrets.

**Acceptance:** an API request emits correlated logs/metrics; sensitive fields are absent.

### Identity, tenancy, and privacy

#### T07 — Database schema baseline
**STATUS: TODO**

Introduce Prisma, PostgreSQL connection configuration, migration workflow, base `User`, `Organisation`, `Membership`, and audit timestamp models with UUIDs, constraints, and indexes.

**Acceptance:** migration applies to an empty database and schema tests verify tenancy constraints.

#### T08 — Authentication and sessions
**STATUS: TODO**

Implement signup, login, logout, email verification placeholder, password reset tokens, Argon2id hashing, session rotation, rate limiting, and secure cookie policy.

**Acceptance:** integration tests cover login lifecycle, invalid credentials, and protected routes.

#### T09 — RBAC and tenant isolation
**STATUS: TODO**

Add owner/coach/athlete roles, policy guards, organisation scoping in repositories, and tenant-safe query helpers.

**Acceptance:** cross-organisation access is denied in integration tests.

#### T10 — Account settings and data privacy controls
**STATUS: TODO**

Build account/profile settings: name, timezone, units, week start, privacy preferences, data export request, and account deletion request flow.

**Acceptance:** settings persist and unit/timezone preferences are respected by API serialization.

### Exercise intelligence

#### T11 — Exercise domain schema
**STATUS: TODO**

Add exercise, equipment, muscle group, aliases, instructions, and weighted muscle-allocation models; enforce unique normalised names per library scope.

**Acceptance:** migration and repository tests cover uniqueness and allocation totals.

#### T12 — Curated exercise seed catalogue
**STATUS: TODO**

Seed a high-quality catalogue of at least 100 exercises across barbell, dumbbell, machines, cables, bodyweight, kettlebells, cardio, and mobility, including instructions and primary/secondary muscles.

**Acceptance:** idempotent seed test verifies breadth and no duplicates.

#### T13 — Exercise browse, search, and filters API
**STATUS: TODO**

Implement paginated exercise APIs with full-text/alias search, muscle/equipment filters, sort options, and OpenAPI documentation.

**Acceptance:** integration tests validate filtering, search ranking, pagination, and invalid query handling.

#### T14 — Custom exercise management
**STATUS: TODO**

Enable users/coaches to create, edit, archive, and restore tenant-scoped exercises without mutating curated global records.

**Acceptance:** ownership and archived-exercise behaviour are covered by tests.

#### T15 — Exercise detail experience
**STATUS: TODO**

Build mobile-first exercise library UI: search, chips, favourites, detailed instructions, muscle visualization, and substitute suggestions.

**Acceptance:** Playwright test covers search, filtering, favourite toggle, and accessible detail dialog.

### Training sessions and fast logging

#### T16 — Training session schema and lifecycle
**STATUS: TODO**

Model sessions, notes, status, start/finish/cancel timestamps, timezone, and ownership. Add transactional start, finish, resume, list, and detail APIs.

**Acceptance:** integration tests cover only-one-active-session policy, finish idempotency, and pagination.

#### T17 — Set and exercise-performance schema
**STATUS: TODO**

Model session exercises and ordered sets with strict validation for numeric values, RPE/RIR, set kind, and optional conditioning metrics. Preserve ordering with safe concurrent writes.

**Acceptance:** constraints and invalid payload paths are integration-tested.

#### T18 — Session logging API
**STATUS: TODO**

Implement create/update/reorder/delete session exercise and set endpoints, transactional volume calculation, optimistic-concurrency versioning, and session summaries.

**Acceptance:** tests cover ordering, conflicting edits, volume, and warmup exclusion rules.

#### T19 — Active workout mobile logger
**STATUS: TODO**

Build the rack-first logger: exercise picker, large numeric controls, quick increments, set-type controls, swipe/keyboard actions, offline draft persistence, and optimistic mutations.

**Acceptance:** Playwright mobile viewport flow logs, edits, and removes a set.

#### T20 — Rest timer and notifications
**STATUS: TODO**

Implement per-set rest timer with presets, background-safe browser notifications, audible/vibration opt-in, and an accessible non-disruptive completion state.

**Acceptance:** unit tests cover timer state transitions; E2E verifies preset start/reset.

#### T21 — Workout notes, tags, and perceived readiness
**STATUS: TODO**

Add session notes, tags, readiness/mood/soreness fields, and searchable history filters while retaining privacy controls.

**Acceptance:** API and UI tests cover validation and filtering.

#### T22 — Workout history and session detail UI
**STATUS: TODO**

Build performant history list, date/group filters, detail page, exercise/set tables, volume summaries, and edit/delete confirmation flow.

**Acceptance:** E2E covers browse, expand/detail, and safe deletion.

### Routines and coaching workflows

#### T23 — Routine and template schema
**STATUS: TODO**

Model routines, versioned routine exercises, prescribed sets/reps/load/RPE/rest, blocks, tags, visibility, and immutable published versions.

**Acceptance:** migration tests validate ordering and published-version immutability.

#### T24 — Routine CRUD API
**STATUS: TODO**

Implement create, duplicate, edit draft, publish, archive, list, and detail endpoints with Zod/Nest DTO validation and tenant policies.

**Acceptance:** integration tests cover all lifecycle states and permissions.

#### T25 — Start workout from routine
**STATUS: TODO**

Instantiate a routine version into a training session, snapshot prescriptions, and expose planned-versus-completed progress without changing historical routines.

**Acceptance:** integration tests prove later routine edits do not alter existing sessions.

#### T26 — Routine builder UI
**STATUS: TODO**

Create drag-and-drop/keyboard-accessible routine builder with exercise search, prescription editors, duplicate/delete, preview, and publish controls.

**Acceptance:** Playwright test creates and publishes a routine.

#### T27 — Coaching relationships and shared plans
**STATUS: TODO**

Add coach invitations, athlete acceptance, plan assignment, scoped viewing, and coach comments; athletes retain ownership of private notes.

**Acceptance:** role/visibility integration tests cover invitation and data boundaries.

### Progress, analytics, and recommendations

#### T28 — Personal records engine
**STATUS: TODO**

Build deterministic PR calculations (max weight, reps, volume, estimated 1RM) excluding warmups; support Epley and configurable formula selection with audit-friendly source sets.

**Acceptance:** unit tests cover formulas, ties, and excluded sets.

#### T29 — Exercise history and charts API
**STATUS: TODO**

Provide efficient time-series APIs for e1RM, top set, volume, frequency, and PR events; use indexed query plans and documented aggregation semantics.

**Acceptance:** integration test checks date bucketing and zero-safe results.

#### T30 — Progressive overload recommendation engine
**STATUS: TODO**

Implement explainable suggestions based on recent working sets, target ranges, RPE/RIR, deload state, exercise equipment increments, and confidence. Never prescribe a change with insufficient data.

**Acceptance:** deterministic unit fixtures cover advance, repeat, deload, bodyweight, and no-history cases.

#### T31 — Plate calculator
**STATUS: TODO**

Implement configurable bar and plate inventories, exact/closest plate breakdowns, collar handling, and kg/lb display conversion without storage-unit ambiguity.

**Acceptance:** unit tests cover exact, impossible, under-bar, and custom inventory cases.

#### T32 — Analytics aggregation jobs
**STATUS: TODO**

Add Redis/BullMQ aggregate jobs and materialized/read models for weekly volume, muscle balance, frequency, adherence, and exercise trends; ensure rebuildability.

**Acceptance:** Testcontainers integration test verifies enqueue, processing, and idempotent rerun.

#### T33 — Progress dashboard UI
**STATUS: TODO**

Build accessible charts and summaries for volume, e1RM, muscle balance, frequency, PRs, and streaks, with meaningful empty states and date-range controls.

**Acceptance:** E2E validates a seeded dashboard renders chart data and empty-state copy.

### Body metrics, calendar, and recovery

#### T34 — Body metric data model and API
**STATUS: TODO**

Add dated body-weight and optional measurements (waist, body-fat %, resting heart rate), one value per metric/day, validation, timezone-aware date semantics, and history APIs.

**Acceptance:** integration tests verify upsert and validation boundaries.

#### T35 — Body trends UI
**STATUS: TODO**

Create body log form and trend views with moving average, unit conversion, edit history, and privacy-sensitive empty states.

**Acceptance:** Playwright test logs and edits a metric, then verifies the trend update.

#### T36 — Training calendar and streaks
**STATUS: TODO**

Implement calendar aggregation by local day, session/volume indicators, and documented consecutive-week streak algorithm with timezone tests.

**Acceptance:** unit and API tests cover month boundaries, leap years, and empty days.

#### T37 — Recovery and deload insights
**STATUS: TODO**

Surface non-medical training-load/recovery flags using volume change, readiness, and missed sessions; provide transparent rationale and dismiss/snooze controls.

**Acceptance:** fixture-driven tests guarantee no medical claims and stable rationale output.

### Data portability, reliability, and production readiness

#### T38 — Full-fidelity export
**STATUS: TODO**

Implement authenticated JSON and CSV exports through queued jobs, signed one-time downloads, schema versioning, audit events, and correct CSV escaping.

**Acceptance:** integration test validates export contents, schema version, and CSV quoting.

#### T39 — Safe import and migration assistant
**STATUS: TODO**

Implement dry-run validation, mapping preview, conflict policy, transactionally applied import, import report, and support for RepLog export versions.

**Acceptance:** tests prove malformed imports never partially write and merge conflicts are reported.

#### T40 — Audit log and retention policies
**STATUS: TODO**

Record security-sensitive and destructive actions, add owner-visible audit queries, retention configuration, and scheduled cleanup that honours legal/operational requirements.

**Acceptance:** tests verify audit entries and retention job selection logic.

#### T41 — Backup and restore runbook
**STATUS: TODO**

Document automated PostgreSQL backup/restore, object-storage lifecycle, encryption guidance, recovery point objectives, and perform a scripted restore verification in CI/dev.

**Acceptance:** restore script recreates a known fixture database.

#### T42 — Security hardening and abuse controls
**STATUS: TODO**

Perform threat-model-driven hardening: CSRF strategy, rate limits, headers/CSP, upload restrictions, SSRF-safe storage handling, dependency scanning, and authorization regression tests.

**Acceptance:** automated security tests validate key headers, rate limit, and cross-tenant denial.

#### T43 — Performance and offline resilience
**STATUS: TODO**

Add query profiling/index refinements, API cache headers where safe, web bundle budgets, service-worker shell caching, and robust queued offline set mutations with conflict UX.

**Acceptance:** performance smoke metrics meet documented budgets; offline E2E reconciles a queued set.

#### T44 — Accessibility and internationalisation readiness
**STATUS: TODO**

Audit WCAG 2.2 AA with automated axe checks and manual keyboard paths; extract UI strings and add locale/date/number formatting infrastructure.

**Acceptance:** axe E2E suite passes critical flows; locale formatting unit tests pass.

#### T45 — End-to-end test suite and seed scenarios
**STATUS: TODO**

Create deterministic Testcontainers seed fixtures and Playwright journeys: onboarding, log workout, routine, progress, body metric, export/import, and coach sharing.

**Acceptance:** full E2E suite runs in CI from a clean environment.

#### T46 — Deployment packaging and operations guide
**STATUS: TODO**

Finalize production Docker images, Compose/Helm deployment examples, environment reference, reverse-proxy guidance, worker scaling, health probes, and upgrade/migration procedure.

**Acceptance:** production-like compose deployment completes smoke tests as non-root containers.

#### T47 — Product polish and acceptance review
**STATUS: TODO**

Resolve responsive defects, loading/error/empty state inconsistencies, copy quality, visual regression baselines, and conduct acceptance testing against all core user journeys.

**Acceptance:** no P0/P1 issues remain; visual and functional acceptance checklist is signed in `docs/acceptance.md`.

#### T48 — Release candidate and release process
**STATUS: TODO**

Create changelog, semantic versioning/release automation, database migration release gate, rollback playbook, release notes, and tagged RC pipeline.

**Acceptance:** a release dry run produces versioned artifacts, notes, and a verified rollback plan.

---

## Activity Log

<!-- Agents append one line here per completed task -->

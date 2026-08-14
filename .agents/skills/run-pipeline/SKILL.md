---
name: run-pipeline
description: Orchestrate a repository-scoped SDLC pipeline from requirement analysis through architecture and contracts, issue and branch management, test-first implementation, review, E2E, documentation, and PR handoff. Use when the user explicitly invokes $run-pipeline or run_pipeline, asks to run the full development pipeline, or requests a multi-phase frontend, backend, infrastructure, or full-stack repository change. Do not use for a small isolated bug fix, explanation, or read-only review unless the user explicitly invokes it.
---

# Run Pipeline

Run a traceable development workflow while obeying the repository's active instructions, tool permissions, and the user's requested scope.

## Operating Rules

1. Read repository instructions, current status, and relevant history first. Preserve unrelated user changes.
2. Locate architecture, contracts, issue records, and audit logs before changing them. In this repository, prefer `.claude/_workspace/**` as the legacy source of truth when it exists; the directory name does not require calling Claude.
3. Maintain a concise plan with exactly one in-progress item while work is active.
4. Use sub-agents only when the user explicitly requests delegation and the current session permits it. Otherwise, perform each role sequentially in the main agent.
5. Never fabricate independent reviewer, QA, CI, or browser approvals. Report only checks that actually ran.
6. Append START and END events to an existing JSONL audit log when the repository workflow requires it. Do not rewrite prior events.
7. Keep phase commits focused when the repository expects them. Stage only task-related files, and never include personal settings, credentials, or unrelated changes.
8. Run commands from the repository root using its package manager and documented scripts.
9. An explicit full-pipeline invocation authorizes normal in-scope issue, branch, push, and pull-request actions. An implementation-only request stops before publication unless the user asks otherwise.
10. Higher-priority safety, permission, and repository instructions always win.

## Phase 0: Analyze and Route

1. Inspect the request, worktree status, recent history, repository instructions, architecture, contracts, open work, and available validation commands.
2. Check the current issue, branch, pull request, and remote state before deciding whether to reuse them.
3. Choose the smallest suitable route: full stack, frontend/backend, infrastructure, or documentation-only.
4. Record the request, route, assumptions, and rationale in the repository's audit mechanism when one exists.
5. Ask a question only when an unresolved choice would materially change the result or expand authority.

## Phase 1: Architecture

Run this phase when the request changes system boundaries, data flow, public interfaces, deployment, or other architectural constraints.

1. Update the repository's architecture source of truth.
2. Check the document for internal consistency and search for superseded statements.
3. Confirm that the design introduces no unapproved dependency or infrastructure requirement.
4. Validate the changed documents with available checks and create a focused commit when the workflow expects phase commits.

Skip this phase when existing architecture already covers the change, and record the reason.

## Phase 2: Tracking and Contracts

1. Reuse an issue or branch only when it is still active and matches the requested scope.
2. If prior work is merged or closed, create a new issue and branch from the latest default branch instead of adding commits to completed work.
3. Synchronize acceptance criteria with the user's current request.
4. Update executable contracts and their prose invariants before consumer implementation.
5. Run contract compilation or type checks, and keep the contract change in a separate commit when practical.
6. Do not weaken types or remove contract coverage merely to make consumers pass.

## Phase 3: Test-First Implementation and Review

When sub-agents are unavailable, execute these roles sequentially and label the evidence accurately:

1. QA: add or update focused tests and confirm the intended assertion fails for the missing behavior.
2. Implementation: make the smallest production change that satisfies the contract and tests.
3. Review: inspect the complete diff for contract drift, regressions, accessibility, responsive behavior, resource cleanup, security, performance, and unrelated changes.
4. Gates: run the relevant lint, type, unit, build, format, and coverage checks supplied by the repository.
5. Fix every in-scope failure and rerun the affected gate.
6. Commit the tested implementation as a focused change.

Do not commit an intentionally broken red-test state unless the repository explicitly requires it.

## Phase 4: Browser and Integration Validation

1. Add or update end-to-end coverage for the changed user-visible behavior.
2. For responsive changes, exercise representative desktop, tablet, and mobile viewports, including overflow and control visibility.
3. Build the production application before browser validation when that matches the deployment path.
4. Prefer deterministic readiness checks and assertions over fixed sleeps.
5. Require all executed browser and integration checks to pass before advancing.
6. Keep E2E changes in a separate focused commit when practical.

If the repository has no browser harness, document the manual validation performed and the missing automation rather than inventing a pass.

## Phase 5: Documentation and Release Handoff

1. Update relevant documentation and remove instructions made obsolete by the change.
2. Run the final validation suite against the committed HEAD.
3. Review commits and the full diff, ensuring no personal or unrelated files are included.
4. Push and create or update a pull request only when the user's requested scope includes external publication.
5. Include a concise summary, validation evidence, linked issue, and explicit exclusions in the pull request.
6. Append the final audit event, commit it if required, push it, and verify the remote head, base, and pull-request state.
7. Treat absent or pending CI as absent or pending; never report it as passed.

## Failure Handling

1. Diagnose the actual cause and try safe, in-scope alternatives.
2. After the same blocking condition fails three consecutive times, stop that path and report the evidence and required next action.
3. Never bypass required checks or fabricate results to complete a phase.
4. If new user input replaces the active request, stop the superseded work and route the new request from Phase 0.

## Completion Report

Report:

- phases completed or skipped and why;
- user-visible behavior and contract changes;
- commands run and test counts or outcomes;
- commits, branch, issue, and pull-request state when applicable;
- remaining local changes, skipped checks, pending CI, or blockers.

# PROJECT_STATE

## Objective

Build an **Automation Architect** layer on top of the Activepieces Community Edition runtime: users describe a real-world problem in natural language, the system designs a safe automation, selects available capabilities, separates deterministic logic from AI reasoning, applies approval/risk rules, compiles the plan into Activepieces, validates it, and supervises execution.

## Repository

- Fork: `SanamRai001/activepieces`
- Upstream: `activepieces/activepieces`
- Default branch: `main`
- Foundation branch: `feat/automation-architect-foundation`
- Working branch: `feat/automation-ir`
- Fork baseline inspected: `17e2ac0b01797f8472e781122a396c5d07acc974`
- Foundation PR: #1
- Phase 2 PR: #2

## Completed phase

**Phase 2 — Automation IR**

### Changes

- Added a new provider-neutral core workspace package:
  - `packages/core/automation-architect/`
  - package name: `@activepieces/automation-architect`.
- Added strict Zod contracts for Automation IR V1.
- Added trigger types:
  - `MANUAL`;
  - `SCHEDULE`;
  - `EVENT`.
- Added step types:
  - `ACTION`;
  - `CONDITION`;
  - `AI_DECISION`;
  - `APPROVAL_GATE`;
  - `NOTIFICATION`.
- Added recursive automation values with explicit references to:
  - trigger output;
  - step output.
- Added provider-neutral capability identifiers and structured action/notification input.
- Added deterministic condition operators and unary/binary operand validation.
- Added AI decision routes with case-insensitive duplicate-key protection.
- Added risk metadata with these initial classes:
  - `READ_ONLY`;
  - `REVERSIBLE_WRITE`;
  - `EXTERNAL_COMMUNICATION`;
  - `SENSITIVE_MUTATION`;
  - `DESTRUCTIVE`;
  - `FINANCIAL`.
- Added separate authorization-policy contracts:
  - `ALLOW`;
  - `REQUIRE_APPROVAL`;
  - `DENY`.
- Policy rejects contradictory rules where the same risk class is both denied and approval-gated.
- Added V1 graph validation for:
  - duplicate step IDs;
  - missing control-flow targets;
  - unreachable steps;
  - control-flow cycles;
  - malformed reference-shaped objects;
  - references to unknown steps;
  - step self-references;
  - runtime-output references inside trigger configuration.
- Added `packages/core/automation-architect/README.md` documenting the IR contract and explicit version/migration rules.
- Updated `bun.lock` with the new workspace package; the generated change is 14 added lockfile lines.
- No Activepieces runtime/server/piece/web implementation was modified.

## Verification

A temporary fork-specific GitHub Actions workflow was used because upstream `.github/workflows/ci.yml` intentionally skips its real jobs unless `github.repository == 'activepieces/activepieces'`.

The temporary workflow was removed after verification.

Final Phase 2 verification:

- Workflow: `Automation Architect Base Verification`
- Run ID: `36017251158`
- Verified source/package head: `f69c384ec48d200c876771cbea3889142276611a`
- filtered frozen dependency install: PASS
- committed lockfile stability: PASS
- TypeScript build: PASS
- ESLint: PASS
- Vitest: PASS
  - 1 test file passed
  - 18 tests passed
  - 0 failed

Verification history exposed and fixed:
- missing `bun.lock` workspace metadata;
- TypeScript `TS4111` under `noPropertyAccessFromIndexSignature`;
- missing explicit `tslib` runtime dependency when the package is installed in isolation.

`tslib@2.6.2` is now declared in `@activepieces/automation-architect`, and the lockfile is current. Temporary fork-only verification workflows were removed after the green run.

## Decisions

1. **Do not rebuild Activepieces.** Treat it as the initial execution/runtime and integration layer.
2. **Do not put Automation Architect logic in Enterprise-licensed paths.**
3. **Keep planner logic provider-neutral.** Activepieces-specific structures belong behind a compiler/adapter.
4. **Automation IR V1 is strict.** Unknown fields and unknown schema versions are rejected rather than silently normalized.
5. **Automation IR V1 is acyclic.** Loops must become an explicit future IR construct rather than being encoded as accidental graph cycles.
6. **Risk metadata is descriptive, not authorization.** A planner cannot grant itself permission.
7. **Authorization policy remains separate from planner output.**
8. **Trigger configuration cannot depend on runtime outputs.**
9. **Runtime/provider validation remains mandatory later.** Passing IR validation does not prove an integration, credential or real execution is valid.
10. **Prefer deterministic automation over AI when normal rules are sufficient.**
11. **Browser/ChatGPT automation is not the MVP.** It can become an optional adapter after the core supervisor works.
12. **Coding-project supervision remains the first vertical.**
13. **No rebrand yet.** "Automation Architect" remains a working name.
14. **Minimize upstream merge conflicts.** Prefer additive modules and narrow adapters.

## Risks

- Activepieces upstream is changing quickly, especially agents, AI routing and MCP builder tooling.
- The planner can still hallucinate capabilities unless Phase 3 grounds it against authoritative capability discovery.
- V1 reference validation checks identity/existence but does not yet prove that every referenced step is guaranteed to execute before the consumer on all branch paths. The compiler/runtime validator must reject impossible execution-order references; future IR validation may add dominance analysis if needed.
- Risk classification supplied by an LLM cannot be trusted as the sole safety signal; capability metadata and deterministic policy must contribute to final authorization.
- The IR currently models schedules as cron strings; planner UX will need a deterministic natural-language-to-schedule normalization layer.
- Enterprise-licensed directories remain present in the monorepo and must not be treated as MIT code.

## Next phase

**Phase 3 — Natural-language planner prototype**

Goal: turn a bounded user request plus real available capabilities and policy context into **Automation IR only**. Do not execute or publish generated workflows yet.

Smallest useful scope:

1. define a planner input contract:
   - user goal;
   - available trigger/action capabilities;
   - connection availability;
   - policy context;
2. define a structured planner-output contract using `AutomationIrV1Schema`;
3. add capability grounding so the planner cannot invent tool names;
4. add deterministic post-generation validation;
5. return useful planner diagnostics when:
   - capability is unavailable;
   - authentication/connection is missing;
   - user intent is materially ambiguous;
   - policy requires human input;
6. add focused unit tests with mocked model output; no live paid-model requirement for the core test suite.

Deliverable: a tested planner service/interface that can convert a small set of natural-language automation requests into valid, explainable Automation IR without touching Activepieces flow execution.

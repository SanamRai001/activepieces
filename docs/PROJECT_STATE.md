# PROJECT_STATE

## Objective

Build an **Automation Architect** layer on top of Activepieces Community Edition:

```text
human automation problem
→ natural-language planner
→ grounded Automation IR
→ deterministic policy/safety
→ real Activepieces capabilities
→ safe draft compiler
→ structural validation
→ safe simulation
→ later approval-controlled activation
```

The system must prefer deterministic behavior where possible, keep model output non-authoritative for safety-sensitive facts, and preserve human control over high-impact actions.

## Repository

- Fork: `SanamRai001/activepieces`
- Upstream: `activepieces/activepieces`
- Default branch: `main`
- Foundation: `feat/automation-architect-foundation` — PR #1
- Automation IR: `feat/automation-ir` — PR #2
- Planner: `feat/natural-language-planner-phase3` — PR #4
- Capability discovery: `feat/activepieces-capability-discovery` — PR #5
- IR compiler: `feat/activepieces-ir-compiler` — PR #6
- Working branch: `feat/draft-structural-validation` — PR #7
- PR #3 is superseded/closed.

## Completed phase

**Phase 5A — Draft Structural Validation**

### Changes

- Extracted the structural validation logic previously private to `ap_validate_flow` into:
  - `packages/server/api/src/app/flows/validation/flow-structure-validation.ts`.
- `ap_validate_flow` now uses the shared validator.
- Preserved existing MCP validation wording and structured-result behavior.
- Added reusable checks for:
  - unconfigured trigger;
  - invalid non-skipped steps;
  - missing step references;
  - references to later steps;
  - empty condition branches;
  - informational empty fallback branches;
  - valid/invalid/skipped counts.
- Added Automation Architect draft validation service:
  - `packages/server/api/src/app/automation-architect/draft-validation.service.ts`.
- Added hard artifact-safety checks:
  - flow status must be `DISABLED`;
  - `publishedVersionId` must be null;
  - flow version state must be `DRAFT`.
- Added Automation Architect result states:
  - `VALIDATED_DRAFT`;
  - `NEEDS_CONFIGURATION`;
  - `FLOW_NOT_FOUND`;
  - `UNSAFE_ARTIFACT`.
- Added focused validator and Automation Architect service tests.
- Added:
  - `docs/AUTOMATION_ARCHITECT_DRAFT_VALIDATION.md`.
- No flow execution, activation, publishing, trigger enablement, or external action execution was added.

## Verification

Final Phase 5A verification:

- Workflow: `Draft Structural Validation Verification`
- Run ID: `36086683738`
- Verified implementation head: `9e0a6c881c4d006d1e2bd6041a2820d6cdb6cdf2`
- `bun install --frozen-lockfile`: PASS
- API build via `turbo run build --filter=api`: PASS
  - **17/17 build tasks successful**
- Focused typed ESLint: PASS
  - **0 errors**
  - 3 non-blocking explicit-return-type warnings
- Focused Vitest: PASS
  - **2 test files passed**
  - **14/14 tests passed**
  - 0 failed

Verification caught and fixed:

1. `publishedVersionId` can be undefined in the Activepieces type surface; the adapter now normalizes it to null.
2. Four test literals violated the repository single-quote lint rule.
3. Validator extraction initially changed MCP wording; the original messages were restored before final verification.

The temporary verification workflow was removed after the green run. Later commits are documentation/CI-cleanup only.

## Current architecture

```text
Human request
    ↓
Natural-language planner
    ↓
Automation IR V1
    ↓
Capability discovery
    ↓
IR compiler
    ↓
DISABLED + unpublished draft
    ↓
Draft safety invariants
    ↓
Shared structural validation
    ↓
VALIDATED_DRAFT / NEEDS_CONFIGURATION
```

## Key decisions

1. Activepieces remains the runtime; Automation Architect remains the intelligence/safety layer.
2. The model proposes; deterministic code validates safety-sensitive facts.
3. User intent remains authoritative.
4. Capabilities are project-scoped and re-resolved at compile time.
5. Connection choice is explicit and never guessed.
6. Compiler fails rather than approximating unsupported semantics.
7. Every generated runtime step passes Activepieces' normal operation validation.
8. Generated artifacts remain draft + disabled.
9. Structural validation is shared with Activepieces MCP rather than duplicated.
10. An enabled, published, or locked artifact is rejected by Automation Architect draft validation.
11. Structural validation does not imply that external integrations have actually run.
12. No publishing/activation path exists yet.
13. Browser/ChatGPT automation remains outside the core MVP path.

## Previous verification milestones

- Phase 2 Automation IR: **18/18 tests**
- Phase 3 planner: **33/33 tests**
- Phase 4A capability discovery: **17/17 tests**
- Phase 4B IR compiler: **33/33 tests**
- Phase 5A structural validation: **14/14 tests**

## Risks / open boundaries

- Structural validation is static; it cannot prove an external API call succeeds.
- Existing traversal-order reference checks are not a replacement for full control-flow dominance analysis. Phase 4B already rejects unsafe non-dominating IR references before compilation.
- Dynamic piece properties may still require runtime/property resolution.
- A structurally safe draft can still fail during test execution.
- Mock trigger data must never be reported as real trigger evidence.
- Some trigger types may require interaction or real external events.
- AI decisions and approval gates still lack runtime semantics.
- Manual trigger mapping remains unresolved.
- No activation policy/enforcement path exists yet.
- No production planner-model adapter is wired yet.

## Next phase

**Phase 5B — Safe Draft Test / Simulation Service**

Goal: reuse/extract Activepieces flow-test orchestration so Automation Architect can test a validated draft without publishing or enabling it.

Requirements:

1. extract a reusable test service from the behavior currently in `mcp/tools/flow-run-utils.ts`;
2. run the current **draft flow version** in the test environment;
3. preserve project scoping;
4. never publish or enable the flow;
5. optionally accept explicit mock trigger data;
6. persist mock data only as draft sample data;
7. explicitly report:
   - `usedMockTriggerData`;
   - run ID;
   - terminal status;
   - failed step name;
   - timeout/non-terminal result;
8. distinguish:
   - real/pre-existing trigger sample evidence;
   - user-supplied mock data;
9. return stable Automation Architect outcomes such as:
   - `TEST_SUCCEEDED`;
   - `TEST_FAILED`;
   - `TEST_TIMEOUT`;
   - `NEEDS_CONFIGURATION`;
   - `FLOW_NOT_FOUND`;
   - `UNSAFE_ARTIFACT`;
10. add focused tests for timeout, failures, mock-data labeling, invalid trigger, unsafe artifact, and never-publish guarantees.

Do **not** add activation or publishing in Phase 5B.

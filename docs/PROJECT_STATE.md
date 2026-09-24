# PROJECT_STATE

## Objective

Build an **Automation Architect** layer on top of the Activepieces Community Edition runtime: users describe a real-world problem in natural language, the system designs a safe automation, selects real available capabilities, separates deterministic logic from AI reasoning, applies approval/risk rules, compiles the plan into Activepieces, validates it, and supervises execution.

## Repository

- Fork: `SanamRai001/activepieces`
- Upstream: `activepieces/activepieces`
- Default branch: `main`
- Foundation branch: `feat/automation-architect-foundation`
- Phase 2 branch: `feat/automation-ir`
- Working branch: `feat/natural-language-planner`
- Fork baseline inspected: `17e2ac0b01797f8472e781122a396c5d07acc974`
- Foundation PR: #1
- Phase 2 PR: #2
- Phase 3 PR: #3

## Completed phase

**Phase 3 — Natural-language Planner Prototype**

### Changes

- Added provider-neutral capability contracts:
  - `TRIGGER`;
  - `ACTION`;
  - `NOTIFICATION`.
- Capability catalog entries carry:
  - stable capability ID;
  - name/description;
  - kind;
  - connection requirement/availability;
  - authoritative risk metadata for side-effect-capable actions/notifications.
- Added planner input contract:
  - user goal;
  - supplied capability catalog;
  - deterministic policy;
  - optional constraints.
- Added small provider-neutral model interface.
- Added centralized `AUTOMATION_PLANNER_RULES` so model adapters receive the same behavioral contract.
- Model output is restricted to:
  - `READY` with a candidate automation; or
  - `NEEDS_INPUT` with focused questions.
- Added strict model-envelope parsing before IR parsing.
- Added deterministic post-model grounding:
  - rejects invented capability IDs;
  - rejects capability-kind mismatches;
  - detects unavailable required connections;
  - applies deterministic deny policy;
  - reports approval-required operations;
  - replaces model-supplied risk with authoritative catalog risk;
  - keeps the user's original goal authoritative.
- Planner result states:
  - `READY`;
  - `NEEDS_INPUT`;
  - `FAILED`.
- Added diagnostics:
  - `INVALID_INPUT`;
  - `MODEL_FAILURE`;
  - `MODEL_OUTPUT_INVALID`;
  - `INVALID_AUTOMATION_IR`;
  - `UNKNOWN_CAPABILITY`;
  - `CAPABILITY_KIND_MISMATCH`;
  - `CONNECTION_REQUIRED`;
  - `POLICY_APPROVAL_REQUIRED`;
  - `POLICY_DENIED`.
- Added `docs/AUTOMATION_ARCHITECT_PLANNER.md`.
- Extended the package README with planner trust boundaries and behavior.
- No Activepieces flow creation, mutation, execution, publishing, or external side effect was added.

### Phase 2 packaging correction

Phase 3 verification exposed a real package-boundary issue from Phase 2: isolated TypeScript builds require `tslib`.

Resolved by:

- declaring `tslib@2.6.2` in `@activepieces/automation-architect`;
- updating `bun.lock`;
- verifying the Phase 2 package independently.

Phase 2 final verification:

- Workflow run: `36017251158`
- frozen filtered install: PASS
- lockfile stability: PASS
- build: PASS
- lint: PASS
- tests: **18/18 PASS**

## Verification

Phase 3 final verification:

- Workflow: `Planner Verification`
- Run ID: `36017252147`
- Verified code/package head: `e287ca0ad1f1f726664522a00132f92c6a7e0f0a`
- filtered frozen dependency install: PASS
- committed lockfile stability: PASS
- TypeScript build: PASS
- ESLint: PASS
- Vitest: PASS
  - 2 test files passed
  - **33 tests passed**
  - 0 failed

The commits after the verified code head in this phase are documentation/state-only.

Temporary fork-only verification workflows were removed after the successful runs.

## Decisions

1. **The model proposes; deterministic code decides whether the plan is acceptable.**
2. **The original human goal is authoritative.** A model cannot silently rewrite the objective.
3. **Capability IDs are catalog-authoritative.** The planner cannot invent tools.
4. **Capability risk is catalog-authoritative for ACTION/NOTIFICATION capabilities.** Model risk labels are not trusted.
5. **Risk metadata is not authorization.** Policy remains a separate deterministic contract.
6. **A READY plan is not permission to execute.** It can still contain approval-required diagnostics.
7. **Missing connections produce NEEDS_INPUT rather than fabricated credentials.**
8. **Prefer deterministic conditions over AI decisions when an exact rule is sufficient.**
9. **The planner remains provider-neutral.** Activepieces discovery/runtime details stay outside this package.
10. **No browser automation yet.**
11. **No live paid-model dependency in core tests.** Planner behavior is tested with mocked model output.
12. **No execution/publishing until capability grounding and compilation are connected to real Activepieces surfaces.**
13. **Coding-project supervision remains the first real vertical after the general pipeline is safe enough.**

## Risks / open boundaries

- The Phase 3 catalog is supplied by the caller; it is not yet populated from real Activepieces pieces.
- Capability parameter/input schemas are not yet provider-neutral planner contracts. The runtime adapter must resolve real required fields before compilation.
- IR reference validation does not yet prove dominance/execution-order correctness across every branch path.
- Natural-language schedules still need deterministic normalization/validation before becoming real schedule triggers.
- Approval-required diagnostics are informational at planner stage; execution policy must enforce them later.
- The planner model interface exists, but no production model-provider adapter is wired yet.
- Activepieces upstream changes quickly, so server integration should remain narrow and additive.

## Next phase

**Phase 4A — Activepieces Capability Discovery Adapter**

Goal: replace manually supplied capability catalogs with real, project-scoped Activepieces capability metadata while keeping the planner core provider-neutral.

Smallest useful scope:

1. add a server-side Automation Architect module outside Enterprise-licensed paths;
2. adapt `toolSearchService.searchActions/searchTriggers` into planner capability candidates;
3. resolve selected candidates through `pieceMetadataService`;
4. map real project connection availability into the provider-neutral capability contract;
5. derive authoritative risk defaults/metadata without trusting an LLM;
6. expose a narrow service that returns planner-ready capabilities;
7. add focused unit/integration tests around:
   - visibility filtering;
   - missing connections;
   - trigger/action kind mapping;
   - unknown piece/action handling;
   - no invented capabilities.

Do **not** compile or create Activepieces flows in Phase 4A.

After Phase 4A, proceed to **Phase 4B — Activepieces IR Compiler**, converting validated IR into typed `CreateFlowRequest` / `FlowOperationRequest[]` while keeping generated flows draft + disabled.

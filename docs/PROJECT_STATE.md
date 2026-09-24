# PROJECT_STATE

## Objective

Build an **Automation Architect** layer on top of the Activepieces Community Edition runtime: users describe a real-world problem in natural language, the system designs a safe automation, selects real available capabilities, separates deterministic logic from AI reasoning, applies approval/risk rules, compiles the plan into Activepieces, validates it, and supervises execution.

## Repository

- Fork: `SanamRai001/activepieces`
- Upstream: `activepieces/activepieces`
- Default branch: `main`
- Foundation branch: `feat/automation-architect-foundation`
- Phase 2 branch: `feat/automation-ir`
- Phase 3 branch: `feat/natural-language-planner-phase3`
- Working branch: `feat/activepieces-capability-discovery`
- Fork baseline inspected: `17e2ac0b01797f8472e781122a396c5d07acc974`
- Foundation PR: #1
- Phase 2 PR: #2
- Phase 3 PR: #4 (clean replacement; #3 superseded)
- Phase 4A PR: #5

## Completed phase

**Phase 4A — Activepieces Capability Discovery Adapter**

### Changes

- Added a server-side Automation Architect capability discovery module under:
  - `packages/server/api/src/app/automation-architect/`
- Kept the implementation outside Activepieces Enterprise-licensed paths.
- Split the implementation into:
  - a **pure provider adapter** in `capability-discovery.ts`;
  - thin **Activepieces server wiring** in `capability-discovery.service.ts`.
- Added `@activepieces/automation-architect` as an API workspace dependency.
- Added the Automation Architect source alias to API Vitest configuration.
- Connected real Activepieces discovery surfaces:
  - `toolSearchService.searchActions(...)`;
  - `toolSearchService.searchTriggers(...)`.
- Re-verifies every search candidate through project-scoped:
  - `pieceMetadataService.get({ name, platformId, projectId })`.
- This deliberately avoids treating search-index results as sufficient proof that a capability is still visible/available.
- Added authoritative project connection-state lookup using:
  - `appConnectionService.listConnectedPieces(...)`.
- Connection state is resolved independently from search-result `connected` hints because keyword fallback does not reliably populate those hints.
- If connection-state lookup fails:
  - discovery continues;
  - authenticated capabilities are treated as unavailable;
  - `CONNECTION_STATUS_UNAVAILABLE` is returned.
- Added stable planner-facing capability IDs:
  - `activepieces:trigger:<pieceName>:<triggerName>`;
  - `activepieces:action:<pieceName>:<actionName>`.
- Added deterministic action-risk mapping from Activepieces `classification`:
  - `READ` → `READ_ONLY`;
  - `SEARCH` → `READ_ONLY`;
  - `WRITE` → `SENSITIVE_MUTATION`;
  - `DESTRUCTIVE` → `DESTRUCTIVE`;
  - missing/unknown → `SENSITIVE_MUTATION`.
- `WRITE` and unclassified actions are intentionally conservative and cannot be downgraded by an LLM.
- Added stale-index handling:
  - missing/hidden piece → candidate discarded;
  - missing action/trigger → candidate discarded;
  - structured issue returned instead of fabricating capability metadata.
- Added keyword-fallback diagnostics without rejecting usable keyword matches.
- Added query trimming and result-limit clamping.
- Added per-piece metadata lookup caching and capability deduplication.
- Added `docs/AUTOMATION_ARCHITECT_CAPABILITY_DISCOVERY.md`.
- Added focused unit coverage for the pure adapter.
- No flow creation, mutation, execution, publishing, activation, or side effect was added.

## Verification

### Final Phase 4A verification

- Workflow: `Capability Discovery Verification`
- Run ID: `36023588151`
- Verified code/CI head: `5675c91805c6ce65256afa4246926b439d8e95b9`
- Repository install with committed lockfile: **PASS**
- API build through Turborepo workspace dependency graph: **PASS**
  - 17 build tasks successful
  - includes `@activepieces/automation-architect`
  - includes final `api:build`
- Focused ESLint: **PASS**
  - 0 errors
  - 3 existing-rule warnings for explicit return types
- Focused Vitest: **PASS**
  - 1 test file passed
  - **17 tests passed**
  - 0 failed

The temporary fork-only verification workflow was removed after the successful run.

Commits after the verified code/CI head are documentation/temporary-CI cleanup only.

### Verification lessons

Earlier verification attempts exposed verifier/environment problems rather than production-code failures:

- filtered workspace installation omitted dependencies needed for a full API build;
- standalone `tsc` bypassed the monorepo dependency build graph;
- an isolated ESLint sandbox omitted Activepieces ESLint plugins;
- typed API lint exceeded Node's default heap.

Final verification therefore uses:

```text
bun install --frozen-lockfile
    ↓
turbo run build --filter=api
    ↓
repository-pinned typed ESLint
    ↓
focused adapter Vitest
```

This is the correct validation path for this integration.

## Decisions

1. **Planner core remains provider-neutral.** Activepieces-specific discovery stays in the server adapter.
2. **Search results are candidates, not authority.** Project-scoped piece metadata must confirm each component.
3. **Project visibility is preserved explicitly.** Metadata resolution passes `projectId`.
4. **Connection state is authoritative from the project connection service**, not from semantic/keyword search result hints.
5. **Connection lookup fails closed for availability.** The system asks for connection setup rather than assuming credentials exist.
6. **Action risk is deterministic.** Activepieces classification is used before any LLM judgment.
7. **Unknown/write risk is conservative.** Generic writes are `SENSITIVE_MUTATION` until a deterministic narrower classifier exists.
8. **No LLM may lower catalog risk.**
9. **Keyword fallback is acceptable but observable.** It produces a degradation issue.
10. **Stale/hidden components are dropped rather than exposed to the planner.**
11. **Pure adapter logic is separated from server wiring** to keep unit tests fast and architecture boundaries clear.
12. **Phase 4A remains read-only.** No flow is created or executed.
13. **No new public HTTP route yet.** The service remains an internal server capability until the planner/compiler lifecycle stabilizes.
14. **Browser automation remains out of MVP scope.**

## Risks / open boundaries

- Capability discovery currently returns identity, description, connection state and risk, but not the full action/trigger input-property schema.
- Dynamic Activepieces properties may depend on auth, project context, or other input values and need a separate schema-resolution step before compilation.
- `WRITE` is intentionally broad; later deterministic classifiers may safely narrow some actions to:
  - `REVERSIBLE_WRITE`;
  - `EXTERNAL_COMMUNICATION`;
  - `FINANCIAL`.
- Stable capability IDs currently encode piece/component names; Phase 4B must parse them strictly and re-resolve metadata before compilation.
- IR references still lack full control-flow dominance validation.
- Schedule normalization remains unresolved.
- Approval-required planner diagnostics are not yet runtime-enforced because runtime compilation/activation does not exist yet.
- No production model-provider adapter is wired yet.
- Activepieces upstream changes quickly, so server integration must remain narrow and additive.

## Next phase

**Phase 4B — Activepieces IR Compiler**

Goal: turn validated, grounded Automation IR into a real **draft + disabled Activepieces flow** through existing typed flow services and operations.

Smallest useful scope:

1. define strict parsing for Activepieces capability IDs;
2. re-resolve each referenced piece/action/trigger through project-scoped metadata;
3. resolve exact piece versions;
4. map IR trigger/action/condition constructs into:
   - `CreateFlowRequest`;
   - `FlowOperationRequest[]`;
5. use existing Activepieces flow lifecycle:
   - `flowService.create(...)`;
   - `flowService.update(...)`;
   - `flowVersionService.applyOperation(...)`;
6. preserve existing Activepieces operation validation;
7. keep generated flows:
   - **draft**;
   - **disabled**;
8. report explicit compiler outcomes:
   - complete draft;
   - partial draft;
   - failed cleanly;
   - failed with artifact;
9. add focused tests for:
   - unknown/stale capability IDs;
   - trigger/action mapping;
   - deterministic conditions;
   - connection requirements;
   - partial failure behavior;
   - never-publish guarantees.

Do **not** add automatic publishing/activation in Phase 4B.

After Phase 4B, proceed to validation/simulation before any activation path.

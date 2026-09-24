# PROJECT_STATE

## Objective

Build an **Automation Architect** layer on top of the Activepieces Community Edition runtime: users describe a real-world problem in natural language, the system designs a safe automation, selects available capabilities, separates deterministic logic from AI reasoning, applies approval/risk rules, compiles the plan into Activepieces, validates it, and supervises execution.

## Repository

- Fork: `SanamRai001/activepieces`
- Upstream: `activepieces/activepieces`
- Default branch: `main`
- Working branch: `feat/automation-architect-foundation`
- Fork baseline inspected: `17e2ac0b01797f8472e781122a396c5d07acc974`

## Completed phase

**Phase 1 — Runtime Integration Map**

### Changes

- Completed Phase 0 foundation inspection and product-boundary documentation.
- Added `docs/AUTOMATION_ARCHITECT_INTEGRATION_MAP.md`.
- Traced Activepieces' typed flow model in `@activepieces/core-execution`.
- Confirmed `FlowOperationRequest` is the canonical mutation contract used by the web/API/server stack.
- Traced flow creation and update through:
  - `flowService.create/update`;
  - `flowVersionService.applyOperation`;
  - `flowVersionValidationUtil.prepareRequest`;
  - `flowOperations.apply`.
- Confirmed generated flows can remain normal Activepieces drafts and inherit existing versioning/validation.
- Identified capability discovery surfaces:
  - `toolSearchService.searchActions/searchTriggers`;
  - `pieceMetadataService`;
  - connection metadata;
  - MCP piece-property/schema resolution as a reference implementation.
- Audited existing AI-facing flow-builder tools including:
  - `ap_build_flow`;
  - `ap_create_flow`;
  - `ap_update_trigger`;
  - `ap_add_step`;
  - `ap_add_branch`;
  - `ap_validate_step_config`;
  - `ap_validate_flow`;
  - `ap_test_flow`.
- Confirmed Activepieces can already build many flows through MCP, so Automation Architect must differentiate through explicit process understanding, provider-neutral IR, safety/policy analysis, explainability and supervised lifecycle—not merely LLM tool calling.
- Chosen compiler direction: compile Automation IR into typed Activepieces flow operations instead of writing raw FlowVersion/database records or parsing MCP text.
- Identified two reusable behaviors currently living under MCP paths that should be extracted rather than duplicated later:
  - structural flow validation;
  - flow-test orchestration.

## Verification

- Integration map was derived from current fork source, not documentation assumptions.
- Flow model and operation schemas were inspected from `packages/core/execution`.
- Server mutation path was verified through the flow and flow-version services.
- Piece/tool discovery paths were verified from the current server implementation.
- MCP builder, validation and test-tool implementations were inspected directly.
- No runtime/source behavior changed in Phase 1; only documentation was added/updated, so build/test execution is not required for this phase.
- The integration-map document must be re-read from the branch before Phase 1 is closed.

## Decisions

1. **Do not rebuild Activepieces.** Treat it as the initial execution/runtime and integration layer.
2. **Do not put Automation Architect logic in Enterprise-licensed paths.**
3. **Keep planner logic provider-neutral.** Activepieces-specific structures belong behind a compiler/adapter.
4. **Prefer deterministic automation over AI when normal rules are sufficient.**
5. **Risk/approval policy is separate from the LLM planner.** The planner cannot grant itself permission for high-impact actions.
6. **Browser/ChatGPT automation is not the MVP.** It can become an optional adapter after the core supervisor works.
7. **Coding-project supervision is the first vertical** because its requirements are already well understood and exercise state, verification, retries, escalation and notifications.
8. **No rebrand yet.** "Automation Architect" is a working name until the architecture is proven.
9. **Minimize upstream merge conflicts.** Prefer additive modules, narrow integration points and minimal modifications to existing Activepieces internals.

## Risks

- Activepieces upstream is changing quickly, including agent and AI-routing functionality.
- The fork is large; careless cross-cutting modifications would make upstream synchronization expensive.
- Generated workflows can create unsafe side effects if retries/idempotency/approval rules are weak.
- LLM-produced plans can invent nonexistent capabilities unless capability discovery is authoritative.
- Activepieces flow internals may already expose APIs/tools that make a custom compiler much smaller than currently assumed; Phase 1 must verify this before coding.
- Enterprise-licensed directories exist in the same monorepo and must not be treated as MIT code.

## Next phase

**Phase 2 — Automation IR**

Implement the first provider-neutral, versioned TypeScript schema for automation plans.

Initial supported concepts:

1. trigger:
   - manual;
   - schedule;
   - webhook/event capability;
2. action;
3. deterministic condition;
4. AI decision;
5. approval gate;
6. notification;
7. references between step outputs and later inputs;
8. explicit policy/risk metadata.

Constraints:

- no server services or Activepieces-specific flow operations inside the IR package;
- use Zod schemas plus inferred TypeScript types;
- include focused unit tests;
- keep the first schema deliberately small;
- define versioning/migration expectations before adding compiler code.

Deliverable: a standalone, tested Automation IR core package that Phase 3 can use as the planner output contract.

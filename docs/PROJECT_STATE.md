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

**Phase 0 — Foundation**

### Changes

- Audited the fork structure and current build scripts.
- Confirmed the repo uses a Bun/Turborepo TypeScript monorepo.
- Confirmed existing Activepieces capabilities already cover:
  - flows;
  - loops/branches/retries;
  - agents;
  - piece tools;
  - flow tools;
  - MCP tools;
  - human-in-the-loop primitives;
  - AI routing;
  - execution workers and a visual builder.
- Confirmed license boundary:
  - Community Edition code is generally MIT;
  - `packages/ee/` is Enterprise-licensed;
  - `packages/server/api/src/app/ee` is Enterprise-licensed.
- Added `docs/AUTOMATION_ARCHITECT.md` defining:
  - product problem and differentiation;
  - architecture boundary;
  - Automation IR;
  - planner;
  - capability discovery;
  - risk/approval engine;
  - Activepieces compiler;
  - validator/simulator;
  - runtime supervisor;
  - coding-project supervision as the first vertical;
  - phased implementation roadmap;
  - upstream-sync strategy.

## Verification

- Fork metadata verified through GitHub.
- Push/admin permission verified.
- `main` baseline verified at `17e2ac0b01797f8472e781122a396c5d07acc974`.
- Foundation branch created successfully.
- Documentation-only phase: no runtime/source code changed, so build/test execution is not required for Phase 0.
- Branch documentation was re-read after creation and matches the intended Phase 0 scope.
- Phase 0 is closed; no runtime/source behavior was changed.

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

**Phase 1 — Runtime integration map**

Inspect and document the smallest stable Activepieces surfaces needed to turn Automation IR into a draft flow:

1. flow schema/types;
2. flow create/update lifecycle;
3. piece/action/trigger metadata discovery;
4. existing flow validation;
5. MCP flow-building tools;
6. execution/dry-run entry points;
7. server/web boundaries that can be reused without invasive changes.

Deliverable: an integration map plus recommended extension points. Avoid feature implementation until that map is complete.

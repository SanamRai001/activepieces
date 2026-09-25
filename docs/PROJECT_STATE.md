# PROJECT_STATE

## Objective

Build an **Automation Architect** layer on top of the Activepieces Community Edition runtime:

```text
human automation problem
→ natural-language planner
→ grounded Automation IR
→ deterministic policy/safety
→ real Activepieces capabilities
→ safe draft compiler
→ validation/simulation
→ later approval-controlled activation
```

The system must prefer deterministic behavior where possible, keep model output non-authoritative for safety-sensitive facts, and preserve human control over high-impact actions.

## Repository

- Fork: `SanamRai001/activepieces`
- Upstream: `activepieces/activepieces`
- Default branch: `main`
- Foundation branch: `feat/automation-architect-foundation`
- Phase 2 branch: `feat/automation-ir`
- Phase 3 branch: `feat/natural-language-planner-phase3`
- Phase 4A branch: `feat/activepieces-capability-discovery`
- Working branch: `feat/activepieces-ir-compiler`
- Fork baseline originally inspected: `17e2ac0b01797f8472e781122a396c5d07acc974`

### Pull requests

- Foundation: PR #1
- Automation IR: PR #2
- Natural-language planner: PR #4
  - PR #3 is superseded/closed
- Capability discovery: PR #5
- IR compiler: PR #6

## Completed phase

**Phase 4B — Activepieces IR Compiler**

Phase 4B converts grounded Automation IR into a real Activepieces flow artifact while enforcing a strict boundary:

> Automation Architect may create a draft. It may not publish or enable the draft.

## Phase 4B architecture

```text
validated Automation IR
        ↓
strict Activepieces capability IDs
        ↓
project-scoped piece/component re-resolution
        ↓
exact piece versions
        ↓
input/auth/reference preflight
        ↓
typed Activepieces graph
        ↓
CreateFlowRequest
        ↓
UPDATE_TRIGGER + ADD_ACTION operations
        ↓
flowService.update(...)
        ↓
Activepieces native prepareRequest validation
        ↓
DISABLED + unpublished draft
```

## Changes

### Strict capability identity

Compiler accepts only:

```text
activepieces:trigger:<pieceName>:<triggerName>
activepieces:action:<pieceName>:<actionName>
```

It rejects malformed IDs and action/trigger kind mismatches.

### Project-scoped capability re-resolution

Every referenced piece is fetched again using current:

- `platformId`;
- `projectId`.

The compiler does not trust capability metadata captured during an earlier planning phase.

It rejects:

- pieces no longer visible;
- removed actions/triggers;
- stale capability IDs.

### Exact versions

Current visible piece metadata is resolved at compile time and its exact version is embedded in generated settings.

Activepieces' normal operation-preparation path still performs its own version normalization.

### Explicit connection bindings

Authenticated capabilities require an explicit binding:

```ts
{
  "activepieces:action:@activepieces/piece-github:add_label": "github-main"
}
```

The compiler:

- never chooses a connection implicitly;
- rejects missing bindings;
- rejects unsafe external IDs;
- verifies the external ID belongs to an **active connection in the current project for the same piece**;
- rejects stale/missing/mismatched bindings with `CONNECTION_BINDING_NOT_FOUND_OR_MISMATCHED`;
- injects Activepieces connection expressions deterministically.

### Input preflight

Before creating a flow, deterministic compiler checks reject:

- unknown top-level input properties;
- missing required top-level properties;
- stale pieces/components;
- missing auth bindings;
- unsafe auth identifiers.

Dynamic/deep runtime validation remains Activepieces' responsibility.

### Schedule triggers

`SCHEDULE` is compiled through:

```text
@activepieces/piece-schedule
→ cron_expression
```

with:

- `cronExpression`;
- `timezone` (default `UTC`).

The schedule piece itself is project-scoped and version-resolved rather than version-hardcoded.

### Event triggers

`EVENT` is compiled from a grounded trigger capability ID.

### Manual triggers

`MANUAL` compiles through:

```text
@activepieces/piece-manual-trigger
→ manual_trigger
```

The piece is project-scoped and version-resolved.

Because the manual trigger has no runtime payload, any step that references manual-trigger output is rejected with `UNSUPPORTED_REFERENCE_SOURCE`.

### Piece actions and notifications

- `ACTION` → Activepieces PIECE action.
- `NOTIFICATION` → Activepieces PIECE action.

### Deterministic conditions

`CONDITION` lowers to an Activepieces ROUTER:

- branch 0: CONDITION;
- branch 1: FALLBACK;
- execution: first match.

Only semantically exact mappings are allowed.

Supported mappings include:

- equals;
- supported not-equals cases;
- greater-than;
- less-than;
- contains / not-contains;
- exists / not-exists;
- true / false.

Unsupported exactness cases fail explicitly, including:

- greater-than-or-equal;
- less-than-or-equal;
- numeric not-equals.

Compiled branch conditions are parsed through Activepieces' own `BranchCondition` schema.

### AI and approvals

Phase 4B deliberately rejects:

- `AI_DECISION`;
- `APPROVAL_GATE`.

Dedicated runtime semantics are required before these can be safely compiled.

### Tree-shaped branching

Phase 4B supports tree-shaped control flow.

It rejects shared downstream steps / branch joins with:

```text
UNSUPPORTED_SHARED_STEP
```

This avoids copying a shared step and silently changing its execution/reference semantics.

### Reference rewriting

IR references compile to Activepieces expressions such as:

```text
{{trigger['output']['id']}}
{{aa_step_001['output']['record']['id']}}
```

Compiler-generated step names are deterministic:

```text
aa_step_001
aa_step_002
...
```

String path segments are escaped before interpolation.

### Reference dominance safety

A reference to an existing step is not automatically safe.

Phase 4B verifies that referenced producer steps dominate the consumer.

Cross-branch/sibling references that may not have executed are rejected with:

```text
NON_DOMINATING_REFERENCE
```

### Draft materialization outcomes

Materializer returns:

```text
COMPLETE_DRAFT
PARTIAL_DRAFT
FAILED_CLEANLY
FAILED_WITH_ARTIFACT
```

#### COMPLETE_DRAFT

- persistent flow exists;
- all compiler operations applied;
- flow remains disabled;
- no published version exists;
- Activepieces marks the current version valid.

#### PARTIAL_DRAFT

- persistent safe draft exists;
- no publication/activation occurred;
- Activepieces reports one or more invalid steps;
- invalid step names are returned for diagnosis.

#### FAILED_CLEANLY

No persistent artifact exists.

Examples:

- compiler preflight failed;
- unsupported IR;
- flow creation failed before artifact creation.

#### FAILED_WITH_ARTIFACT

A draft was created but a later operation/safety check failed.

The flow ID is returned for inspection/recovery.

## Critical audit fix: removed IMPORT_FLOW validation bypass

An audit during Phase 4B found a material issue in the initial compiler implementation.

### Initial approach

The compiler generated one:

```text
IMPORT_FLOW
```

operation containing the complete tree.

### Problem

Activepieces' `flowVersionValidationUtil.prepareRequest(...)` performs detailed validation for normal:

- `UPDATE_TRIGGER`;
- `ADD_ACTION`;
- `UPDATE_ACTION`;
- router operations.

For `IMPORT_FLOW`, the outer preparation primarily validates safe imported step names.

The import implementation then expands the tree internally into trigger/action mutations inside `flowOperations.apply(...)`.

Those internally expanded operations do not independently pass through `prepareRequest(...)`.

Therefore, a bulk `IMPORT_FLOW` path could bypass the normal per-piece/per-router validation that Automation Architect explicitly intended to preserve.

### Final approach

The compiler now emits:

```text
UPDATE_TRIGGER
ADD_ACTION
ADD_ACTION
...
```

Every generated operation is applied independently through `flowService.update(...)`.

That restores the normal Activepieces validation chain:

```text
flowService.update
→ flowVersionService.applyOperation
→ flowVersionValidationUtil.prepareRequest
→ flowOperations.apply
```

The trigger update contains no nested `nextAction`.

Router branch children are emitted separately with:

```text
StepLocationRelativeToParent.INSIDE_BRANCH
branchIndex = N
```

Linear continuation uses:

```text
StepLocationRelativeToParent.AFTER
```

Regression tests explicitly assert that Automation Architect does **not** emit `IMPORT_FLOW`.

## Hard safety invariants

Compiler/materializer does not permit:

- `LOCK_AND_PUBLISH`;
- `CHANGE_STATUS`.

After all operations it verifies:

```text
flow.status === DISABLED
publishedVersionId === null
```

Violation returns:

```text
SAFETY_INVARIANT_VIOLATION
```

There is no activation API in Phase 4B.

## Verification

### Final Phase 4B verification

- Workflow: `IR Compiler Verification`
- Run ID: `36152686107`
- Verified implementation head: `0a6dec42fbcd27f9901890586bb59c1ad1158105`
- Repository install with frozen lockfile: **PASS**
- API build through Turborepo dependency graph: **PASS**
  - **17/17 build tasks successful**
- Focused typed ESLint: **PASS**
  - 0 errors
  - 5 non-blocking explicit-return-type warnings
- Focused Vitest: **PASS**
  - 2 test files passed
  - **36 tests passed**
  - 0 failed

The final verified set contains:

- **19 IR compiler tests**;
- **17 capability discovery adapter tests**.

The latest coverage includes:

- safe manual-trigger compilation;
- rejection of manual-trigger output references;
- validation that a connection binding is active, project-scoped, and belongs to the expected piece.

The temporary fork-only IR compiler verification workflow was removed after the green run.

Commits after the verified implementation head are documentation / temporary-CI cleanup only.

## Previous completed phases

### Phase 0–1

- product/architecture foundation;
- license boundaries;
- Activepieces runtime integration map.

### Phase 2

Provider-neutral `@activepieces/automation-architect` Automation IR V1.

Final package verification:

- build PASS;
- lint PASS;
- **18/18 tests PASS**.

### Phase 3

Grounded natural-language planner:

- model proposes;
- deterministic code validates;
- capability IDs cannot be invented;
- user goal remains authoritative;
- risk/policy is deterministic;
- missing connections cause intervention.

Final verification:

- build PASS;
- lint PASS;
- **33/33 tests PASS**.

### Phase 4A

Project-scoped Activepieces capability discovery:

- tool search;
- metadata re-resolution;
- authoritative connection-state lookup;
- conservative deterministic risk mapping;
- stale-index protection.

Final verification:

- API build PASS;
- lint PASS;
- **17/17 focused tests PASS**.

## Decisions

1. **Activepieces remains the runtime; Automation Architect remains the intelligence/safety layer.**
2. **Planner core remains provider-neutral.**
3. **The model proposes; deterministic code decides whether output is acceptable.**
4. **User intent remains authoritative.**
5. **Capabilities are re-resolved at compile time.**
6. **Connection choice is explicit, never guessed.**
7. **Runtime-specific metadata stays behind server adapters.**
8. **Compiler fails rather than approximating unsupported semantics.**
9. **Cross-branch references require guaranteed execution/dominance.**
10. **Branch joins are not silently lowered.**
11. **Every generated runtime step must pass normal Activepieces validation.**
12. **Generated artifacts remain draft + disabled.**
13. **Publishing/activation is outside Phase 4B.**
14. **Browser/ChatGPT automation remains outside the core MVP path.**

## Risks / open boundaries

- Dynamic properties are not yet fully resolved before draft creation.
- A draft can legitimately become `PARTIAL_DRAFT` when Activepieces runtime validation finds missing/dynamic configuration.
- No structural validation summary service has yet been applied after compilation.
- No safe draft execution/simulation layer exists yet.
- Test-flow execution must distinguish:
  - real trigger evidence;
  - mock/sample trigger data.
- AI decisions and approval gates still need explicit runtime semantics.
- Manual-trigger flows cannot reference trigger payload because the built-in manual trigger carries no data.
- Branch joins need an IR/runtime contract before support.
- Schedule natural-language normalization remains a planner concern.
- No production model-provider adapter is wired yet.
- No activation policy/enforcement path exists yet.
- Activepieces upstream changes rapidly; integrations should remain additive and narrow.

## Next phase

**Phase 5 — Draft Validation & Simulation**

Goal: prove a generated draft is structurally valid and safely testable **before** any activation workflow exists.

### Phase 5A — Structural validation service

Extract/reuse the behavior currently behind Activepieces' MCP `ap_validate_flow` tooling into a reusable CE server service.

Validate at least:

- configured trigger;
- invalid steps;
- broken references;
- forward/later-step references where unsafe;
- empty router branches;
- connection/configuration issues that can be determined statically.

Automation Architect should call the same reusable validator rather than copy validation logic.

### Phase 5B — Safe test/simulation service

Extract/reuse flow-test orchestration currently used by MCP tooling.

Requirements:

- run the **draft**, never published state;
- do not enable/publish the flow;
- report terminal run state;
- return failed step information;
- distinguish mock/sample trigger data from real trigger evidence;
- enforce test timeout;
- surface unsupported triggers/interactions cleanly;
- preserve tenant/project scoping.

### Expected Phase 5 result

```text
Automation IR
    ↓
draft compiler
    ↓
DISABLED draft
    ↓
structural validation
    ↓
safe test/simulation
    ↓
VALIDATED_DRAFT / NEEDS_CONFIGURATION / TEST_FAILED
```

Do **not** add automatic activation/publishing in Phase 5.

# Automation Architect — Activepieces IR Compiler

## Purpose

Phase 4B turns a **validated and capability-grounded Automation IR V1** document into a real Activepieces flow artifact while preserving a hard safety boundary:

> The compiler may create a draft. It may not publish or activate that draft.

## Pipeline

```text
validated Automation IR
        |
        v
strict capability-id parsing
        |
        v
project-scoped piece/component re-resolution
        |
        v
exact piece versions + input/auth preflight
        |
        v
typed Activepieces trigger/action graph
        |
        v
CreateFlowRequest
        |
        v
UPDATE_TRIGGER + ADD_ACTION operations
        |
        v
Activepieces prepareRequest validation
for every generated trigger/action/router
        |
        v
DISABLED + unpublished draft
```

## Why per-step flow operations

The compiler originally used one `IMPORT_FLOW` operation.

Source audit found that this was not strong enough for Automation Architect's safety model:

- `flowVersionValidationUtil.prepareRequest(...)` validates normal `UPDATE_TRIGGER` and `ADD_ACTION` operations;
- for `IMPORT_FLOW`, the outer validation checks imported step names;
- the import operation later expands the tree internally into trigger/action operations;
- those nested operations do not independently pass back through `prepareRequest(...)`.

That could bypass Activepieces' normal per-piece and router validation for generated steps.

Phase 4B therefore deliberately emits:

```text
UPDATE_TRIGGER
ADD_ACTION
ADD_ACTION
...
```

rather than `IMPORT_FLOW`.

This means each generated step is applied through `flowService.update(...)`, preserving the existing Activepieces validation lifecycle:

```text
flowService.update
        ↓
flowVersionService.applyOperation
        ↓
flowVersionValidationUtil.prepareRequest
        ↓
flowOperations.apply
```

The trigger operation is isolated from nested `nextAction` data. Actions and router children are materialized separately.

Benefits:

- native Activepieces validation runs for every generated piece trigger/action/router;
- exact piece versions are normalized by existing runtime logic;
- invalid piece inputs can produce an inspectable partial draft instead of being hidden inside a bulk import;
- partial failures have an explicit persistent-artifact outcome;
- no custom database mutation path is introduced.

## Supported V1 constructs

### Triggers

#### EVENT

Requires:

```text
activepieces:trigger:<pieceName>:<triggerName>
```

At compilation time the compiler:

1. parses the capability ID strictly;
2. re-resolves the piece in `platformId + projectId` scope;
3. confirms the trigger still exists;
4. embeds the exact currently visible piece version;
5. validates supplied top-level properties;
6. requires an explicit connection binding when auth is required.

#### SCHEDULE

Maps to:

```text
@activepieces/piece-schedule
cron_expression
```

Inputs:

```text
cronExpression
timezone
```

Timezone defaults to `UTC` when the IR omits it.

The schedule piece is re-resolved like any other piece rather than relying on a hard-coded version.

#### MANUAL

Intentionally unsupported in Phase 4B.

There is no dedicated safe manual-trigger mapping in the current compiler contract, so the compiler returns `UNSUPPORTED_TRIGGER` instead of approximating one.

### Steps

- `ACTION` → Activepieces PIECE action.
- `NOTIFICATION` → Activepieces PIECE action.
- `CONDITION` → Activepieces ROUTER with a condition branch and fallback branch.
- `AI_DECISION` → rejected in Phase 4B.
- `APPROVAL_GATE` → rejected in Phase 4B.

AI decisions and approval gates need dedicated runtime semantics. They are not approximated using unrelated step types.

## Capability identity

The compiler accepts only:

```text
activepieces:trigger:<pieceName>:<triggerName>
activepieces:action:<pieceName>:<actionName>
```

Every capability is re-resolved from current project-visible metadata at compile time.

Discovery results from an earlier planning phase are therefore not treated as permanent authority.

The compiler rejects:

- malformed IDs;
- action/trigger kind mismatches;
- pieces no longer visible to the project;
- components removed since planning.

## Exact piece versions

Capability discovery can happen before compilation.

At compile time the compiler reads current project-visible piece metadata again and uses its exact version.

The generated operation then still passes through Activepieces' normal operation preparation/version normalization.

## Connection bindings

Compilation accepts explicit connection bindings:

```ts
{
  "activepieces:action:@activepieces/piece-github:add_label": "github-main"
}
```

For a component with `requireAuth=true`:

- a binding is mandatory;
- the compiler never picks one implicitly;
- unsafe external IDs are rejected;
- the generated input contains:

```text
{{connections['<externalId>']}}
```

This keeps credential selection outside model judgment.

## Input preflight

Before a persistent flow is created, the compiler rejects deterministic problems it can know immediately:

- unknown top-level input property names;
- missing required top-level properties;
- stale/hidden pieces;
- removed actions/triggers;
- missing auth bindings;
- unsafe auth external IDs.

This is intentionally only a preflight layer.

Activepieces' own per-step validation remains authoritative during materialization and can catch deeper schema/type/dynamic-property issues.

## IR references

IR references are rewritten into current Activepieces output expressions.

Examples:

```text
TRIGGER path ["id"]
→ {{trigger['output']['id']}}

STEP "lookup" path ["record", "id"]
→ {{aa_step_002['output']['record']['id']}}
```

Compiler-assigned names are deterministic:

```text
aa_step_001
aa_step_002
...
```

They do not depend on model-generated display names.

String path segments are escaped before being inserted into expressions.

## Reference dominance safety

IR V1 already rejects unknown and self-references, but graph existence is not enough.

A step may only read another step's output when that producer is guaranteed to have executed before the consumer.

Phase 4B therefore rejects non-dominating references, including sibling/cross-branch references.

Example rejected shape:

```text
         condition
        /         \
   true_step    false_step
       |            |
       |       references true_step  ← unsafe
```

This returns `NON_DOMINATING_REFERENCE`.

## Tree-shaped control flow

Automation IR V1 permits a DAG, but the first compiler supports tree-shaped branching only.

A downstream step may have at most one incoming control-flow edge.

Branch joins/shared downstream steps are rejected with:

```text
UNSUPPORTED_SHARED_STEP
```

This avoids duplicating a shared step or changing its output/reference semantics.

Explicit join lowering can be introduced later once join semantics are represented by the IR.

## Deterministic conditions

`CONDITION` becomes an Activepieces ROUTER using `EXECUTE_FIRST_MATCH`:

```text
True branch     → CONDITION
False branch    → FALLBACK
```

Supported exact mappings include:

- `EQUALS`;
- `NOT_EQUALS` where a faithful Activepieces operator exists;
- `GREATER_THAN`;
- `LESS_THAN`;
- `CONTAINS`;
- `NOT_CONTAINS`;
- `EXISTS`;
- `NOT_EXISTS`;
- `IS_TRUE`;
- `IS_FALSE`.

The generated branch condition is parsed with Activepieces' own `BranchCondition` schema before it is emitted.

The compiler intentionally rejects semantics that have no exact single Activepieces equivalent, including:

- `GREATER_THAN_OR_EQUAL`;
- `LESS_THAN_OR_EQUAL`;
- numeric `NOT_EQUALS`.

It does not weaken them into approximate rules.

## Operation lowering

The compiler first constructs a typed in-memory graph.

It then lowers that graph into operations.

### Trigger

Exactly one:

```text
UPDATE_TRIGGER
```

The request intentionally has no nested `nextAction`.

### Linear action

```text
ADD_ACTION
parent = previous step
location = AFTER
```

### Router

The router itself is added with `ADD_ACTION`.

Each non-empty branch child is then emitted independently:

```text
ADD_ACTION
parent = router step
location = INSIDE_BRANCH
branchIndex = N
```

Subsequent linear actions inside that branch are emitted using `AFTER`.

This operation sequence allows Activepieces to validate every step independently.

## Materialization

The runtime service performs:

```text
compile/preflight
      ↓
flowService.create
      ↓
UPDATE_TRIGGER
      ↓
ADD_ACTION ...
      ↓
final safety + validity checks
```

`flowService.create(...)` already creates:

```text
status = DISABLED
publishedVersionId = null
```

Every generated operation is checked before application.

The materializer explicitly forbids:

- `LOCK_AND_PUBLISH`;
- `CHANGE_STATUS`.

## Outcomes

The materializer returns one of:

```text
COMPLETE_DRAFT
PARTIAL_DRAFT
FAILED_CLEANLY
FAILED_WITH_ARTIFACT
```

### COMPLETE_DRAFT

- draft was created;
- all operations were applied;
- flow remains disabled;
- no published version exists;
- Activepieces considers the resulting version valid.

### PARTIAL_DRAFT

- a safe draft exists;
- flow remains disabled/unpublished;
- one or more generated steps remain invalid according to Activepieces.

The invalid step names are returned for diagnosis.

### FAILED_CLEANLY

No persistent flow artifact exists.

Typical examples:

- invalid IR;
- unsupported construct;
- stale capability;
- missing required binding;
- flow creation failure before persistence completes.

### FAILED_WITH_ARTIFACT

A flow was created but a later operation or safety check failed.

The flow ID is returned so the incomplete draft can be inspected/recovered instead of silently discarded.

## Hard safety invariant

After materialization:

```text
flow.status === DISABLED
publishedVersionId === null
```

If either condition is false, the compiler returns `SAFETY_INVARIANT_VIOLATION`.

Phase 4B contains no activation or publish API.

## Verification

Final Phase 4B verification:

- workflow: `IR Compiler Verification`;
- run: `36033591834`;
- verified implementation head: `3551ec2ba83308a6827445db7d384a4a068a6bea`;
- repository install with frozen lockfile: PASS;
- API build through Turborepo: PASS;
  - 17/17 build tasks successful;
- focused typed ESLint: PASS;
  - 0 errors;
  - 5 non-blocking explicit-return-type warnings;
- focused Vitest: PASS;
  - 2 test files passed;
  - 33 tests passed;
  - 0 failed.

The temporary fork-only verification workflow was removed after the green run.

## Non-goals

Phase 4B does not:

- publish a flow;
- enable a flow;
- execute/test a flow;
- resolve dynamic dropdown/property values;
- compile AI decisions;
- compile approval gates;
- compile manual triggers;
- support branch joins;
- expose a public compiler HTTP endpoint.

## Next phase

Phase 5 should validate and simulate the generated draft before any activation workflow is designed.

That phase should reuse/extract Activepieces' existing structural validation and test-flow behavior rather than inventing another execution engine.

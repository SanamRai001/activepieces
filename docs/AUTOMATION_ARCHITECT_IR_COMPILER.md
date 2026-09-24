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
exact piece versions + input/auth validation
        |
        v
typed Activepieces FlowTrigger tree
        |
        v
CreateFlowRequest
        |
        v
IMPORT_FLOW FlowOperationRequest
        |
        v
DISABLED + unpublished draft
```

## Why IMPORT_FLOW

The Activepieces operation engine already supports importing a typed flow tree. Phase 4B therefore compiles the whole IR first and applies one existing `IMPORT_FLOW` operation instead of incrementally mutating a new flow step-by-step.

Benefits:

- unsupported IR fails **before** an artifact is created;
- fewer partial mutations;
- Activepieces' existing Zod schemas still validate the generated structure;
- the operation is explicitly non-publishing;
- a runtime failure after flow creation has a clear `FAILED_WITH_ARTIFACT` outcome.

## Supported V1 constructs

### Triggers

- `EVENT`
  - requires an `activepieces:trigger:<piece>:<trigger>` capability id;
  - piece/component is re-resolved with `projectId` + `platformId`;
  - exact current visible piece version is embedded.
- `SCHEDULE`
  - maps to `@activepieces/piece-schedule` / `cron_expression`;
  - uses the IR cron string and timezone (default `UTC`).
- `MANUAL`
  - intentionally unsupported until a real manual-run trigger contract exists.

### Steps

- `ACTION` → Activepieces PIECE action.
- `NOTIFICATION` → Activepieces PIECE action.
- `CONDITION` → Activepieces ROUTER with condition + fallback branches.
- `AI_DECISION` → rejected in Phase 4B.
- `APPROVAL_GATE` → rejected in Phase 4B.

AI and approval steps need dedicated runtime semantics. The compiler must not approximate them with unrelated constructs.

## Tree-shaped control flow

Automation IR V1 is a DAG, but the initial compiler supports **tree-shaped branching only**.

A downstream step may have at most one incoming IR control-flow edge. Branch joins/shared downstream steps are rejected with `UNSUPPORTED_SHARED_STEP`.

This avoids duplicating a shared step and silently changing its reference/output semantics.

A later compiler phase can add explicit branch-join lowering once dominance/join semantics are part of the IR contract.

## Capability identity

The compiler accepts only:

```text
activepieces:trigger:<pieceName>:<triggerName>
activepieces:action:<pieceName>:<actionName>
```

Every capability is re-resolved from current project-visible metadata at compile time. Discovery results from an earlier planning phase are not trusted indefinitely.

## Connection bindings

Compilation receives explicit bindings:

```ts
{
  "activepieces:action:@activepieces/piece-github:add_label": "github-main"
}
```

For components with `requireAuth=true`:

- a binding is mandatory;
- unsafe external IDs are rejected;
- the compiler injects `{{connections['<externalId>']}}`.

The compiler never guesses which connection to use.

## Input validation

Before creating a flow, the compiler rejects:

- unknown top-level input property names;
- missing required top-level properties;
- stale/hidden pieces;
- removed actions/triggers;
- missing connection bindings.

Dynamic property resolution remains a future concern. Phase 4B validates only the metadata that is deterministically available without executing piece code.

## IR references

IR references are rewritten into Activepieces expressions.

Examples:

```text
TRIGGER path ["id"]
→ {{trigger['output']['id']}}

STEP "lookup" path ["record", "id"]
→ {{aa_step_002['output']['record']['id']}}
```

Compiler-assigned step names are deterministic and independent of user/model-provided IDs.

## Conditions

Phase 4B supports direct mappings for:

- equals / not-equals;
- greater-than / less-than;
- contains / not-contains;
- exists / not-exists;
- is-true / is-false.

`GREATER_THAN_OR_EQUAL` and `LESS_THAN_OR_EQUAL` are rejected for now because Activepieces has no single equivalent branch operator. The compiler does not silently weaken or rewrite those semantics.

## Materialization outcomes

```text
COMPLETE_DRAFT
PARTIAL_DRAFT
FAILED_CLEANLY
FAILED_WITH_ARTIFACT
```

### COMPLETE_DRAFT

The flow was created, imported, remains disabled/unpublished, and Activepieces considers the draft structurally valid.

### PARTIAL_DRAFT

The flow exists and remains safe, but Activepieces marks the imported version invalid.

### FAILED_CLEANLY

Compilation or flow creation failed before a persistent flow artifact exists.

### FAILED_WITH_ARTIFACT

The flow was created but a later import/runtime step failed. The artifact remains disabled and is returned for inspection rather than hidden or auto-published.

## Hard safety invariant

The materializer rejects any compiler operation of type:

- `LOCK_AND_PUBLISH`;
- `CHANGE_STATUS`.

After all operations it also verifies:

```text
flow.status === DISABLED
publishedVersionId === null
```

Phase 4B has no activation API.

## Non-goals

Phase 4B does not:

- publish a flow;
- enable a flow;
- execute/test a flow;
- resolve dynamic dropdown/property values;
- compile AI decisions;
- compile approval gates;
- support branch joins;
- expose a public compiler HTTP endpoint.

The next phase should validate/simulate the draft before any activation workflow is designed.

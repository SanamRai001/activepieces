# Automation Architect — Activepieces Runtime Integration Map

## Purpose

This document records the Phase 1 integration audit for Automation Architect.

The goal is to identify the **smallest stable Activepieces surfaces** required to turn a provider-neutral Automation IR into a validated, testable Activepieces draft flow without bypassing Activepieces' existing rules.

This is an implementation map, not a request to rewrite Activepieces.

---

## Executive decision

Automation Architect should **not** write raw flow-version JSON directly to the database and should **not** depend on parsing human-readable MCP tool responses.

The preferred path is:

```text
Automation IR
    |
    v
Activepieces Adapter
    |
    v
typed CreateFlowRequest + FlowOperationRequest[]
    |
    v
flowService.create / flowService.update
    |
    v
flowVersionService.applyOperation
    |
    +--> flowVersionValidationUtil.prepareRequest
    |
    +--> flowOperations.apply
    |
    v
draft FlowVersion persisted by Activepieces
```

This preserves Activepieces' existing:

- flow draft/version lifecycle;
- piece-version normalization;
- per-step validation;
- connection and agent reference extraction;
- flow operation semantics;
- persistence;
- side effects;
- publish behavior.

The existing MCP flow-building tools are valuable **adapters and reference implementations**, but Automation Architect's core compiler should target typed Activepieces operations rather than tool-call text.

---

# 1. Relevant packages

## Shared execution model

Primary package:

```text
packages/core/execution
```

Exported through `@activepieces/core-execution` and re-exported by `@activepieces/shared`.

Important locations:

```text
packages/core/execution/src/lib/flows/
├── flow.ts
├── flow-version.ts
├── actions/action.ts
├── triggers/trigger.ts
├── operations/
├── util/flow-structure-util.ts
└── util/flow-piece-util.ts
```

This is the canonical typed representation of a flow.

## Server flow lifecycle

```text
packages/server/api/src/app/flows/
├── flow/
│   ├── flow.controller.ts
│   └── flow.service.ts
└── flow-version/
    ├── flow-version.service.ts
    └── flow-version-validator-util.ts
```

## Capability discovery

```text
packages/server/api/src/app/
├── pieces/metadata/piece-metadata-service.ts
├── tool-search/tool-search.service.ts
├── app-connection/
└── mcp/tools/
```

## Testing/execution

```text
packages/server/api/src/app/
├── flows/flow-run/
├── action-run/
└── mcp/tools/flow-run-utils.ts
```

---

# 2. Flow model

## FlowVersion

`FlowVersion` is the editable workflow definition.

Relevant fields include:

```text
flowId
displayName
trigger
valid
schemaVersion
agentIds
connectionIds
state
notes
```

Current states:

```text
DRAFT
LOCKED
```

Automation Architect should produce changes against a **draft**.

It should never directly construct a published version.

## Trigger types

Current core trigger types:

```text
EMPTY
PIECE_TRIGGER
```

A newly created flow starts with an empty trigger.

## Action types

Current action types:

```text
CODE
PIECE
LOOP_ON_ITEMS
ROUTER
AI_ROUTER
```

Automation IR does not need to mirror every Activepieces type one-to-one.

The adapter is responsible for translating IR constructs into these runtime types.

Example:

```text
IR deterministic condition
    -> ROUTER

IR semantic classification
    -> AI_ROUTER where suitable
       OR an AI piece + deterministic router when required

IR integration action
    -> PIECE

IR transformation not expressible by a piece/formula
    -> CODE
```

Code should remain a fallback, not the default.

---

# 3. Mutation model

Activepieces already has the command model we need.

## FlowOperationType

Important operations for the first compiler:

```text
UPDATE_TRIGGER
ADD_ACTION
UPDATE_ACTION
ADD_BRANCH
DELETE_BRANCH
MOVE_ACTION
CHANGE_NAME
IMPORT_FLOW
LOCK_AND_PUBLISH
CHANGE_STATUS
```

The first MVP should need only a subset.

Recommended initial compiler subset:

```text
UPDATE_TRIGGER
ADD_ACTION
ADD_BRANCH
UPDATE_ACTION
```

Publishing is deliberately **not** part of compilation.

## Step placement

`StepLocationRelativeToParent` already expresses:

```text
AFTER
INSIDE_LOOP
INSIDE_BRANCH
INSIDE_ON_SUCCESS_BRANCH
INSIDE_ON_FAILURE_BRANCH
```

This is sufficient for the initial graph compiler.

---

# 4. Actual mutation lifecycle

The existing mutation lifecycle is important because bypassing it would reproduce validation and versioning bugs.

## Create

`flowService.create(...)`:

1. creates a disabled Flow record;
2. creates an empty draft FlowVersion;
3. records ownership/project metadata;
4. emits normal Activepieces side effects.

The Automation Architect adapter should use this service rather than inserting records.

## Update

`flowService.update(...)` handles flow-level operations.

For normal structure mutations it:

1. obtains/creates the correct draft;
2. calls `flowVersionService.applyOperation(...)`;
3. returns the populated updated flow.

## Apply operation

`flowVersionService.applyOperation(...)`:

1. expands operations such as sample-data operations when necessary;
2. delegates each operation through `applySingleOperation(...)`;
3. recomputes connection IDs;
4. recomputes agent IDs;
5. updates timestamps/user attribution;
6. persists the FlowVersion.

## Prepare + validate

`applySingleOperation(...)` calls:

```text
flowVersionValidationUtil.prepareRequest(...)
```

before:

```text
flowOperations.apply(...)
```

This is a critical boundary.

The validation layer already:

- resolves exact piece versions;
- validates piece actions;
- validates piece triggers;
- validates router configuration;
- validates AI-router configuration;
- validates loop configuration;
- validates code configuration;
- cleans invalid/unrecognized piece input where applicable;
- sets each step's `valid` state.

**Decision:** the compiler must use this lifecycle rather than manually setting `valid: true`.

---

# 5. Capability discovery

Automation Architect must never invent tools.

There are already two useful discovery layers.

## toolSearchService

```text
packages/server/api/src/app/tool-search/tool-search.service.ts
```

Methods:

```text
searchActions(query, options)
searchTriggers(query, options)
```

Behavior:

- semantic search when an embedding model is available;
- keyword/Fuse fallback when no embedder is available;
- does not force a semantic match;
- applies piece visibility filtering;
- can restrict to a piece;
- can surface whether a project already has a connection.

This is a strong fit for natural-language capability selection.

### Recommendation

Use this service as the first retrieval stage for the planner.

The planner should receive structured candidate capabilities, not the entire pieces catalog.

## pieceMetadataService

```text
packages/server/api/src/app/pieces/metadata/piece-metadata-service.ts
```

Important methods:

```text
list(...)
get(...)
getOrThrow(...)
```

This is the authoritative metadata source after a candidate piece/action has been selected.

It applies:

- platform/project visibility policy;
- audience filtering;
- version resolution;
- component filtering.

### Recommendation

Use:

```text
toolSearchService
    ↓
candidate action/trigger
    ↓
pieceMetadataService
    ↓
authoritative metadata/schema
```

Do not trust the LLM's memory of an integration's parameters.

---

# 6. Piece input/schema resolution

Existing MCP tooling already solves much of the difficult schema problem.

Important reference implementation:

```text
packages/server/api/src/app/mcp/tools/ap-get-piece-props.ts
```

It can derive:

- whether auth is required;
- available project connections;
- input properties;
- required inputs;
- dynamic property options;
- example input;
- output schema/field paths;
- action AI metadata;
- idempotency hints where supplied.

It uses helpers in:

```text
packages/server/api/src/app/mcp/tools/mcp-utils.ts
```

Relevant helpers include:

```text
lookupPieceComponent
resolveLatestPieceVersion
diagnosePieceProps
detectUnknownInputProps
fillDefaultsForMissingOptionalProps
resolveTransitively
```

## Boundary decision

Do **not** make the provider-neutral planner import `mcp-utils.ts`.

That would incorrectly couple Automation Architect to the MCP presentation layer.

Before Phase 4, the reusable capability-resolution logic should either:

1. be extracted to a small non-MCP service; or
2. be wrapped by a dedicated Automation Architect Activepieces adapter.

The existing MCP code remains the behavior reference.

---

# 7. Existing MCP flow-building surface

Activepieces already includes a surprisingly complete AI-facing builder toolkit.

Relevant tools include:

```text
ap_create_flow
ap_build_flow
ap_update_trigger
ap_add_step
ap_update_step
ap_delete_step
ap_add_branch
ap_update_branch
ap_delete_branch
ap_search_actions
ap_search_triggers
ap_get_piece_props
ap_resolve_property_options
ap_validate_step_config
ap_validate_flow
ap_test_step
ap_test_flow
ap_lock_and_publish
```

## Important implication

A general LLM connected to this MCP server can already build many flows from natural-language instructions.

Therefore Automation Architect must not position itself as merely:

> "AI that calls Activepieces flow-building tools."

The differentiator remains:

```text
messy human problem
    ↓
process understanding
    ↓
explicit Automation IR
    ↓
deterministic policy/risk analysis
    ↓
explainable plan
    ↓
validated compilation
    ↓
supervised execution/recovery
```

MCP is one execution/control surface, not the product architecture.

## ap_build_flow limitations relevant to us

The existing `ap_build_flow` tool:

- creates a new flow in one call;
- supports piece, code and loop actions;
- resolves piece versions;
- checks unknown props;
- cleans up an orphan flow on some creation failures;
- currently excludes router construction from its one-call schema;
- is designed as an agent-facing convenience API.

It is valuable as:

- a reference implementation;
- a possible early prototype adapter.

It is **not** the long-term Automation Architect compiler contract.

---

# 8. Validation surfaces

There are two different validation levels.

## Operation-level validation

Authoritative mutation validation:

```text
flowVersionValidationUtil.prepareRequest
```

This runs during normal flow updates.

It should remain part of every generated mutation.

## Structural flow validation

MCP tool:

```text
ap_validate_flow
```

Currently checks:

- empty/unconfigured trigger;
- invalid steps;
- references to nonexistent steps;
- references to later steps;
- empty router branches.

It returns structured issue data.

### Problem

The core `validateFlow` implementation currently lives as a private function inside the MCP tool file.

### Recommendation

Before generated flows are activated, extract the structural validator into a reusable CE server module, for example:

```text
packages/server/api/src/app/flows/validation/flow-structure-validation.service.ts
```

Then both:

```text
MCP ap_validate_flow
Automation Architect validator
```

can call the same implementation.

This should be a small refactor rather than duplicated validation code.

---

# 9. Step pre-validation

Existing tool:

```text
ap_validate_step_config
```

It can validate candidate configuration without mutating a flow.

Supported categories currently include:

- piece action;
- piece trigger;
- code;
- loop;
- router.

This is useful during planning/compilation.

### Recommendation

Automation Architect should perform two checks:

```text
IR schema validation
    ↓
Activepieces candidate-step validation
    ↓
apply operation
```

This gives failures before mutation where possible, while the authoritative operation validation still runs afterward.

---

# 10. Test execution

Existing exported helper:

```text
executeFlowTest(...)
```

currently lives in:

```text
packages/server/api/src/app/mcp/tools/flow-run-utils.ts
```

It:

1. loads the draft flow;
2. confirms trigger configuration;
3. optionally saves supplied trigger sample data;
4. calls `flowRunService.test(...)`;
5. polls for completion;
6. reports terminal state and failed step;
7. distinguishes mock trigger data from real trigger evidence.

This behavior is directly useful.

## Boundary issue

The helper lives under the MCP tool directory even though its behavior is not intrinsically MCP-specific.

### Recommendation

Do not duplicate it.

When the Automation Architect reaches Phase 5, extract/re-home the reusable flow-test orchestration into a normal flow-testing service and keep the MCP tool as a thin adapter.

---

# 11. Publish boundary

Existing `ap_lock_and_publish` demonstrates the correct publish behavior:

1. inspect all steps;
2. reject invalid non-skipped steps;
3. apply `LOCK_AND_PUBLISH`;
4. enable the flow.

## Decision

Generated flows should remain:

```text
DRAFT + DISABLED
```

through planning, compilation, structural validation and test execution.

Compilation must never imply activation.

Activation belongs to a later policy/approval phase.

This is important for safety and product trust.

---

# 12. Frontend/API boundary

The existing web client uses:

```text
POST /v1/flows
POST /v1/flows/:id
GET  /v1/flows/:id
```

with shared typed objects:

```text
CreateFlowRequest
FlowOperationRequest
PopulatedFlow
```

This confirms that Activepieces already treats `FlowOperationRequest` as the normal mutation contract across UI/server boundaries.

Automation Architect does not need a second flow mutation protocol.

It may expose its own API for:

```text
plan automation
validate plan
compile plan
approve activation
```

but the final Activepieces adapter should still resolve into existing flow operations.

---

# 13. Recommended Automation Architect module boundaries

## Provider-neutral core

Proposed future package:

```text
packages/core/automation-architect/
```

Responsibilities:

- Automation IR types/schemas;
- risk vocabulary;
- approval policy types;
- planner result contracts;
- provider-neutral validation.

It must not import server services or MCP code.

## Activepieces server adapter

Proposed future server module:

```text
packages/server/api/src/app/automation-architect/
```

Likely internal structure:

```text
automation-architect/
├── capability/
│   ├── capability-search.service.ts
│   └── capability-schema.service.ts
├── compiler/
│   ├── activepieces-compiler.service.ts
│   └── operation-builder.ts
├── validation/
│   └── automation-validation.service.ts
├── planner/
├── policy/
└── automation-architect.controller.ts
```

Names remain provisional.

## Frontend

Proposed later location:

```text
packages/web/src/features/automation-architect/
```

No frontend code should be added until the planner/IR contract is stable.

---

# 14. Recommended compiler algorithm

Initial target:

```text
Validated Automation IR
        |
        v
resolve project/platform context
        |
        v
discover + verify trigger capability
        |
        v
discover + verify action capabilities
        |
        v
resolve connection requirements
        |
        v
prevalidate configurations
        |
        v
flowService.create()
        |
        v
UPDATE_TRIGGER
        |
        v
ADD_ACTION / ADD_BRANCH / UPDATE_ACTION ...
        |
        v
Activepieces operation validation on every mutation
        |
        v
structural validation
        |
        v
test flow
        |
        v
return DRAFT
```

On compilation failure, the system must not pretend a partial flow is complete.

The compiler result should explicitly report:

```text
COMPLETE_DRAFT
PARTIAL_DRAFT
FAILED_CLEAN
FAILED_WITH_ARTIFACT
```

or an equivalent typed status.

Cleanup policy must be explicit rather than silently deleting potentially useful user work.

---

# 15. Reliability rules for the adapter

The adapter must:

1. use project/platform-scoped capability discovery;
2. resolve real piece/action/trigger metadata before compilation;
3. use real connection identifiers rather than fabricated auth references;
4. preserve Activepieces validation;
5. avoid setting `valid` manually as proof of correctness;
6. preserve flow draft/version behavior;
7. never automatically publish solely because compilation succeeded;
8. distinguish test-with-mock-data from verified real execution;
9. expose partial-compilation state;
10. avoid unbounded repair loops;
11. keep destructive mutations behind explicit policy gates;
12. keep the provider-neutral IR free of Activepieces implementation details.

---

# 16. Upstream-change sensitivity

## Lower-risk extension surfaces

Relatively good boundaries:

- `@activepieces/core-execution` flow types;
- `FlowOperationRequest`;
- `flowService.create/update`;
- `pieceMetadataService`;
- `toolSearchService`;
- existing project/connection services.

## Medium-risk surfaces

Useful but likely to evolve:

- `mcpUtils`;
- individual MCP tool implementations;
- tool-search rollout details;
- AI Router behavior;
- internal flow-test helper location.

## Avoid coupling to

- database entities/repositories as the compiler API;
- Enterprise-licensed implementation directories;
- DOM/UI structure;
- textual formatting of MCP tool responses;
- direct serialized FlowVersion construction as the primary compiler path.

---

# 17. Phase 1 conclusion

The fork already contains more of the required infrastructure than expected.

We do **not** need to build:

- a flow graph engine;
- piece discovery from scratch;
- a flow-operation language;
- versioning;
- per-step piece validation;
- a basic flow test runner;
- MCP builder tools.

The first genuinely new core should therefore be **Automation IR**.

Phase 2 can proceed without touching the Activepieces runtime.

The IR should be:

- small;
- versioned;
- Zod-validated;
- provider-neutral;
- explicitly typed around triggers, deterministic conditions, actions, AI decisions, approval gates and notifications;
- designed so an Activepieces adapter can compile it into the operation model documented above.

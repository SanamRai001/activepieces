# Automation Architect — Natural-language Planner Prototype

## Purpose

Phase 3 introduces the first reasoning layer above Automation IR.

The planner accepts an imprecise human goal and a **real, supplied capability catalog**, then asks a model to propose a plan. The model does not execute anything and is not trusted as the authority for capabilities, connections, risk, policy, or successful execution.

```text
human goal
   |
   v
planner input
   |-- capability catalog
   |-- connection availability
   |-- deterministic policy
   |-- optional constraints
   v
model proposes READY or NEEDS_INPUT
   |
   v
strict envelope parsing
   |
   v
Automation IR V1 validation
   |
   v
deterministic grounding
   |-- capability exists?
   |-- capability kind matches?
   |-- connection available?
   |-- authoritative capability risk
   |-- denied by policy?
   |-- approval required?
   v
READY / NEEDS_INPUT / FAILED
```

## Trust boundaries

### Human-authoritative

- original goal;
- explicit constraints;
- approvals and policy choices.

The planner normalizes the final IR goal back to the user's original goal so a model cannot silently rewrite the objective.

### Catalog-authoritative

For external capabilities:

- capability ID;
- capability kind;
- connection requirement;
- connection availability;
- risk classification.

`ACTION` and `NOTIFICATION` capabilities must include authoritative risk metadata.

### Model-proposed

The model may propose:

- workflow name;
- step structure;
- deterministic conditions;
- AI-decision steps;
- inputs/references;
- explanation;
- assumptions;
- focused clarification questions.

Every model-produced plan still passes normal IR validation and capability/policy grounding.

## Central model rules

All model adapters receive the same `AUTOMATION_PLANNER_RULES`.

The current rules require the model to:

1. use only supplied capability IDs;
2. prefer deterministic conditions when exact logic is sufficient;
3. ask only materially necessary questions;
4. never invent credentials, connections, permissions, tools, or successful results;
5. treat catalog risk and deterministic policy as authoritative;
6. produce a plan only—never execute, activate, publish, or claim execution.

Provider-specific adapters should not weaken or redefine these rules.

## Planner results

### READY

The plan is structurally valid and grounded against the supplied capability catalog.

A READY plan may still contain `POLICY_APPROVAL_REQUIRED` diagnostics. READY means **ready as a plan**, not authorized for execution.

### NEEDS_INPUT

Used when:

- the model identifies material ambiguity; or
- a required connection is unavailable.

Questions are explicit and machine-readable.

### FAILED

Used for cases such as:

- invalid planner input;
- model-provider failure;
- malformed model envelope;
- invalid Automation IR;
- invented capability;
- capability-kind mismatch;
- policy-denied operation.

## Diagnostics

Current diagnostic codes:

```text
INVALID_INPUT
MODEL_FAILURE
MODEL_OUTPUT_INVALID
INVALID_AUTOMATION_IR
UNKNOWN_CAPABILITY
CAPABILITY_KIND_MISMATCH
CONNECTION_REQUIRED
POLICY_APPROVAL_REQUIRED
POLICY_DENIED
```

Diagnostics are deterministic planner output and should be preferred over interpreting model prose.

## Capability catalog

The Phase 3 catalog is intentionally provider-neutral.

A capability contains:

```text
id
kind
name
description
connection
risk (required for ACTION / NOTIFICATION)
```

Activepieces-specific discovery is **not** implemented in this phase. A later server adapter will translate real Activepieces trigger/action metadata into this contract.

This separation lets the planner remain reusable with other automation runtimes.

## What Phase 3 does not do

It does not:

- search Activepieces pieces itself;
- resolve piece input schemas;
- create an Activepieces flow;
- mutate a flow;
- test a flow;
- publish/activate a flow;
- execute actions;
- send messages;
- auto-approve risky operations.

## Next boundary

Phase 4 should connect this planner contract to real Activepieces capability discovery and/or compile validated IR into typed `FlowOperationRequest` operations while preserving the draft-only safety boundary.

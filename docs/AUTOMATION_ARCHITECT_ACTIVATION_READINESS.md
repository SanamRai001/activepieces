# Automation Architect — Activation Readiness & Approval Enforcement

## Phase 6A boundary

Phase 6A decides whether an exact generated draft is **eligible** for a later activation operation.

It does not publish or enable anything.

```text
DISABLED + unpublished DRAFT
→ fresh structural validation
→ exact flowVersionId match
→ verified TESTING simulation evidence
→ authoritative risk resolution
→ deterministic policy
→ durable version-bound human approval when required
→ READY_TO_ACTIVATE
```

## Approval is evidence, not a mutable flag

Approvals are immutable database records tied to:

- project;
- flow;
- exact flow version;
- approving user;
- approval timestamp;
- simulation run id;
- policy snapshot + digest;
- risk snapshot + digest.

A changed draft, changed risk snapshot, or changed policy cannot reuse the old approval.

The record remains historical evidence, while readiness returns `STALE_APPROVAL`.

## Model authority

Planner/model text is never accepted as:

- proof of successful simulation;
- risk classification;
- approval;
- permission to activate.

Simulation is verified from the persisted flow run.

Risk is re-derived from current project-scoped piece metadata.

Approval is created only through the deterministic Phase 6A service with an explicit user id.

## Stable readiness outcomes

- `READY_TO_ACTIVATE`
- `APPROVAL_REQUIRED`
- `DENIED`
- `STALE_VALIDATION`
- `STALE_APPROVAL`
- `SIMULATION_REQUIRED`
- `SIMULATION_FAILED`
- `NEEDS_CONFIGURATION`
- `FLOW_NOT_FOUND`
- `UNSAFE_ARTIFACT`

## Risk policy

The existing provider-neutral risk policy remains authoritative.

Current compiled Activepieces action classification maps conservatively:

- READ / SEARCH → READ_ONLY
- WRITE → SENSITIVE_MUTATION
- DESTRUCTIVE → DESTRUCTIVE
- missing/unknown → SENSITIVE_MUTATION

This phase does not let an LLM lower that classification.

## Simulation policy

Activation policy explicitly states whether a successful simulation is required.

When required, the run must match:

- requested run id;
- project;
- flow;
- exact flow version;
- environment = TESTING;
- status = SUCCEEDED.

Any version mismatch makes prior validation/simulation stale.

## No activation operations

Phase 6A contains no:

- `LOCK_AND_PUBLISH`;
- `CHANGE_STATUS`;
- trigger enablement;
- production execution.

Phase 6B may later consume `READY_TO_ACTIVATE` evidence and add one minimal audited activation operation.

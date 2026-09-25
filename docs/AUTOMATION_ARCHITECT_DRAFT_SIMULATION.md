# Automation Architect — Safe Draft Simulation

## Purpose

Phase 5B lets Automation Architect test a generated draft without publishing or enabling it.

The runtime path is:

```text
DISABLED + unpublished DRAFT
        ↓
Phase 5A structural validation
        ↓
pin validated flowVersionId
        ↓
TESTING environment run
        ↓
poll terminal state
        ↓
TEST_SUCCEEDED / TEST_FAILED / TEST_TIMEOUT
```

## Evidence labels

Trigger data provenance is explicit:

- `USER_SUPPLIED_MOCK`
  - the caller supplied test payload;
  - this is definitely mock data;
  - success must never be described as verification against a real trigger event.
- `EXISTING_DRAFT_SAMPLE`
  - the draft already contains trigger sample data;
  - provenance is unknown;
  - this must not be promoted to "real event verified".
- `NO_TRIGGER_SAMPLE`
  - no sample-data file is attached to the trigger;
  - the Activepieces test runner may execute with an empty trigger payload.

This distinction is intentional because Activepieces sample-data metadata does not record whether a stored sample originally came from a real event or a prior user-supplied mock.

## Safety invariants

Automation Architect refuses simulation when Phase 5A reports:

- enabled flow;
- published flow;
- locked version;
- structurally blocking issues.

The exact validated `flowVersionId` is passed into the runtime orchestration.

The orchestration re-loads the draft before test start and refuses execution if the version changed.

Runtime results are accepted only when:

```text
environment === TESTING
```

A non-TESTING run is treated as unsafe.

## Mock trigger data

When explicit test data is provided:

1. it is saved as draft trigger sample data;
2. only `UPDATE_SAMPLE_DATA_INFO` is applied;
3. the flow remains disabled/unpublished;
4. the result is labeled `USER_SUPPLIED_MOCK`.

No activation or publish operation exists in this service.

## Shared runtime orchestration

The reusable flow-test orchestration is placed under:

```text
packages/server/api/src/app/flows/testing/
```

It is runtime/policy neutral enough to be shared by:

- Automation Architect;
- MCP flow-test tooling.

MCP remains responsible for its own human-facing formatting and warnings.

## Result states

Automation Architect returns:

```text
TEST_SUCCEEDED
TEST_FAILED
TEST_TIMEOUT
NEEDS_CONFIGURATION
FLOW_NOT_FOUND
UNSAFE_ARTIFACT
```

`TEST_TIMEOUT` means the run remained non-terminal after the polling deadline. It is not silently converted into failure.

## Non-goals

Phase 5B does not:

- enable a flow;
- publish a flow;
- run production environment;
- assert that existing sample data came from a real trigger;
- automatically retry timed-out writes;
- add an activation path.

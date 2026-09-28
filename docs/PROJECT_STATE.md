# PROJECT_STATE

## Objective

Build an **Automation Architect** layer on top of Activepieces Community Edition:

```text
human automation problem
→ natural-language planner
→ grounded Automation IR
→ deterministic policy/safety
→ real Activepieces capabilities
→ safe draft compiler
→ structural validation
→ safe simulation
→ approval-controlled activation
→ runtime supervision
```

The system must prefer deterministic behavior where possible, keep model output non-authoritative for safety-sensitive facts, and preserve human control over high-impact actions.

## Repository

- Fork: `SanamRai001/activepieces`
- Upstream: `activepieces/activepieces`
- Default branch: `main`
- Foundation: `feat/automation-architect-foundation` — PR #1
- Automation IR: `feat/automation-ir` — PR #2
- Planner: `feat/natural-language-planner-phase3` — PR #4
- Capability discovery: `feat/activepieces-capability-discovery` — PR #5
- IR compiler: `feat/activepieces-ir-compiler` — PR #6
- Structural validation: `feat/draft-structural-validation` — PR #7
- Working branch: `feat/draft-safe-simulation` — PR #8
- PR #3 is superseded/closed.

## Completed phase

**Phase 5B — Safe Draft Test / Simulation Service**

Phase 5 is now complete.

A generated Automation Architect flow can now move through:

```text
Automation IR
    ↓
Activepieces draft compiler
    ↓
DISABLED + unpublished DRAFT
    ↓
shared structural validation
    ↓
VALIDATED_DRAFT
    ↓
safe TESTING-environment simulation
    ↓
TEST_SUCCEEDED / TEST_FAILED / TEST_TIMEOUT
```

No activation/publishing path exists yet.

## Phase 5B changes

### Shared flow-test orchestration

Extracted reusable test orchestration into:

```text
packages/server/api/src/app/flows/testing/flow-test-orchestration.service.ts
```

Both Automation Architect and MCP now use the same underlying flow-test behavior.

The shared service:

- loads the flow in project scope;
- optionally pins an expected `flowVersionId`;
- can require a disabled + unpublished + DRAFT artifact;
- rejects unconfigured triggers;
- rejects unknown requested steps;
- records invalid full-flow steps for diagnostics;
- optionally saves explicit mock trigger data as draft sample data;
- re-checks artifact safety immediately before execution;
- invokes the existing Activepieces test runner;
- accepts only `RunEnvironment.TESTING`;
- polls for terminal completion with a bounded timeout;
- returns stable machine-readable results.

### Exact draft version pinning

Automation Architect first validates the draft through Phase 5A and then passes that exact:

```text
flowVersionId
```

to the simulation service.

If the draft version changes between validation and execution:

```text
FLOW_VERSION_CHANGED
```

is returned and the test is refused.

This closes a time-of-check/time-of-use gap between validation and simulation.

### Draft-state revalidation

Immediately before the runtime test starts, the shared service re-loads the flow when Automation Architect requests the draft-only guard.

Simulation is refused unless:

```text
flow.status === DISABLED
publishedVersionId === null
flow.version.state === DRAFT
```

If the artifact became enabled, published, locked, deleted, or replaced by another draft version, Automation Architect refuses execution.

### Test-environment enforcement

The started run and terminal run must both satisfy:

```text
environment === TESTING
```

Any non-TESTING result becomes:

```text
UNSAFE_TEST_RUN
```

Automation Architect maps this to:

```text
UNSAFE_ARTIFACT
```

and does not treat the result as valid simulation evidence.

### Trigger-data provenance

Simulation now reports one of:

```text
USER_SUPPLIED_MOCK
EXISTING_DRAFT_SAMPLE
NO_TRIGGER_SAMPLE
```

#### USER_SUPPLIED_MOCK

The caller explicitly supplied trigger payload.

It is saved only as draft sample data and must never be described as real-event verification.

#### EXISTING_DRAFT_SAMPLE

The flow already had trigger sample data.

Its provenance is unknown, so Automation Architect must not claim it came from a real external trigger event.

#### NO_TRIGGER_SAMPLE

No trigger sample file is attached.

The test runner may therefore execute with an empty/no trigger payload depending on trigger behavior.

### Stable Automation Architect simulation outcomes

Automation Architect exposes:

```text
TEST_SUCCEEDED
TEST_FAILED
TEST_TIMEOUT
NEEDS_CONFIGURATION
FLOW_NOT_FOUND
UNSAFE_ARTIFACT
```

Terminal engine `TIMEOUT` is mapped to `TEST_TIMEOUT`.

A polling deadline that expires while the run remains non-terminal is also `TEST_TIMEOUT`; it is not misreported as a test failure.

### MCP compatibility

`executeFlowTest(...)` in:

```text
mcp/tools/flow-run-utils.ts
```

now delegates runtime orchestration to the shared flow-test service.

MCP retains its human-facing:

- warnings;
- trigger-shape hint;
- output formatting;
- timeout guidance;
- internal-error messaging.

This avoids maintaining a separate Automation Architect test runner.

### Safety boundary

Phase 5B does not:

- publish;
- enable a flow;
- change flow status;
- run production environment intentionally;
- claim mock/sample data is a real trigger event;
- automatically retry side-effecting failures;
- activate triggers.

## Final Phase 5B verification

Workflow:

```text
Draft Simulation Verification
```

Final run:

```text
36447180384
```

Verified implementation head:

```text
8fe40b6c61f605a75951f9ac2fde4386a31b02e8
```

Results:

- `bun install --frozen-lockfile`: **PASS**
- API build through Turborepo workspace dependency graph: **PASS**
  - **17/17 build tasks successful**
- Focused typed ESLint: **PASS**
  - **0 errors**
  - 7 non-blocking explicit-return-type warnings
- Focused Vitest: **PASS**
  - **4 test files passed**
  - **33/33 tests passed**
  - 0 failed

Verification coverage includes:

- shared flow-test orchestration;
- Phase 5A draft validation regressions;
- Automation Architect draft simulation;
- existing MCP flow-run utility regressions;
- version-drift refusal;
- unsafe-artifact drift refusal;
- TESTING-environment enforcement;
- user-supplied mock labeling;
- existing-sample labeling;
- no-sample labeling;
- timeout handling;
- terminal failure/failed-step reporting;
- no-test behavior for structurally invalid drafts.

The temporary branch-only verification workflow was removed after the green run.

Commits after the verified implementation head are documentation / temporary-CI cleanup only.

## Current architecture

```text
Human request
    ↓
Natural-language planner
    ↓
Automation IR V1
    ↓
Project-scoped capability discovery
    ↓
Safe Activepieces compiler
    ↓
DISABLED + unpublished DRAFT
    ↓
Shared structural validation
    ↓
VALIDATED_DRAFT
    ↓
Safe TESTING simulation
    ↓
TEST_SUCCEEDED / TEST_FAILED / TEST_TIMEOUT
    ↓
NO activation yet
```

## Verification milestones

- Phase 2 Automation IR: **18/18 tests**
- Phase 3 planner: **33/33 tests**
- Phase 4A capability discovery: **17/17 tests**
- Phase 4B IR compiler: **36/36 tests**
- Phase 5A structural validation: **14/14 tests**
- Phase 5B safe simulation: **33/33 focused/regression tests**

## Key decisions

1. Activepieces remains the runtime; Automation Architect remains the intelligence/safety layer.
2. The model proposes; deterministic code validates safety-sensitive facts.
3. User intent remains authoritative.
4. Capabilities are project-scoped and re-resolved at compile time.
5. Connection choice is explicit and never guessed.
6. Compiler fails rather than approximating unsupported semantics.
7. Every generated runtime step passes Activepieces' normal operation validation.
8. Generated artifacts remain draft + disabled until an explicit later activation boundary.
9. Structural validation is shared with Activepieces MCP rather than duplicated.
10. Flow-test orchestration is shared with MCP rather than duplicated.
11. Validation and simulation are separate evidence layers.
12. Simulation pins the exact validated draft version.
13. Simulation re-checks artifact safety immediately before starting the test.
14. Only TESTING-environment runs count as simulation.
15. Mock/sample trigger evidence must never be promoted to real-event evidence.
16. Timeout is distinct from failure.
17. There is still no automatic publishing/activation path.
18. Browser/ChatGPT automation remains outside the core MVP path.

## Risks / open boundaries

- Dynamic piece properties can still require runtime/property resolution.
- TEST_SUCCEEDED proves the tested draft execution path succeeded under the available test/sample context; it does not prove future external events will have identical payloads or external conditions.
- Existing draft sample provenance cannot be proven as real-event evidence.
- Some triggers require real external interactions that a local test cannot fully simulate.
- AI decisions and approval gates still lack runtime semantics.
- Branch joins remain unsupported by the Phase 4B compiler.
- No production planner-model adapter is wired yet.
- Schedule natural-language normalization remains a planner concern.
- Approval policy exists as a contract but is not yet enforced at an activation boundary.
- No activation audit record exists yet.
- No runtime supervisor exists yet.

## Next phase

**Phase 6A — Activation Readiness & Approval Enforcement**

Goal: create the deterministic safety boundary that decides whether a validated/simulated draft is eligible to be activated.

This phase must **not activate flows yet**.

Requirements:

1. define an activation-readiness input/result contract;
2. require:
   - safe unpublished draft;
   - successful structural validation;
   - successful/acceptable simulation evidence according to policy;
   - unchanged/pinned `flowVersionId`;
3. evaluate authoritative capability risks and project/user policy;
4. determine:
   - no approval required;
   - explicit human approval required;
   - activation denied;
5. require approval for configured high-impact classes such as:
   - external communication;
   - sensitive mutation;
   - destructive operations;
   - financial operations;
6. never accept planner/model text as proof of approval;
7. represent approval as a durable, explicit record tied to:
   - project;
   - flow;
   - exact flow version;
   - policy/risk snapshot;
   - approving user;
   - timestamp;
8. invalidate approval automatically if the flow version changes;
9. expose stable states such as:
   - `READY_FOR_APPROVAL`;
   - `READY_TO_ACTIVATE`;
   - `APPROVAL_REQUIRED`;
   - `DENIED`;
   - `STALE_VALIDATION`;
   - `STALE_APPROVAL`;
10. add focused tests for stale versions, risk-policy denial, approval requirements, and attempts to reuse approval for a changed draft.

Do **not** call `LOCK_AND_PUBLISH` or `CHANGE_STATUS` in Phase 6A.

After 6A is verified, **Phase 6B — Explicit Safe Activation** may add the smallest audited publish/enable path using the exact approved flow version.

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
→ activation readiness + durable approval
→ explicit safe activation
→ runtime supervision
```

The model may propose. Deterministic code and explicit human authorization control safety-sensitive actions.

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
- Safe simulation: `feat/draft-safe-simulation` — PR #8
- Working branch: `feat/activation-readiness-approval` — PR #9
- PR #3 is superseded/closed.

## Completed phase

**Phase 6A — Activation Readiness & Approval Enforcement**

Phase 6A adds the deterministic safety boundary that decides whether an exact generated draft is eligible for a later activation operation.

It still does **not** publish or enable flows.

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
Activation readiness
    ↓
authoritative risk + deterministic policy
    ↓
durable human approval when required
    ↓
READY_TO_ACTIVATE
    ↓
NO activation yet
```

## Phase 6A changes

### Activation-readiness contract

Stable readiness outcomes include:

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

### Fresh draft validation

Readiness reuses Phase 5A draft validation.

The draft must still be:

```text
DISABLED
unpublished
DRAFT
```

The exact validated `flowVersionId` must equal the version being considered for activation.

### Verified simulation evidence

When policy requires successful simulation, Phase 6A re-reads the persisted flow run.

Evidence must match:

- simulation run id;
- project;
- flow;
- exact flow version;
- `RunEnvironment.TESTING`;
- `FlowRunStatus.SUCCEEDED`.

Model/planner text cannot claim simulation success.

### Authoritative risk re-resolution

Current piece actions are re-resolved from project-scoped Activepieces metadata at readiness time.

Risk mapping remains conservative:

- READ / SEARCH → `READ_ONLY`
- WRITE → `SENSITIVE_MUTATION`
- DESTRUCTIVE → `DESTRUCTIVE`
- missing/unknown → `SENSITIVE_MUTATION`

An unconfigured piece action is rejected during risk resolution rather than indexed with an undefined action name.

### Deterministic policy

The provider-neutral `AutomationPolicySchema` is validated at runtime.

Contradictory or malformed policy fails closed.

Policy may:

- allow;
- require explicit approval;
- deny.

A denied risk class cannot be bypassed by approval.

### Durable approval evidence

Added immutable `automation_activation_approval` records containing:

- project id;
- flow id;
- exact flow version id;
- approving user id;
- approval timestamp;
- simulation run id when applicable;
- normalized policy snapshot;
- normalized risk snapshot;
- SHA-256 policy digest;
- SHA-256 risk digest.

Approvals automatically become stale when the current:

- flow version;
- required simulation;
- policy;
- risk snapshot

no longer matches the stored evidence.

### Persistence

Added the activation-approval entity and PostgreSQL migration.

The migration is registered in the normal PostgreSQL migration list, which PGlite also reuses outside testing mode.

### Human identity boundary

Phase 6A has no public approval HTTP endpoint.

`approvedByUserId` must come from a trusted authenticated/authorized caller.

A later activation surface must never accept an arbitrary model-supplied or client-supplied user id as proof of human approval.

### No activation operations

Phase 6A contains no:

- `LOCK_AND_PUBLISH`;
- `CHANGE_STATUS`;
- flow enablement;
- trigger activation;
- production execution API.

## Final Phase 6A verification

Workflow:

```text
Activation Readiness Verification
```

Final run:

```text
36461682305
```

Verified implementation head:

```text
6b769826bec8fbd81faa0cef04cf3bc51a23981d
```

Results:

- `bun install --frozen-lockfile`: **PASS**
- API build through Turborepo: **PASS**
  - **17/17 build tasks successful**
- Focused typed ESLint: **PASS**
  - **0 errors**
  - 10 non-blocking warnings
- Focused Vitest: **PASS**
  - **3 test files passed**
  - **36/36 tests passed**
  - 0 failed

The final test run includes:

- Phase 6A activation-readiness/approval tests;
- Phase 5A draft-validation regressions;
- Phase 5B draft-simulation regressions.

The verification process also caught and fixed:

- unsafe indexing of an unset piece `actionName`;
- overly broad simulation evidence string types;
- import-order/style errors.

Simulation evidence now uses Activepieces' real `RunEnvironment` and `FlowRunStatus` types.

The temporary branch-only verification workflow was removed after the green run.

Commits after the verified implementation head are documentation / temporary-CI cleanup only.

## Verification milestones

- Phase 2 Automation IR: **18/18 tests**
- Phase 3 planner: **33/33 tests**
- Phase 4A capability discovery: **17/17 tests**
- Phase 4B IR compiler: **36/36 tests**
- Phase 5A structural validation: **14/14 tests**
- Phase 5B safe simulation: **33/33 focused/regression tests**
- Phase 6A readiness/approval + Phase 5 regressions: **36/36 tests**

## Key decisions

1. Activepieces remains the runtime; Automation Architect remains the intelligence/safety layer.
2. The model proposes; deterministic code validates safety-sensitive facts.
3. User intent remains authoritative.
4. Capabilities and risk are re-resolved from current project-scoped metadata.
5. Connection choice is explicit and never guessed.
6. Every generated runtime step passes Activepieces' native operation validation.
7. Generated artifacts remain draft + disabled until an explicit activation boundary.
8. Structural validation and flow-test orchestration are shared with Activepieces rather than duplicated.
9. Simulation evidence is version-bound and must come from TESTING runs.
10. Approval is immutable evidence, not a mutable boolean.
11. Approval is bound to exact flow version, policy, risk, and required simulation evidence.
12. Planner/model text is never approval.
13. Policy denial overrides approval.
14. No activation/publishing exists in Phase 6A.
15. Browser/ChatGPT automation remains outside the core MVP path.

## Risks / open boundaries

- `READY_TO_ACTIVATE` is readiness evidence, not activation itself.
- Phase 6B must re-assess readiness immediately before mutating flow state to close the final time-of-check/time-of-use gap.
- Phase 6B must authenticate and authorize the human actor; an arbitrary `approvedByUserId` must never be accepted from model output.
- Dynamic piece properties can still require runtime/property resolution.
- TEST_SUCCEEDED proves only the tested context, not future external conditions.
- Some triggers require real external interactions that test execution cannot fully reproduce.
- AI decisions and approval-gate IR steps still lack runtime compilation semantics.
- Branch joins remain unsupported by the Phase 4B compiler.
- No production planner-model adapter is wired yet.
- Schedule natural-language normalization remains a planner concern.
- No runtime supervisor exists yet.

## Next phase

**Phase 6B — Explicit Safe Activation**

Goal: add the smallest audited publish/enable path that consumes Phase 6A readiness evidence for the exact approved flow version.

Requirements:

1. expose an explicit activation service/action only;
2. require an authenticated and authorized human actor;
3. re-run Phase 6A readiness immediately before activation;
4. require the same exact `flowVersionId`;
5. require valid durable approval when policy demands it;
6. refuse stale validation, simulation, policy, risk, or approval;
7. publish/lock only the exact approved draft version;
8. enable only after publish succeeds and safety invariants are re-checked;
9. create an immutable activation audit record containing:
   - project;
   - flow;
   - activated flow version;
   - actor;
   - approval id when applicable;
   - readiness evidence/digests;
   - timestamp;
10. make failure atomic or explicitly recoverable if publish succeeds but enable fails;
11. add focused tests for:
   - stale draft between readiness and activation;
   - missing/invalid approval;
   - unauthorized actor;
   - publish failure;
   - enable failure;
   - successful audited activation;
12. do not add autonomous activation from planner/model output.

After Phase 6B, proceed to runtime supervision rather than broadening activation behavior.

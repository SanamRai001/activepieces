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
→ runtime supervision + recovery
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
- Activation readiness/approval: `feat/activation-readiness-approval` — PR #9
- Working branch: `feat/explicit-safe-activation` — PR #10
- PR #3 is superseded/closed.

## Completed phase

**Phase 6B — Explicit Safe Activation**

Phase 6B adds the first controlled publish/enable path for Automation Architect-generated flows.

Activation remains an explicit authenticated human operation.

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
Safe TESTING simulation
    ↓
Activation readiness
    ↓
authoritative risk + server-owned policy
    ↓
durable human approval when required
    ↓
explicit authenticated activation
    ↓
publish exact draft while DISABLED
    ↓
verify exact published version
    ↓
enable
    ↓
append-only activation audit
```

## Phase 6B changes

### Explicit authenticated API

Added project-scoped USER-only endpoints:

```text
POST /v1/automation-architect/flows/:flowId/approve
POST /v1/automation-architect/flows/:flowId/activate
```

Both pass through the existing project security layer and require normal flow-status update authorization.

The actor user id comes from the authenticated principal.

No model/planner output can provide a trusted human identity.

### Server-owned activation policy

Clients cannot submit or weaken activation policy.

The server determines the policy used for readiness, approval, and activation.

### Immediate readiness re-check

Activation does not trust a prior `READY_TO_ACTIVATE` response.

Immediately before mutation it re-checks:

- draft structural safety;
- exact flow version;
- exact draft revision timestamp;
- TESTING simulation evidence;
- current project-scoped action risk;
- deterministic policy;
- durable approval where required;
- policy digest;
- risk digest.

### Simulation freshness

When successful simulation is required:

- the run must be project/flow/version matched;
- environment must be `TESTING`;
- status must be `SUCCEEDED`;
- simulation evidence must not predate the current draft revision.

A test of an older draft cannot authorize a newer revision.

### Exact-draft publish boundary

Publish receives the expected:

- draft flow version id;
- draft revision timestamp.

Inside the publish transaction, the expected draft row is pessimistically locked and re-checked.

This closes the final time-of-check/time-of-use gap between readiness and publication.

### Publish while disabled

Publication and enablement are intentionally separate.

The exact approved draft is published while the flow remains:

```text
DISABLED
```

The service then verifies that the exact expected version became the published version.

Only after this verification is enablement attempted.

### Recoverable partial activation

If publish succeeds but enablement fails:

- the artifact remains published;
- it remains disabled;
- the result is explicit;
- an audit event records `PUBLISHED_NOT_ENABLED`.

The service never reports full activation success for this partial state.

### Append-only activation audit

Added `automation_activation_audit` evidence.

Events:

- `ATTEMPT_STARTED`
- `PUBLISHED`
- `ACTIVATED`
- `FAILED_BEFORE_PUBLISH`
- `PUBLISHED_NOT_ENABLED`

`ATTEMPT_STARTED` is persisted before any publish mutation.

Audit evidence binds:

- project;
- flow;
- flow version;
- draft revision;
- authenticated actor;
- approval id;
- simulation run;
- policy digest;
- risk digest;
- occurrence time;
- failure reason when relevant.

### Persistence and schema alignment

Added/registered:

- activation audit entity;
- PostgreSQL migration;
- database connection entity registration.

Final migration verification exposed a mismatch between manually created foreign keys and EntitySchema metadata.

The migrations already created the intended constraints, but TypeORM EntitySchemas did not explicitly declare the matching relations.

Fixed by adding relation metadata for:

```text
activation approval
  → project
  → flow
  → flow_version

activation audit
  → project
  → flow
  → flow_version
  → approval (nullable, SET NULL)
```

Relation fields live in dedicated EntitySchema types rather than polluting the persistence DTO types used by services.

### Existing Activepieces lifecycle preserved

Activation remains inside existing Activepieces flow lifecycle behavior:

- existing publish logic/hooks remain in the path;
- existing RBAC remains in the request path;
- enablement remains an explicit separate operation.

No parallel/custom flow-state mechanism was introduced.

## Final Phase 6B verification

Workflow:

```text
Explicit Safe Activation Verification
```

Final run:

```text
36819230530
```

Verified implementation head:

```text
8a262e1d386bfb3b9a0287cd49cd707712112da0
```

Results:

- `bun install --frozen-lockfile`: **PASS**
- API build through Turborepo: **PASS**
  - **17/17 build tasks successful**
- Focused typed ESLint: **PASS**
  - **0 errors**
  - 18 non-blocking warnings
- Focused Phase 5/6 regressions: **PASS**
  - **4 test files passed**
  - **45/45 tests passed**
  - 0 failed
- Database migration/schema alignment: **PASS**
  - **18/18 migration-check tasks successful**
  - **No missing migrations detected**

The temporary branch-only verifier was removed after the green run.

Commits after the verified implementation head are documentation / temporary-CI cleanup only.

## Verification milestones

- Phase 2 Automation IR: **18/18 tests**
- Phase 3 planner: **33/33 tests**
- Phase 4A capability discovery: **17/17 tests**
- Phase 4B IR compiler: **36/36 tests**
- Phase 5A structural validation: **14/14 tests**
- Phase 5B safe simulation: **33/33 focused/regression tests**
- Phase 6A readiness/approval + Phase 5 regressions: **36/36 tests**
- Phase 6B activation + Phase 5/6 regressions: **45/45 tests**
- Phase 6B migration/schema alignment: **PASS**

## Key decisions

1. Activepieces remains the runtime; Automation Architect remains the intelligence/safety layer.
2. User intent remains authoritative.
3. The model proposes; deterministic code validates safety-sensitive facts.
4. Capabilities and risk are re-resolved from current project-scoped metadata.
5. Connection choice is explicit and never guessed.
6. Every generated runtime step passes Activepieces native validation.
7. Structural validation and flow-test orchestration are shared with Activepieces rather than duplicated.
8. Simulation evidence is version-bound and TESTING-only.
9. Approval is immutable evidence, not a mutable boolean.
10. Policy is server-owned at activation time.
11. Policy denial overrides approval.
12. Activation requires an authenticated/authorized human actor.
13. Readiness is re-run immediately before mutation.
14. Publish is bound to the exact draft id + revision inside the transaction.
15. Publishing happens while disabled.
16. Enablement is a separate operation after published-version verification.
17. Publish-success/enable-failure is explicit and recoverable.
18. Activation attempts are append-only audited.
19. Planner/model output cannot trigger activation.
20. Browser/ChatGPT automation remains outside the core runtime path for now.

## Risks / open boundaries

- Activated workflows can still fail later because external systems change.
- TESTING simulation proves only the tested context, not future production conditions.
- No runtime supervisor/recovery loop exists yet.
- Repeated runtime failures are not yet automatically classified/escalated.
- No bounded automatic recovery policy exists yet.
- AI decisions and approval-gate IR steps still lack runtime compilation semantics.
- Branch joins remain unsupported by the Phase 4B compiler.
- Dynamic piece properties can still require runtime/property resolution.
- No production planner-model adapter is wired yet.
- Schedule natural-language normalization remains a planner concern.
- Browser/ChatGPT coding-agent supervision remains a later adapter/vertical rather than the core runtime.

## Next phase

**Phase 7 — Runtime Supervision & Recovery**

Goal: supervise activated Automation Architect flows without giving an LLM unrestricted production control.

### Phase 7A — Runtime supervision state

Create a durable supervision model bound to:

- project;
- flow;
- active/published flow version;
- latest relevant run;
- retry/recovery counters;
- current supervision state;
- last deterministic decision;
- human-escalation state.

Candidate states:

```text
HEALTHY
OBSERVING
RECOVERABLE_FAILURE
RETRY_SCHEDULED
REPEATED_FAILURE
PAUSED_FOR_SAFETY
NEEDS_HUMAN
RECOVERED
```

### Phase 7B — Deterministic failure classification

Reuse Activepieces run status/error data to distinguish at least:

- transient/retryable execution failure;
- deterministic configuration failure;
- authentication/connection failure;
- rate-limit/backpressure condition;
- repeated identical failure;
- unsafe/unknown failure.

Do not let model text alone classify an unsafe failure as retryable.

### Phase 7C — Bounded recovery

Support only explicitly safe recovery actions first:

- bounded retry where Activepieces semantics make replay safe;
- pause/disable after configured repeated failure;
- human escalation;
- recovery audit/history.

No destructive automatic edits.

No automatic credential changes.

No unbounded self-repair loops.

### Phase 7D — Notifications / first vertical hooks

Once deterministic supervision is stable, add notifications for:

- repeated failure;
- safety pause;
- human decision required;
- successful recovery.

This becomes the foundation for the original coding-project supervisor vertical later.

Do not broaden autonomous activation behavior in Phase 7.

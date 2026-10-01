# Automation Architect — Explicit Safe Activation

## Phase 6B boundary

Phase 6B adds the first controlled publish/enable path for Automation Architect-generated flows.

Activation is deliberately narrower than ordinary workflow editing:

```text
explicit authenticated USER action
→ server-owned activation policy
→ fresh draft validation
→ exact TESTING simulation evidence
→ current project-scoped risk resolution
→ durable approval when policy requires it
→ exact draft revision re-check
→ publish exact draft while DISABLED
→ verify exact published version
→ enable as a separate step
→ append-only activation audit
```

There is no model/autonomous activation entry point.

## Human authority

Activation routes are USER-only, project-scoped server endpoints:

```text
POST /v1/automation-architect/flows/:flowId/approve
POST /v1/automation-architect/flows/:flowId/activate
```

Both pass through the existing project security layer and require the flow-status update permission.

The approving/activating user id comes from the authenticated principal. It is never accepted from planner/model output as proof of human authorization.

## Server-owned policy

Clients do not submit or weaken activation policy.

The server determines the policy used for readiness and activation.

This keeps policy outside the model trust boundary.

## Evidence binding

Activation readiness/approval is bound to the exact:

- project;
- flow;
- draft flow version id;
- draft revision timestamp;
- policy digest;
- risk digest;
- required simulation run;
- approval record when policy requires approval.

A later draft edit makes previous readiness evidence stale.

A simulation completed before the current draft revision is not accepted for activation.

## Time-of-check / time-of-use protection

The service re-runs readiness immediately before mutation.

Publishing also receives the expected draft version id and revision.

The publish transaction pessimistically locks and re-checks the expected draft before publishing.

This closes the gap between:

```text
"this draft is safe"
```

and:

```text
"this exact draft is the one being published"
```

## Publish then enable

Publishing and enabling are separate operations.

The flow is published while still:

```text
DISABLED
```

After publish, the service verifies that the exact expected version became the published version.

Only then is enablement attempted.

This avoids combining publication and production activation into one opaque mutation.

## Recoverable partial outcome

If publication succeeds but enablement fails, the system records the state explicitly rather than pretending the activation was atomic.

The artifact remains published but disabled and can be inspected/recovered.

The audit event is:

```text
PUBLISHED_NOT_ENABLED
```

## Append-only activation audit

Activation events are persisted to `automation_activation_audit`.

Events:

- `ATTEMPT_STARTED`
- `PUBLISHED`
- `ACTIVATED`
- `FAILED_BEFORE_PUBLISH`
- `PUBLISHED_NOT_ENABLED`

`ATTEMPT_STARTED` is written before any publish mutation.

Audit evidence contains the flow/version/revision, actor, approval/simulation linkage, policy/risk digests, timestamp, and failure reason where relevant.

The audit table and Phase 6A approval table have explicit EntitySchema relations whose foreign-key metadata matches the PostgreSQL migrations.

## Database safety

The final migration/entity alignment is checked with Activepieces' native:

```text
turbo run check-migrations --filter=api
```

The final Phase 6B verification reports:

```text
No missing migrations detected
```

This matters because manually created FK constraints without matching EntitySchema relation metadata can otherwise produce persistent TypeORM schema drift.

## Activation outcomes

The activation service distinguishes successful activation from recoverable or rejected states.

Important categories include:

- readiness/policy refusal before publish;
- publish failure;
- published but not enabled;
- fully activated.

The caller never receives a generic success when enablement did not complete.

## Safety invariants

Phase 6B preserves these rules:

1. no planner/model-triggered activation;
2. authenticated human identity is required;
3. normal project RBAC remains in the request path;
4. policy is server-owned;
5. readiness is recomputed immediately before mutation;
6. risk is re-resolved from current project-scoped metadata;
7. required approval must match the current evidence digests;
8. simulation must be a matching successful TESTING run when required;
9. simulation must not predate the current draft revision;
10. exact draft id + revision are checked inside the publish transaction;
11. publish occurs while disabled;
12. enable occurs only after exact published-version verification;
13. every activation attempt is auditable;
14. a publish/enable split failure is recoverable and explicit.

## Final verification

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

- `bun install --frozen-lockfile`: PASS
- API build through Turborepo: PASS
  - **17/17 build tasks successful**
- focused typed ESLint: PASS
  - **0 errors**
  - 18 non-blocking warnings
- Phase 5/6 focused regressions: PASS
  - **4 test files**
  - **45/45 tests passed**
- database migration/schema alignment: PASS
  - **18/18 migration-check tasks successful**
  - **No missing migrations detected**

The verification process caught and fixed the final schema issue:

- PostgreSQL migrations already created approval/audit foreign keys;
- the EntitySchema metadata did not explicitly declare those relations;
- explicit schema relation types were added without polluting the persistence DTO types used by services.

The temporary branch-only verifier was removed after the green run.

## Next phase

**Phase 7 — Runtime Supervision & Recovery**

The next phase should not broaden activation.

It should observe already-activated Automation Architect flows and provide deterministic operational supervision:

```text
runtime event / failure
→ classify operational state
→ bounded retry/recovery policy
→ detect repeated failure / loops
→ pause or disable when safety requires it
→ escalate to human
→ immutable supervision history
```

Phase 7 should reuse existing Activepieces run/event infrastructure where possible and must not let an LLM directly perform destructive runtime recovery.

# Automation Architect — Draft Structural Validation

## Purpose

Phase 5A extracts Activepieces' structural flow validation into a reusable Community Edition service and gives Automation Architect a draft-specific validation boundary.

The flow is now:

```text
compiled Automation IR
        ↓
DISABLED + unpublished draft
        ↓
Automation draft safety check
        ↓
shared Activepieces structural validator
        ↓
VALIDATED_DRAFT / NEEDS_CONFIGURATION
```

No execution, publishing, activation, or trigger enabling is performed here.

## Shared structural validator

Reusable implementation:

```text
packages/server/api/src/app/flows/validation/flow-structure-validation.ts
```

It is no longer private logic inside the MCP `ap_validate_flow` tool.

Both MCP and Automation Architect now share the same structural checks.

### Checks

The validator reports:

- empty/unconfigured triggers;
- invalid non-skipped steps;
- references to missing steps;
- references to steps that occur later in traversal/execution order;
- empty router branches;
- informational empty fallback branches;
- valid / invalid / skipped step counts.

Connection expressions such as:

```text
{{connections['github-main']}}
```

are not interpreted as step references.

## MCP compatibility

`ap_validate_flow` now delegates to the shared validator.

Its existing user-facing validation messages and structured result shape are intentionally preserved.

This prevents Automation Architect from creating a second validation implementation that could drift from Activepieces' MCP behavior.

## Automation Architect draft validator

Server wrapper:

```text
packages/server/api/src/app/automation-architect/draft-validation.service.ts
```

Before structural validation, it enforces the artifact safety contract.

A valid Automation Architect draft must satisfy:

```text
flow.status === DISABLED
publishedVersionId === null
flow.version.state === DRAFT
```

If any invariant is violated, validation returns `UNSAFE_ARTIFACT` instead of treating the flow as an Automation Architect draft.

## Result states

### VALIDATED_DRAFT

Returned when:

- the artifact remains disabled;
- there is no published version;
- the current version is a draft;
- structural validation has no blocking issues;
- at least one valid step exists.

### NEEDS_CONFIGURATION

The draft is safe to inspect, but structural validation still reports blocking issues.

Examples:

- invalid piece configuration;
- missing/forward references;
- empty condition branch;
- unconfigured trigger.

### FLOW_NOT_FOUND

No project-scoped flow exists for the requested ID.

### UNSAFE_ARTIFACT

The target is no longer an isolated disabled/unpublished draft.

This prevents later Automation Architect stages from accidentally treating an enabled or published flow as a disposable generated artifact.

## Scope boundary

Phase 5A intentionally does not:

- run the flow;
- save trigger test data;
- invoke actions;
- enable triggers;
- publish a version;
- change flow status;
- claim that external integrations work.

Those behaviors belong to Phase 5B or later approval-controlled stages.

## Verification

Final Phase 5A verification:

- workflow: `Draft Structural Validation Verification`;
- run: `36086683738`;
- verified implementation head: `9e0a6c881c4d006d1e2bd6041a2820d6cdb6cdf2`;
- frozen repository install: PASS;
- API build through Turborepo: PASS — 17/17 tasks;
- focused ESLint: PASS — 0 errors, 3 non-blocking explicit-return-type warnings;
- Vitest: PASS — 2 files, 14/14 tests.

The temporary verification workflow was removed after the successful run.

## Next

Phase 5B should extract safe flow-test orchestration from MCP into a reusable service while preserving these distinctions:

```text
real trigger evidence
!=
mock/sample trigger data
```

Testing must remain separate from publishing and activation.

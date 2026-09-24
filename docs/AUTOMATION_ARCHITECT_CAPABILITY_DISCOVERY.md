# Automation Architect — Activepieces Capability Discovery Adapter

## Purpose

Phase 4A connects the provider-neutral planner to **real Activepieces capability metadata** without allowing the planner to reach into Activepieces internals directly.

The boundary is:

```text
human automation goal
        |
        v
Activepieces tool search
        |
        v
project-scoped piece metadata verification
        |
        v
deterministic risk + connection mapping
        |
        v
PlannerCapability[]
        |
        v
provider-neutral planner
```

This phase still does **not** create, mutate, test, publish, activate, or execute a flow.

## Sources of truth

### Discovery ranking

`toolSearchService.searchActions/searchTriggers`

This already provides:

- semantic search when embeddings are available;
- keyword fallback when embeddings are unavailable/fail;
- platform/project piece visibility filtering;
- connection availability hints.

### Component verification

Search results are not trusted by themselves.

Every candidate is resolved again with:

```text
pieceMetadataService.get({
  name,
  platformId,
  projectId
})
```

The explicit `projectId` is intentional. It ensures project-scoped piece/component visibility is enforced during metadata resolution.

### Risk classification

For actions, Activepieces' existing deterministic `classification` is authoritative:

| Activepieces classification | Automation Architect risk |
| --- | --- |
| READ | READ_ONLY |
| SEARCH | READ_ONLY |
| WRITE | SENSITIVE_MUTATION |
| DESTRUCTIVE | DESTRUCTIVE |
| missing | SENSITIVE_MUTATION |

`WRITE` and unclassified actions are intentionally conservative. A later deterministic classifier may narrow known writes into `REVERSIBLE_WRITE`, `EXTERNAL_COMMUNICATION`, or `FINANCIAL`, but an LLM must never lower the risk class.

Triggers do not carry action risk because discovery itself does not execute the trigger.

## Stable capability IDs

The adapter emits IDs shaped as:

```text
activepieces:trigger:<pieceName>:<triggerName>
activepieces:action:<pieceName>:<actionName>
```

These IDs are planner-facing references only. The Phase 4B compiler will parse/resolve them back to exact Activepieces piece components.

## Connection behavior

When a capability requires authentication:

- `connected: true` → available;
- `connected: false` or unresolved → unavailable.

This is fail-safe. The planner must ask for connection setup rather than assuming credentials exist.

## Stale-index safety

A search result is discarded when:

- the piece no longer exists;
- the piece is not visible to the project;
- the action/trigger no longer exists after metadata resolution.

The adapter returns a structured issue rather than fabricating a capability.

## Search degradation

Keyword fallback is allowed, but surfaced as a `SEARCH_DEGRADED` issue so callers know relevance quality is lower.

## Deliberate non-goals

Phase 4A does not:

- resolve dynamic input-property schemas;
- select a concrete connection externalId;
- classify WRITE actions into domain-specific sub-risks;
- create Activepieces flows;
- execute actions;
- expose a new public HTTP endpoint.

The first consumer can call the server service internally. Public API shape should wait until the planner + compiler lifecycle is clearer.

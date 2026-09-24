# Automation Architect Core

Provider-neutral contracts for turning a human automation goal into an explicit, validated automation plan.

This package intentionally does **not** depend on Activepieces flow/runtime, server, pieces, MCP, or web code. Runtime-specific compilation belongs in an adapter outside this package.

## Automation IR V1

V1 models an automation as:

```text
trigger
  ↓
acyclic control-flow graph
  ↓
action / condition / AI decision / approval gate / notification
```

Supported trigger kinds:

- `MANUAL`
- `SCHEDULE`
- `EVENT`

Supported step kinds:

- `ACTION`
- `CONDITION`
- `AI_DECISION`
- `APPROVAL_GATE`
- `NOTIFICATION`

Values can contain explicit references to trigger output or step output.

V1 deliberately has no implicit loop/cycle primitive. Control-flow cycles are rejected rather than guessing whether a cycle is intentional.

## Validation guarantees

The V1 parser rejects, among other things:

- unknown schema versions;
- unknown fields;
- duplicate step IDs;
- missing control-flow targets;
- unreachable steps;
- control-flow cycles;
- malformed reference-shaped values;
- references to unknown steps;
- self-references;
- runtime-output references inside trigger configuration;
- invalid unary/binary condition shapes;
- duplicate AI decision route keys.

These checks validate the provider-neutral plan. Runtime adapters must still perform their own capability, credential, provider and execution validation.

## Versioning and migrations

`schemaVersion` is part of the serialized contract.

Rules:

1. Planners emit the latest known IR version.
2. Parsers never silently reinterpret an unknown version.
3. Once an IR version is persisted or used outside this package, breaking serialized-shape or semantic changes require a new schema version.
4. Backward-compatible implementation fixes that do not change the serialized contract may stay within the same version.
5. Future versions should be added as separate schemas rather than mutating V1 in place.
6. When V2 exists, migration must be explicit, testable and directional, for example:

```text
unknown input
   ↓
recognize V1
   ↓
migrate V1 → V2
   ↓
validate V2
```

7. Runtime-specific fields must not be introduced merely to make one compiler easier. They belong in the compiler/adapter.

## Policy separation

Risk metadata describes potential impact. It does not authorize an action.

Authorization policy is represented separately by `AutomationPolicy` and produces explicit policy decisions such as:

- `ALLOW`
- `REQUIRE_APPROVAL`
- `DENY`

A planner must not be able to grant itself permission for a destructive, sensitive, financial, or otherwise restricted action.

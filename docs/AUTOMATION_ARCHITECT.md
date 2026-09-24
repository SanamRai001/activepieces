# Automation Architect

## Status

Working product/architecture direction for this fork. The name **Automation Architect** is temporary; no rebrand is committed yet.

## Problem

Most automation tools assume the user already understands the workflow they want to build.

Real users often start with a messier statement:

> "I keep repeating this process. I want the system to handle what it safely can and ask me only when judgment is required."

The product opportunity is not merely **natural language -> workflow nodes**. It is:

```text
human problem
-> understand the existing process
-> discover automation opportunities
-> identify triggers, state, decisions and integrations
-> separate deterministic logic from AI reasoning
-> identify approval boundaries and failure modes
-> produce an executable automation
-> validate it
-> run it
-> observe, recover and escalate when necessary
```

## Product promise

A user should be able to describe an outcome in normal language.

The system should determine:

- what should trigger the automation;
- what information is required;
- which existing integrations/tools can satisfy it;
- which decisions should be deterministic;
- where AI reasoning is genuinely useful;
- which actions require human approval;
- how state is persisted;
- how retries, idempotency, timeouts and partial failures are handled;
- how the workflow should be tested before activation;
- when the system should stop and ask the user.

## Why Activepieces

Activepieces already provides most of the execution infrastructure that would otherwise take a large amount of time to reproduce:

- versioned flows;
- triggers/actions;
- loops and branches;
- retries;
- human-in-the-loop primitives;
- hundreds of integrations ("pieces");
- MCP support;
- agents with piece tools, flow tools and MCP tools;
- an execution engine and workers;
- a visual builder;
- AI routing and AI steps.

The fork should therefore treat Activepieces primarily as the **workflow runtime and integration ecosystem**, not as code to rewrite.

## Differentiator

Activepieces can execute workflows and agents.

Automation Architect should focus on the layer above that runtime:

```text
Natural-language problem
        |
        v
Intent / process understanding
        |
        v
Automation design
        |
        v
Automation IR
        |
        +--> safety + approval analysis
        |
        +--> capability / integration selection
        |
        v
Activepieces compiler / adapter
        |
        v
Existing Activepieces runtime
        |
        v
Supervisor / observability / recovery
```

The architectural boundary matters: intelligence that belongs to Automation Architect should not be unnecessarily coupled to Activepieces-specific flow structures.

## Core components

### 1. Conversational intake

Turns an imprecise request into a structured problem description.

It should avoid excessive questioning. It asks only for information that materially changes the automation or its safety.

Example:

> "Every Friday summarize what I accomplished across my coding projects and email it to me."

The intake layer should infer obvious details and ask only about material ambiguity such as which repositories count or whether uncommitted work matters.

### 2. Capability discovery

Resolves what the platform can actually do using:

- installed Activepieces pieces;
- available actions and triggers;
- existing user connections;
- MCP servers;
- reusable flows;
- supported internal platform capabilities.

The planner must never invent integrations or capabilities.

### 3. Automation IR

Automation Architect needs its own provider-neutral intermediate representation.

Illustrative shape:

```json
{
  "goal": "Notify me when an important customer has not received a reply",
  "trigger": {
    "type": "schedule",
    "interval": "1h"
  },
  "inputs": [
    {
      "capability": "email.read"
    }
  ],
  "steps": [
    {
      "type": "ai_decision",
      "purpose": "classify whether the conversation belongs to an important customer"
    },
    {
      "type": "condition",
      "expression": "unansweredForHours >= 24"
    },
    {
      "type": "action",
      "capability": "notification.send"
    }
  ],
  "approval": {
    "required": false
  }
}
```

The exact schema will be designed and versioned before runtime compilation is implemented.

### 4. Planner

Transforms intent + available capabilities into Automation IR.

The planner should prefer the simplest reliable design.

Priority:

```text
deterministic rule
> existing reusable flow
> ordinary integration action
> AI classification/reasoning
> browser automation
```

AI should not be used for logic that can be expressed safely and exactly with normal code or conditions.

### 5. Risk and approval engine

The planner does not get final authority over risky actions.

A separate policy layer classifies operations and determines whether approval is required.

Initial conceptual risk classes:

| Class | Examples | Default |
| --- | --- | --- |
| Read-only | search email, fetch issue, read sheet | allow |
| Reversible write | create draft, add label | allow or configurable |
| External communication | send email/message, publish post | preview/approval depending on policy |
| Sensitive mutation | permissions, credentials, account settings | approval |
| Destructive | delete data, force overwrite, branch deletion | approval |
| Financial | purchase, transfer, billing changes | approval |

The user must remain in control of high-impact actions.

### 6. Activepieces compiler

Converts validated Automation IR into Activepieces-native flow definitions.

This should be an adapter boundary rather than leaking Activepieces structures through the planner.

Long-term:

```text
Automation IR
  |- Activepieces compiler
  |- GitHub Actions compiler
  |- browser automation adapter
  |- direct Node/worker adapter
  '- other runtimes
```

Only Activepieces is in the initial scope.

### 7. Validator / simulator

Before activation, validate:

- referenced capabilities exist;
- required connections are available;
- trigger configuration is valid;
- required fields are resolved;
- branches are reachable;
- destructive actions have approval gates;
- duplicate execution is handled where necessary;
- retries will not accidentally repeat unsafe actions;
- generated flow structure is accepted by Activepieces.

Where possible, run a dry-run using sample data.

### 8. Runtime supervisor

Execution should be observable after creation.

The supervisor handles:

```text
success -> record
recoverable failure -> retry/repair policy
ambiguous failure -> pause
approval required -> ask user
repeated failure -> escalate
completed objective -> notify if useful
```

The supervisor must have loop limits and should not allow endless AI self-repair.

## First vertical: coding-project supervision

The first real automation should solve the workflow that motivated this project.

Example request:

> "Keep my coding project moving phase by phase. Verify each phase before continuing. If the agent gets stuck, try safe recovery. If it needs an architecture decision or a destructive action, notify me and pause."

Possible state machine:

```text
WORKING
  |
  v
EVALUATING
  |
  +--> CONTINUE
  +--> VERIFY
  +--> REPAIR
  +--> RETRY
  +--> NEED_USER
  +--> COMPLETE
```

Repository state, tests and git should be treated as stronger evidence than chat history.

A project may expose a human-readable `docs/PROJECT_STATE.md` and later a machine-readable state file if needed.

Browser/ChatGPT automation is intentionally **not** the first implementation. The initial vertical should use a coding-agent/runtime interface where possible. A browser adapter can be added later.

## Upstream and licensing boundaries

The fork originates from `activepieces/activepieces`.

The repository root license states:

- most Community Edition content is MIT-licensed;
- `packages/ee/` is covered by Activepieces' Enterprise License;
- `packages/server/api/src/app/ee` is covered by the Enterprise License.

Project-specific work should stay outside Enterprise-licensed paths unless there is an explicit reason and the relevant license permits the intended use.

Initial likely locations:

```text
packages/core/automation-architect/          # provider-neutral types/planning primitives
packages/server/api/src/app/automation-architect/
packages/web/src/features/automation-architect/
```

Those are proposals only. Phase 1 must verify the existing dependency boundaries before adding packages or production code.

## Upstream strategy

This fork is based on a fast-moving upstream. To reduce merge pain:

- minimize edits to existing core files;
- prefer additive modules and narrow adapters;
- avoid broad formatting/rebranding changes;
- keep upstream behavior working;
- isolate Automation Architect features behind clear boundaries;
- periodically compare the fork against `activepieces/activepieces:main`;
- document any intentional divergence.

## Non-goals for the first MVP

Do not initially build:

- a replacement workflow runtime;
- a new integrations marketplace;
- a general browser-control framework;
- autonomous financial/destructive actions;
- automatic optimization of every existing user workflow;
- cross-runtime compilation beyond Activepieces;
- full self-learning from desktop activity.

These may become later experiments only after the core architecture is proven.

## Roadmap

### Phase 0 — Foundation

- inspect fork and licensing boundaries;
- inspect existing agents, flows, MCP and AI routing capabilities;
- define product boundary and architecture;
- establish project-state documentation.

### Phase 1 — Runtime integration map

Trace the minimum Activepieces internals needed to programmatically create and validate a flow:

- flow schema/types;
- flow creation/update APIs;
- trigger/action metadata resolution;
- piece capability discovery;
- existing MCP flow-building tools;
- validation/execution path.

Deliverable: documented integration map and chosen extension points. No broad feature coding.

### Phase 2 — Automation IR

Implement a versioned TypeScript schema and validator for a small subset:

- schedule/webhook/manual trigger;
- action;
- condition;
- AI decision;
- approval gate;
- notification.

Add focused unit tests.

### Phase 3 — Natural-language planner prototype

Given:

- a user goal;
- available capabilities;
- policy settings;

produce valid Automation IR.

Initially output only the plan; do not execute generated automations.

### Phase 4 — Activepieces compiler

Compile the supported IR subset into an Activepieces flow draft.

Generated flows remain disabled/draft until validated and approved.

### Phase 5 — Validation and simulation

Add structural validation, missing-connection detection, safety checks and dry-run/sample execution where supported.

### Phase 6 — Safe activation

Allow approved generated flows to become executable with explicit auditability and policy enforcement.

### Phase 7 — Coding-project supervisor

Use the framework to implement the first vertical:

- phase-aware continuation;
- verification gates;
- retry/repair limits;
- repository/project-state awareness;
- human escalation.

### Phase 8 — Notifications and recovery

Add useful completion/intervention notifications and durable recovery behavior.

### Phase 9 — Browser adapter

Only after the supervisor works through stable runtime interfaces, experiment with browser/ChatGPT observation as an optional adapter.

### Phase 10 — Generalization

Evaluate additional runtimes and automation-discovery features based on evidence from the first vertical.

## Success criteria for the first meaningful prototype

A user can describe a bounded automation in natural language and the system can:

1. identify the required capabilities;
2. generate valid Automation IR;
3. explain the planned automation in understandable terms;
4. identify risky steps and approval requirements;
5. compile the plan into an Activepieces draft flow;
6. validate the draft without silently inventing unavailable tools;
7. keep the user in control before activation.

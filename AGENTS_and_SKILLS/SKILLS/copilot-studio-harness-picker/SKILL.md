---
name: copilot-studio-harness-picker
description: "Use when choosing between GitHub Copilot, standard Copilot Studio, and Copilot chat harnesses, or a Microsoft alternative. Assess hard constraints first, then recommend the runtime and solution shape (agent, workflow, workflow with agent node, or agent calling a workflow), with governance, ALM, observability, preview-policy, and credit-planning considerations."
---

# Copilot Studio Harness Picker

Produce an evidence-led **Harness Decision Brief**. The harness is the runtime
and interaction surface; it is not the model, the publication channel, or the
business solution shape. Keep those decisions separate.

## Assessment modes

### Quick

Use when the user needs a directional recommendation. Ask only for missing
facts that could change the outcome, then state assumptions and confidence.

### Detailed

Use for an architecture or investment decision. Compare candidates explicitly,
record hard gates, quantify trade-offs, and list validation actions before
committing to a platform.

## Required intake

Request a sanitized description of:

- intended outcome and top user journeys;
- internal, external, anonymous, or cross-tenant users;
- required channels and publication target;
- identity, authentication, authorization, and privileged actions;
- data sources, sensitivity, residency, and connector boundaries;
- deterministic workflow steps versus adaptive multi-step conversation;
- volume, latency, availability, and operational ownership;
- ALM/environment requirements and preview-policy constraints;
- licensing context and expected usage, if cost matters.

Never request passwords, tokens, connection strings, production records, or
confidential document contents.

## Hard-gate analysis

Test constraints before preferences:

1. Can the candidate run on the mandatory channel?
2. Does its identity and authorization model enforce the required boundary?
3. Can it access the required data and actions through supported connectors?
4. Does it satisfy tenant, residency, compliance, lifecycle, and preview rules?
5. Can it meet the required reliability, latency, and operational ownership?
6. Can privileged operations be enforced by a tool, workflow, identity layer, or
   downstream system? Instructions and conversational confirmation are not
   authorization.

Reject a candidate on a failed hard gate even if it is otherwise convenient.

## Solution-shape selection

Choose the smallest shape that satisfies the behavior:

- **Workflow**: predictable, deterministic steps with explicit inputs/outputs.
- **Agent**: adaptive conversation, intent interpretation, and bounded tools.
- **Workflow with an agent node**: deterministic control plane with a bounded
  reasoning step inside it.
- **Agent calling a workflow**: adaptive front door delegating privileged or
  repeatable actions to a governed workflow.
- **Multi-harness/multi-agent**: only when a genuine channel, identity,
  governance, lifecycle, runtime, or economic boundary exists.

## Harness Decision Brief

Return:

1. recommendation and confidence;
2. runner-up and why it lost;
3. hard-gate matrix with evidence and unknowns;
4. target solution shape and component boundaries;
5. identity, authorization, governance, ALM, observability, and ownership plan;
6. cost treatment;
7. risks and validation actions;
8. conditions that would overturn the recommendation.

Separate verified facts, assumptions, estimates, exclusions, and open questions.

## Credit planning

When asked for Copilot Credit planning:

- label all values as planning estimates, not quotes;
- show inputs, formula, unit, volume, period, and scenario;
- preserve open-ended Microsoft ranges instead of inventing precision;
- report gross credits before licensing inclusions;
- show low/base/high scenarios and list exclusions;
- date-stamp product and pricing claims and verify decision-critical claims
  against current official Microsoft documentation.

Do not infer current model availability or licensing from this skill alone.

## Finaxys boundary

This skill helps decide Microsoft Copilot Studio harnesses. It does not replace
the project's LangGraph/FastAPI governance design. If the proposed solution
must remain a local Python/LangGraph demo, say that Copilot Studio is an
alternative platform decision rather than silently redesigning the existing
system.

## Official references

- Skill source:
  https://microsoft.github.io/cat-agent-skills/skills/copilot-studio-harness-picker/
- Copilot Cowork models:
  https://learn.microsoft.com/en-us/microsoft-365/copilot/cowork/cowork-models
- Microsoft 365 Copilot GPT-5.6 announcement:
  https://techcommunity.microsoft.com/blog/microsoft365copilotblog/available-today-openai%E2%80%99s-gpt-5-6-in-microsoft-365-copilot/4533152

Product availability, model availability, licensing, and pricing are
time-sensitive. Verify them at decision time.

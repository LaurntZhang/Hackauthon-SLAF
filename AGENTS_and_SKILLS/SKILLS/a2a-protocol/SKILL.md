---
name: a2a-protocol
description: "Use when designing or implementing Agent2Agent (A2A) communication: Agent Cards, discovery, send_task, task status, coordinator/specialist orchestration, authentication, delegation scope, and secure deployment. Adapt examples to FastAPI and LangGraph when the project is not using Google ADK."
---

# A2A Protocol

Use this skill to connect independently deployable agents through explicit,
typed contracts. A2A is an interoperability boundary, not a replacement for
the local LangGraph workflow.

## Operating rules

1. Start with an Agent Card describing identity, endpoint, capabilities,
   authentication requirements, supported input/output modes, and version.
2. Use a coordinator for routing and policy enforcement; specialist agents
   must not silently expand their mandate.
3. Treat task IDs, correlation IDs, deadlines, and idempotency keys as
   mandatory for financial actions.
4. Keep the decision/intention separate from execution. A remote agent may
   return a `TransactionIntent`, but execution still requires local policy,
   audit, and HITL checks.
5. Never put secrets, private keys, or raw confidential payloads in an Agent
   Card or an audit event.

## Minimal Agent Card

```json
{
  "name": "risk-specialist",
  "description": "Scores synthetic transaction risk",
  "url": "http://risk-agent:8000/a2a",
  "version": "1.0.0",
  "capabilities": {
    "streaming": false,
    "pushNotifications": false
  },
  "skills": [
    {
      "id": "transaction-risk",
      "name": "Transaction risk assessment",
      "inputModes": ["application/json"],
      "outputModes": ["application/json"]
    }
  ],
  "authentication": {"schemes": ["bearer"]}
}
```

## Task lifecycle

Model the lifecycle explicitly:

`submitted -> working -> input-required -> completed | failed | canceled`

Every request should carry:

```python
from pydantic import BaseModel, Field


class A2ATaskRequest(BaseModel):
    task_id: str
    correlation_id: str
    idempotency_key: str
    skill_id: str
    input: dict[str, object]
    deadline_epoch_ms: int = Field(gt=0)
```

The receiver validates the skill, scope, deadline, and payload before invoking
its graph. Duplicate idempotency keys return the original result and must not
execute the action twice.

## Coordinator pattern

1. Discover or load the specialist's Agent Card.
2. Validate the coordinator's mandate and the requested skill.
3. Send a task with a bounded deadline and correlation ID.
4. Poll or receive the task result; verify its schema and provenance.
5. Record `who`, `what`, `when`, `why`, and `status` in the audit trail.
6. Route sensitive results to `interrupt()` before execution.

## Security checklist

- Authenticate service-to-service calls and authorize the requested skill.
- Use TLS in deployment; rotate credentials outside source control.
- Enforce payload size, timeout, retry, and recursion limits.
- Prevent SSRF when consuming remote Agent Cards.
- Treat remote output as untrusted data; validate with Pydantic.
- Make retries safe with idempotency and explicit cancellation.
- Redact account identifiers and personal data from traces.

## Framework adaptation

The source pattern is commonly demonstrated with Google ADK. This repository
uses FastAPI, Pydantic and LangGraph, so implement the A2A boundary as an
adapter around a compiled graph. Do not add ADK solely to copy an example.

## References

- Original catalog entry:
  https://skillselion.com/skills/majiayu000/claude-skill-registry/a2a-patterns
- A2A protocol documentation should be checked for the deployed protocol
  version before production integration.

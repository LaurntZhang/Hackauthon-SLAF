---
name: langchain
description: "Use when building LangChain agents, tools, structured output, middleware, human-in-the-loop controls, or retrieval-augmented generation. Covers create_agent, tool contracts, Pydantic schemas, middleware boundaries, and grounded RAG."
---

# LangChain

Use LangChain for model/tool composition and retrieval. Use LangGraph when the
workflow needs durable state, explicit branching, checkpoints, or pauses.

## Fundamentals

1. Define the tool contract before the prompt.
2. Validate all tool inputs and outputs with Pydantic.
3. Keep tools narrow, deterministic where possible, and observable.
4. Use `create_agent` for a bounded agent loop; use LangGraph for a workflow
   whose state transitions are part of the business contract.
5. Keep credentials in environment configuration, never in prompts or source.

```python
from pydantic import BaseModel, Field
from langchain.tools import tool


class RiskInput(BaseModel):
    amount: float = Field(gt=0)
    currency: str


@tool(args_schema=RiskInput)
def assess_risk(amount: float, currency: str) -> str:
    """Return a deterministic first-pass risk classification."""
    return "review" if amount >= 10_000 else "nominal"
```

## Structured output

Define a Pydantic result such as `TransactionIntent` with bounded enums,
justification, source references, and a confidence or risk score. Treat
structured output as untrusted until business validators have checked it.

## Middleware and HITL

Middleware may enforce authorization, redact data, trace calls, retry safe
operations, or interrupt before a sensitive tool. Do not rely on middleware
alone for financial authorization: repeat critical checks in the execution
boundary and write an audit event for allow, deny, and error paths.

## RAG

Use a pipeline with explicit stages:

`load -> split -> embed -> index -> retrieve -> filter -> generate -> cite`

- Preserve source IDs and retrieval metadata.
- Apply access control before retrieval, not after generation.
- Set a relevance threshold and define the empty-context behavior.
- Require citations or source IDs for compliance-sensitive answers.
- Test retrieval separately from generation.

## Relationship to this project

LangChain components may support model calls, tools, or retrieval in this
repository. LangGraph remains the preferred orchestration layer for mandate
checks, `interrupt()` and checkpointed transaction state.

## References

- Fundamentals:
  https://claudemarketplaces.com/skills/langchain-ai/langchain-skills/langchain-fundamentals
- Middleware:
  https://claudemarketplaces.com/skills/langchain-ai/langchain-skills/langchain-middleware
- RAG:
  https://claudemarketplaces.com/skills/langchain-ai/langchain-skills/langchain-rag

---
name: langgraph
description: "Use when implementing LangGraph StateGraph workflows, typed nodes and edges, reducers, persistence, checkpointing, thread IDs, LangGraph CLI projects, or durable human-in-the-loop execution."
---

# LangGraph

Use LangGraph for explicit, stateful, inspectable workflows. Every node should
have one responsibility, return a typed state update, and be independently
testable.

## Fundamentals

```python
from typing import Literal
from typing_extensions import TypedDict
from langgraph.graph import END, START, StateGraph


class State(TypedDict):
    status: Literal["pending", "approved", "rejected", "executed"]
    reasoning: str


def decide(state: State) -> dict[str, str]:
    return {"status": "approved", "reasoning": "Policy checks passed"}


builder = StateGraph(State)
builder.add_node("decide", decide)
builder.add_edge(START, "decide")
builder.add_edge("decide", END)
graph = builder.compile()
```

Prefer named routing functions over lambdas. Use reducers only when concurrent
updates are intentional; audit entries should be append-only and preserve order.

## Persistence and HITL

Compile with a checkpointer for any pause or resumable run. Pass the same
`thread_id` to initial and resume calls. Place `interrupt()` before side
effects because the node restarts from its beginning when resumed.

```python
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.types import Command, interrupt


def approval(state: State) -> dict[str, str]:
    decision = interrupt({"reason": "Human approval required"})
    return {"status": "approved" if decision["approved"] else "rejected"}


graph = builder.compile(checkpointer=InMemorySaver())
config = {"configurable": {"thread_id": "demo-transaction-1"}}
```

Use an in-memory saver for demos and a durable saver for production. Never
assume a process-local checkpointer survives a restart.

## CLI and deployment

Keep graph construction importable and expose a stable graph entry point for
the LangGraph CLI. Pin dependencies, define environment variables explicitly,
and include a health check and a deterministic mock mode for demos. Validate
the CLI configuration in CI before deployment.

## Governance checklist

- State has bounded statuses and a transaction identifier.
- Mandate and scope checks happen before intent creation or execution.
- Decision and execution are separate nodes.
- Sensitive paths pause for human approval.
- Audit entries contain agent, action, UTC timestamp, justification, and status.
- Resume and retry behavior is idempotent.
- Tests cover nominal, rejection, interruption/resume, malformed input, and
  recursion-limit paths.

## References

- Fundamentals:
  https://claudemarketplaces.com/skills/langchain-ai/langchain-skills/langgraph-fundamentals
- Persistence:
  https://claudemarketplaces.com/skills/langchain-ai/langchain-skills/langgraph-persistence
- CLI:
  https://claudemarketplaces.com/skills/langchain-ai/langchain-skills/langgraph-cli
- Existing HITL companion:
  `SKILLS/langgraph-human-in-the-loop/SKILL.md`

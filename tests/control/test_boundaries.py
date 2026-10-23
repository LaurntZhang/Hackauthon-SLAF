"""Frontières d'architecture vérifiées statiquement sur les imports."""

from __future__ import annotations

import ast
from pathlib import Path

import pytest

SRC = Path(__file__).resolve().parents[2] / "src"
LLM_MODULES = ("langchain", "langchain_core", "langgraph", "openai", "anthropic", "crewai", "src.agents")
MARKET_MODULES = ("src.simulation.market", "src.control.execution_gateway")


def imported_modules(path: Path) -> set[str]:
    tree = ast.parse(path.read_text(encoding="utf-8"))
    names: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            names.update(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module:
            names.add(node.module)
    return names


@pytest.mark.parametrize("path", sorted((SRC / "control").glob("*.py")), ids=lambda p: p.name)
def test_control_plane_imports_no_llm_nor_agent(path: Path) -> None:
    offending = {m for m in imported_modules(path) if m.startswith(LLM_MODULES)}
    assert not offending, f"{path.name} importe {offending}"


@pytest.mark.parametrize("path", sorted((SRC / "agents").glob("*.py")), ids=lambda p: p.name)
def test_agents_never_touch_the_market(path: Path) -> None:
    offending = {m for m in imported_modules(path) if m.startswith(MARKET_MODULES)}
    assert not offending, f"{path.name} importe {offending}"


@pytest.mark.parametrize("path", sorted((SRC / "agents").glob("*.py")), ids=lambda p: p.name)
def test_agents_never_import_each_other(path: Path) -> None:
    allowed = {"src.agents.llm", "src.agents.judging"}
    siblings = {m for m in imported_modules(path) if m.startswith("src.agents.") and m not in allowed}
    assert not siblings, f"{path.name} importe directement {siblings}"

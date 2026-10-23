"""Generate a small, governance-ready project skeleton."""

from __future__ import annotations

import argparse
from pathlib import Path


FILES = {
    "src/models/contracts.py": '"""Pydantic contracts for the demo."""\n',
    "src/graph/workflow.py": '"""LangGraph workflow entry point."""\n',
    "tests/test_governance.py": '"""Governance checks."""\n',
    "README.md": "# Finaxys multi-agent demo\n\nGenerated skeleton.\n",
}


def scaffold(destination: Path) -> None:
    """Create missing skeleton files without overwriting user work."""
    for relative_path, content in FILES.items():
        target = destination / relative_path
        target.parent.mkdir(parents=True, exist_ok=True)
        if not target.exists():
            target.write_text(content, encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("destination", type=Path)
    args = parser.parse_args()
    scaffold(args.destination)
    print(f"Skeleton ready: {args.destination}")


if __name__ == "__main__":
    main()

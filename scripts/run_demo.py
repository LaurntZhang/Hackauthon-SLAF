"""Plan B de démo : `python -m scripts.run_demo` exécute S1 à S6 hors ligne et affiche le verdict."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from src.control.hitl import DEMO_SECRET
from src.control.policy_config import load_policies
from src.graph.graph_runtime import FinGuardSystem, SharedServices
from src.simulation.scenarios import SCENARIOS, run_scenario

ROOT = Path(__file__).resolve().parents[1]


def main(argv: list[str] | None = None) -> int:
    """Exécute les scénarios demandés et retourne 0 si tous passent."""
    parser = argparse.ArgumentParser(description="Démo ManAgent / FinGuard hors ligne")
    parser.add_argument("scenarios", nargs="*", default=list(SCENARIOS), help="noms (défaut : tous)")
    parser.add_argument("--audit", type=Path, default=ROOT / "logs" / "demo-audit.jsonl")
    args = parser.parse_args(argv)

    shared = SharedServices.create(config=load_policies(), audit_path=args.audit, hitl_secret=DEMO_SECRET)
    system = FinGuardSystem(shared)
    failures = 0
    for name in args.scenarios:
        result = run_scenario(system, name, auto_approve=True)
        mark = "OK " if result.passed else "KO "
        failures += 0 if result.passed else 1
        statuses = ", ".join(step.status for step in result.steps) or "-"
        print(f"[{mark}] {result.code} {result.title}")
        print(f"       attendu : {result.expected}")
        print(f"       statuts : {statuses}")
        for key, value in result.details.items():
            print(f"       {key} : {value}")
    verification = shared.chain.verify()
    print(
        f"\nJournal {args.audit.name} : {'valide' if verification.valid else 'ALTÉRÉ'} "
        f"({verification.checked_lines} lignes)"
    )
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())

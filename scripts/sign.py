"""Calcule une signature HMAC de démo pour `/approvals` ou les commandes d'opérateur.

Exemples :
    python -m scripts.sign approval --thread thr-123 --action approve \
        --approver risk_officer_1 --intent-hash <hash>
    python -m scripts.sign control --command circuit_breaker.rearm --target main --operator ops_officer_1
"""

from __future__ import annotations

import argparse
import json
import os
import sys

from src.control.hitl import DEMO_SECRET, approval_message, canonical_timestamp, control_message, sign
from src.models.finguard_contracts import utc_now


def main(argv: list[str] | None = None) -> int:
    """Affiche le JSON prêt à envoyer (signature et timestamp inclus)."""
    parser = argparse.ArgumentParser(description="Signature HMAC de démonstration")
    sub = parser.add_subparsers(dest="kind", required=True)
    approval = sub.add_parser("approval")
    approval.add_argument("--thread", required=True)
    approval.add_argument("--action", choices=["approve", "reject", "report"], required=True)
    approval.add_argument("--approver", required=True)
    approval.add_argument("--intent-hash", required=True)
    control = sub.add_parser("control")
    control.add_argument(
        "--command",
        required=True,
        choices=["kill_switch.release", "circuit_breaker.rearm", "quarantine.release"],
    )
    control.add_argument("--target", required=True, help="global:* | agent:<id> | <runtime_id> | <agent_id>")
    control.add_argument("--operator", required=True)
    args = parser.parse_args(argv)

    secret = os.getenv("FINGUARD_HITL_SECRET", DEMO_SECRET)
    timestamp = utc_now().replace(microsecond=0)
    if args.kind == "approval":
        message = approval_message(
            thread_id=args.thread,
            action=args.action,
            approver_id=args.approver,
            intent_hash=args.intent_hash,
            timestamp=timestamp,
        )
        body = {"action": args.action, "approver_id": args.approver}
    else:
        message = control_message(
            command=args.command, target=args.target, operator_id=args.operator, timestamp=timestamp
        )
        body = {"operator_id": args.operator, "reason": "commande opérateur signée"}
    body |= {"signature": sign(secret, message), "timestamp": canonical_timestamp(timestamp)}
    print(json.dumps(body, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())

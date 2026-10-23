"""Print a five-minute demo schedule."""

from __future__ import annotations

import argparse
import time


SEGMENTS = (
    ("Accroche problème", 45),
    ("Cas d'usage et acteurs", 45),
    ("Architecture et contrôles", 60),
    ("Démo nominale puis HITL", 90),
    ("Réglementation et industrialisation", 45),
    ("Conclusion", 15),
)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--live", action="store_true", help="wait between segments")
    args = parser.parse_args()
    elapsed = 0
    for title, seconds in SEGMENTS:
        print(f"{elapsed // 60:02d}:{elapsed % 60:02d} - {title} ({seconds}s)")
        elapsed += seconds
        if args.live:
            time.sleep(seconds)
    print(f"Total: {elapsed // 60}:{elapsed % 60:02d}")


if __name__ == "__main__":
    main()

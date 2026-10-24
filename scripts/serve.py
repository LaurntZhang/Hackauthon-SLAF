"""Lance l'API en chargeant d'abord le .env : `python -m scripts.serve`.

Le projet n'embarque pas python-dotenv ; ce script lit `.env` (clés Mistral,
Langfuse, overrides FINGUARD_*) et le met dans l'environnement avant de démarrer
uvicorn, pour que `FINGUARD_LLM=on` active réellement l'intégration Mistral.
"""

from __future__ import annotations

import argparse
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def load_dotenv(path: Path) -> int:
    """Charge les paires KEY=VALUE d'un fichier .env sans écraser l'existant."""
    if not path.exists():
        return 0
    loaded = 0
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value
            loaded += 1
    return loaded


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Serveur API ManAgent / FinGuard")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--reload", action="store_true", help="rechargement auto (dev)")
    parser.add_argument("--env", type=Path, default=ROOT / ".env")
    args = parser.parse_args(argv)

    load_dotenv(args.env)

    import uvicorn

    uvicorn.run(
        "src.api.main:app",
        host=args.host,
        port=args.port,
        reload=args.reload,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

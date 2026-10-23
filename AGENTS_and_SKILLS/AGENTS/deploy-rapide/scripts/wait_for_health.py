"""Wait for an HTTP health endpoint with a bounded timeout."""

from __future__ import annotations

import argparse
import time
from urllib.error import URLError
from urllib.request import urlopen


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("url")
    parser.add_argument("--timeout", type=float, default=60)
    parser.add_argument("--interval", type=float, default=2)
    args = parser.parse_args()
    deadline = time.monotonic() + args.timeout
    while time.monotonic() < deadline:
        try:
            with urlopen(args.url, timeout=3) as response:
                if 200 <= response.status < 300:
                    print(f"Healthy: {args.url}")
                    return 0
        except (OSError, URLError):
            pass
        time.sleep(args.interval)
    print(f"Healthcheck timeout: {args.url}")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())

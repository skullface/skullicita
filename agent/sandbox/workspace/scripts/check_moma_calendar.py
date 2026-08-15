#!/usr/bin/env python3
"""Check MoMA Films calendar pages for listed events."""

from __future__ import annotations

import json
import os
import sys

from curl_cffi import requests as curl_requests

_IMPERSONATE_CANDIDATES = (
    "chrome131",
    "chrome124",
    "chrome136",
    "safari184",
    "chrome146",
)

EMPTY_MARKER = "No upcoming events"
BASE_URL = "https://www.moma.org/calendar/?happening_filter=Films&date="


def fail(message: str) -> None:
    print(json.dumps({"error": message}), file=sys.stderr)
    raise SystemExit(1)


def fetch_has_events(session: curl_requests.Session, date: str) -> bool:
    url = f"{BASE_URL}{date}"
    last_error: Exception | None = None

    for impersonate in _IMPERSONATE_CANDIDATES:
        try:
            response = session.get(url, impersonate=impersonate, timeout=30)
        except Exception as exc:  # noqa: BLE001
            last_error = exc
            continue

        if response.status_code != 200:
            last_error = RuntimeError(
                f"{date}: HTTP {response.status_code}"
            )
            continue

        text = response.text or ""
        if "Just a moment" in text or "challenge-platform" in text:
            last_error = RuntimeError(f"{date}: Cloudflare challenge")
            continue

        return EMPTY_MARKER not in text

    if last_error is not None:
        raise last_error
    raise RuntimeError(f"{date}: fetch failed")


def main() -> None:
    raw_dates = (os.environ.get("MOMA_WATCH_DATES") or "").strip()
    if not raw_dates:
        fail("Missing MOMA_WATCH_DATES")

    dates = [part.strip() for part in raw_dates.split(",") if part.strip()]
    if not dates:
        fail("MOMA_WATCH_DATES is empty")

    session = curl_requests.Session()
    results: list[dict[str, object]] = []

    for date in dates:
        try:
            has_events = fetch_has_events(session, date)
        except Exception as exc:  # noqa: BLE001
            fail(str(exc))
        results.append({"date": date, "hasEvents": has_events})

    print(json.dumps({"dates": results}))


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Match a currently-reading StoryGraph book by title and set page progress."""

from __future__ import annotations

import asyncio
import json
import os
import re
import sys
from pathlib import Path

VENDOR = Path(__file__).resolve().parents[1] / "vendor"
sys.path.insert(0, str(VENDOR))

from storygraph import StoryGraphClient  # noqa: E402
from storygraph.models.progress import ProgressType  # noqa: E402


def normalize_title(value: str) -> str:
    text = value.lower()
    text = re.sub(r"[\u0300-\u036f]", "", text)
    text = text.replace("&", " and ")
    text = re.sub(r"[^a-z0-9\s]", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def title_match_score(query: str, title: str) -> int:
    q = normalize_title(query)
    t = normalize_title(title)
    if not q or not t:
        return 0
    if q == t:
        return 100
    if q in t or t in q:
        return 85

    q_tokens = [tok for tok in q.split(" ") if len(tok) > 1]
    t_tokens = {tok for tok in t.split(" ") if len(tok) > 1}
    if not q_tokens:
        return 0

    overlap = sum(1 for tok in q_tokens if tok in t_tokens)
    if overlap == 0:
        return 0
    return round((overlap / len(q_tokens)) * 70)


def match_book(books: list, title_query: str):
    scored = sorted(
        ((title_match_score(title_query, book.title), book) for book in books),
        key=lambda row: row[0],
        reverse=True,
    )
    scored = [(score, book) for score, book in scored if score >= 50]
    if not scored:
        return ("none", None, [])

    best_score, best_book = scored[0]
    close = [book for score, book in scored if score >= best_score - 5]
    if len(close) > 1 and best_score < 100:
        return ("ambiguous", None, close)
    return ("match", best_book, [])


def book_payload(book) -> dict:
    return {
        "id": book.id,
        "title": book.title,
        "author": book.author,
        "progressPercent": book.user_progress,
    }


def fail(message: str) -> None:
    print(json.dumps({"error": message}), file=sys.stderr)
    raise SystemExit(1)


async def run() -> dict:
    cookie = (os.environ.get("STORYGRAPH_SESSION_COOKIE") or "").strip()
    cookie = re.sub(r"^_storygraph_session=", "", cookie, flags=re.I).strip()
    title = (os.environ.get("STORYGRAPH_TITLE") or "").strip()
    page_raw = (os.environ.get("STORYGRAPH_PAGE") or "").strip()

    if not cookie:
        fail("Missing STORYGRAPH_SESSION_COOKIE")
    if len(cookie) < 80:
        fail(
            f"STORYGRAPH_SESSION_COOKIE looks truncated (len={len(cookie)}; need ≥80). "
            "Copy the full `_storygraph_session` Value from browser DevTools → Application → Cookies."
        )
    if not title:
        fail("Missing STORYGRAPH_TITLE")
    if not page_raw.isdigit() or int(page_raw) < 1:
        fail("STORYGRAPH_PAGE must be a positive integer")

    page = int(page_raw)

    async with StoryGraphClient(session_cookie=cookie) as client:
        books = await client.get_currently_reading()
        if not books:
            fail("No books in Currently Reading on StoryGraph.")

        kind, book, candidates = match_book(books, title)
        if kind == "none":
            titles = "; ".join(b.title for b in books)
            fail(
                f'No currently-reading book matched "{title}". Currently reading: {titles}'
            )
        if kind == "ambiguous":
            titles = "; ".join(b.title for b in candidates)
            fail(
                f'Ambiguous title "{title}". Matches: {titles}. Be more specific.'
            )

        assert book is not None
        ok = await client.update_progress(
            book_id=book.id,
            progress=page,
            progress_type=ProgressType.PAGES,
        )
        if not ok:
            fail(f'StoryGraph progress update failed for "{book.title}".')

        return {
            "updated": True,
            "page": page,
            "book": book_payload(book),
        }


def main() -> None:
    try:
        result = asyncio.run(run())
    except SystemExit:
        raise
    except Exception as exc:  # noqa: BLE001
        fail(str(exc))

    print(json.dumps(result))


if __name__ == "__main__":
    main()

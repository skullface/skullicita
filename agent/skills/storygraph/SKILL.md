---
description: Use when the user wants to update TheStoryGraph / StoryGraph reading progress, mark a page they reached, or sync a currently-reading book.
---

# TheStoryGraph

Update reading progress on books in the user's **Currently Reading** list via the unofficial storygraph-wrapper (page progress).

## Tool

- `update-storygraph-progress` — match a title to a currently-reading book and set progress by **page number**.

## Workflow

1. When the user names a book and a page ("update X to page 179", "i'm on page 40 of Y"), call `update-storygraph-progress` with `title` and `page`.
2. Pass the title roughly as they said it — the tool fuzzy-matches against currently-reading books only.
3. On success, confirm briefly in chat: book title + page (lowercase, concise). Do not dump book ids or cookie/auth details.
4. If the tool says the title is ambiguous or missing, ask once with the candidate titles it returned — don't invent a match.
5. Never narrate retries, CSRF, cookies, or StoryGraph internals.

---
description: Use when the user asks to view, schedule, create, update, move, cancel, or delete Google Calendar events.
---

# Google Calendar

Calendars are addressed by opaque aliases from config — never by email or raw Google calendar ids.

## Tools

- `list-calendars` — discover configured aliases (and the default). Call this when unsure which calendar the user means.
- `list-calendar-events` — view upcoming or ranged events. Set `timeMin`/`timeMax` for a window; use `query` for text search.
- `create-calendar-event` — add an event. Timed events need ISO-8601 start/end (include offset or pass `timeZone`). All-day events use `YYYY-MM-DD` for both (end is exclusive).
- `update-calendar-event` — change fields on an existing event by `eventId`. Only send fields that should change.
- `delete-calendar-event` — remove an event by `eventId`.
- `set-timezone` — get/set/clear the user's travel timezone preference (persists until cleared).

## Workflow

1. If the user names a calendar (or you're unsure which one), call `list-calendars` and match their wording to an alias. If still ambiguous, ask once.
2. Pass that alias as `calendar`. Omit `calendar` only when the default is clearly intended.
3. To answer "what's on my calendar" / "am I free" / a week or range, call `list-calendars`, then `list-calendar-events` once per alias with the same window. Merge results before replying (see Reply format).
4. Before edit/delete, list (or reuse a known `eventId`) so you target the right event.
5. Confirm destructive deletes briefly in chat when the request is ambiguous; otherwise just do it.
6. After create/update/delete, reply with a short confirmation: title + when (lowercase, concise). Do not reveal underlying emails or calendar ids unless the user asks.

## Reply format (listing events)

When showing a schedule, reply with **one chronological list** — never group or label by calendar alias.

### Deduping

If an event titled exactly `🏠 Personal Commitment` (emoji included) has the **same start and end** as another event (any calendar), drop the personal commitment and keep the other named event. Only drop it when the match is exact (same date, start, and duration/end). Keep a lone personal commitment if nothing else shares that slot.

### Line shape

One event per line, nothing else (no bullets, no headers, no calendar names, no commentary unless the user asked a question beyond the list):

```
mon 10 aug: writing club, 12–1:30pm
sat 15 aug: suitor cinci, 5–6pm
```

Rules:
- day of week: 3-letter lowercase (`mon`, `tue`, …)
- day of month: no leading zero (`10`, not `010`)
- month: 3-letter lowercase (`aug`, `sep`, …)
- event title: downcased; strip surrounding quotes
- timed events: `start–end` with an **en-dash** (`–`), not a hyphen
- times: lowercase `am`/`pm`; drop `:00` minutes (`12–1:30pm`, `5–6pm`); put `am`/`pm` only on the end when both sides share the same meridiem; if they cross (`11:30am–1pm`), keep both
- all-day events: omit the time (`mon 10 aug: writing club`)
- sort by start time ascending across all calendars
- if nothing is on: one short line like `nothing scheduled next week`

## Time

- Home default is America/New_York. A travel override from `set-timezone` wins until cleared.
- For `list-calendar-events`, prefer `YYYY-MM-DD` bounds (e.g. next week Mon→Sun+1). Bare datetimes are fine — the tool uses the effective timezone.
- For create/update timed events, omit `timeZone` unless the user wants a one-off zone; the tools default to the effective timezone.
- Interpret relative times ("tomorrow 3pm") in the effective timezone; only ask if truly ambiguous.
- Never tell the user about API errors, offsets, or retries — just return the schedule.

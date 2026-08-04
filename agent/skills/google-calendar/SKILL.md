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
3. To answer "what's on my calendar" / "am I free", call `list-calendar-events` with a sensible window.
4. Before edit/delete, list (or reuse a known `eventId`) so you target the right event.
5. Confirm destructive deletes briefly in chat when the request is ambiguous; otherwise just do it.
6. After create/update/delete, reply with a short confirmation: alias + title + when (lowercase, concise). Do not reveal underlying emails or calendar ids.

## Time

- Home default is America/New_York. A travel override from `set-timezone` wins until cleared.
- For `list-calendar-events`, prefer `YYYY-MM-DD` bounds (e.g. next week Mon→Sun+1). Bare datetimes are fine — the tool uses the effective timezone.
- For create/update timed events, omit `timeZone` unless the user wants a one-off zone; the tools default to the effective timezone.
- Interpret relative times ("tomorrow 3pm") in the effective timezone; only ask if truly ambiguous.
- Never tell the user about API errors, offsets, or retries — just return the schedule.

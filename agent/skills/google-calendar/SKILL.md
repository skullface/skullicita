---
description: Use when the user asks to view, schedule, create, update, move, cancel, or delete Google Calendar events.
---

# Google Calendar

Calendars are addressed by opaque aliases from config — never by email or raw Google calendar ids.

## Tools

- `list-schedule` — **prefer for any schedule listing** ("what's on", "am I free", today/week/range). Fetches every alias, dedupes, and returns ready-to-send `text`.
- `list-calendars` — discover configured aliases (and the default). Call when unsure which calendar the user means for create/update/delete.
- `list-calendar-events` — one alias only (edits, targeted lookup). Prefer `list-schedule` for listings.
- `create-calendar-event` — add an event. Timed events need ISO-8601 start/end (include offset or pass `timeZone`). All-day events use `YYYY-MM-DD` for both (end is exclusive).
- `update-calendar-event` — change fields on an existing event by `eventId`. Only send fields that should change.
- `delete-calendar-event` — remove an event by `eventId`.
- `set-timezone` — get/set/clear the user's travel timezone preference (persists until cleared).

## Workflow

1. **Listing / free-busy / week-or-range:** call `list-schedule` once with the window (`YYYY-MM-DD` bounds). Optional `emptyMessage` like `nothing scheduled next week`. Then reply with **exactly** the returned `text` — character-for-character, nothing else.
2. If the user names a calendar for create/update/delete (or you're unsure), call `list-calendars` and match their wording to an alias. If still ambiguous, ask once.
3. Pass that alias as `calendar`. Omit `calendar` only when the default is clearly intended.
4. Before edit/delete, list (or reuse a known `eventId`) so you target the right event.
5. Confirm destructive deletes briefly in chat when the request is ambiguous; otherwise just do it.
6. After create/update/delete, reply with a short confirmation: title + when (lowercase, concise). Do not reveal underlying emails or calendar ids unless the user asks.

## Reply format (listing events)

**Hard rule — overrides the usual chat voice.** For schedule listings:

1. Call `list-schedule` (never loop `list-calendar-events` per alias for a listing).
2. Your entire reply is the `text` field only.
3. Do not rewrite, re-case, re-time, add headers, calendar aliases, bullets, bold, empty-day fillers, conflict warnings, or wrap-up questions.

`text` already looks like:

```
mon 10 aug: busy 11:30am–12pm | writing club 12–1:30pm | busy 2–2:30pm, busy 3–4pm
tue 11 aug: busy 11am–12pm
sat 15 aug: suitor cinci 5–6pm
```

Paste `text` from `list-schedule` as is.


## Time

- Home default is America/New_York. A travel override from `set-timezone` wins until cleared.
- For `list-schedule` / `list-calendar-events`, prefer `YYYY-MM-DD` bounds (e.g. next week Mon→Sun+1). Bare datetimes are fine — the tools use the effective timezone.
- For create/update timed events, omit `timeZone` unless the user wants a one-off zone; the tools default to the effective timezone.
- Interpret relative times ("tomorrow 3pm") in the effective timezone; only ask if truly ambiguous.
- Never tell the user about API errors, offsets, or retries — just return the schedule.

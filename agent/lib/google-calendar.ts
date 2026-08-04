import { google, type calendar_v3 } from "googleapis";

const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar";

export type CalendarEvent = {
  id: string;
  status: string | null;
  summary: string | null;
  description: string | null;
  location: string | null;
  htmlLink: string | null;
  start: string | null;
  end: string | null;
  allDay: boolean;
  attendees: Array<{
    email: string;
    displayName: string | null;
    responseStatus: string | null;
  }>;
  recurringEventId: string | null;
};

export type ResolvedCalendar = {
  /** Opaque alias from GOOGLE_CALENDARS (never an email). */
  calendar: string;
  /** Google Calendar API id (email or calendar id). */
  calendarId: string;
};

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required env var ${name}`);
  }
  return value;
}

function parseServiceAccountKey(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    // Vercel sometimes stores the key as base64 to avoid multiline JSON pain.
    try {
      return JSON.parse(Buffer.from(raw, "base64").toString("utf8")) as Record<
        string,
        unknown
      >;
    } catch {
      throw new Error(
        "GOOGLE_SERVICE_ACCOUNT_KEY must be a JSON service account key (or base64-encoded JSON)",
      );
    }
  }
}

/** alias → Google calendar id. Aliases are opaque labels; ids stay in env only. */
export function getCalendarMap(): Record<string, string> {
  const raw = requireEnv("GOOGLE_CALENDARS");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(
      'GOOGLE_CALENDARS must be JSON like {"alpha":"…","beta":"…"}',
    );
  }

  if (
    parsed == null ||
    typeof parsed !== "object" ||
    Array.isArray(parsed)
  ) {
    throw new Error(
      'GOOGLE_CALENDARS must be a JSON object like {"alpha":"…","beta":"…"}',
    );
  }

  const map: Record<string, string> = {};
  for (const [alias, id] of Object.entries(parsed as Record<string, unknown>)) {
    const key = alias.trim();
    const value = typeof id === "string" ? id.trim() : "";
    if (!key || !value) {
      throw new Error(
        `GOOGLE_CALENDARS entry "${alias}" must map to a non-empty calendar id string`,
      );
    }
    map[key] = value;
  }

  if (Object.keys(map).length === 0) {
    throw new Error("GOOGLE_CALENDARS must include at least one calendar alias");
  }

  return map;
}

export function listCalendarAliases(): string[] {
  return Object.keys(getCalendarMap()).sort();
}

export function resolveCalendar(calendar?: string): ResolvedCalendar {
  const map = getCalendarMap();
  const aliases = Object.keys(map);

  const alias = calendar?.trim() || process.env.GOOGLE_CALENDAR_DEFAULT?.trim();
  if (!alias) {
    throw new Error(
      `No calendar alias provided and GOOGLE_CALENDAR_DEFAULT is not set. Pass one of: ${aliases.join(", ")}`,
    );
  }

  const calendarId = map[alias];
  if (!calendarId) {
    throw new Error(
      `Unknown calendar alias "${alias}". Configured aliases: ${aliases.join(", ")}`,
    );
  }

  return { calendar: alias, calendarId };
}

export function getCalendarClient() {
  const credentials = parseServiceAccountKey(
    requireEnv("GOOGLE_SERVICE_ACCOUNT_KEY"),
  );

  const subject = process.env.GOOGLE_IMPERSONATE_EMAIL?.trim();
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: [CALENDAR_SCOPE],
    // Optional Workspace domain-wide delegation.
    clientOptions: subject ? { subject } : undefined,
  });

  return google.calendar({ version: "v3", auth });
}

function eventTime(value?: calendar_v3.Schema$EventDateTime | null): {
  instant: string | null;
  allDay: boolean;
} {
  if (!value) return { instant: null, allDay: false };
  if (value.dateTime) return { instant: value.dateTime, allDay: false };
  if (value.date) return { instant: value.date, allDay: true };
  return { instant: null, allDay: false };
}

/** Label used when a calendar only exposes free/busy (no event title). */
export const BUSY_SUMMARY = "busy";

/** Placeholder mirrored across calendars; dropped when a named event shares the slot. */
export const PERSONAL_COMMITMENT_SUMMARY = "🏠 Personal Commitment";

const EN_DASH = "\u2013";
const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
const MONTHS = [
  "jan",
  "feb",
  "mar",
  "apr",
  "may",
  "jun",
  "jul",
  "aug",
  "sep",
  "oct",
  "nov",
  "dec",
] as const;

function normalizeSummary(summary?: string | null): string {
  const trimmed = summary?.trim() ?? "";
  if (!trimmed || trimmed.toLowerCase() === BUSY_SUMMARY) return BUSY_SUMMARY;
  return trimmed;
}

function isPersonalCommitmentSummary(summary: string | null): boolean {
  if (!summary) return false;
  if (summary === PERSONAL_COMMITMENT_SUMMARY) return true;
  const normalized = summary
    .trim()
    .toLowerCase()
    .replace(/^🏠\s*/u, "")
    .trim();
  return normalized === "personal commitment";
}

function isBusySummary(summary: string | null): boolean {
  return (summary ?? "").trim().toLowerCase() === BUSY_SUMMARY;
}

function isPlaceholderSummary(summary: string | null): boolean {
  return isPersonalCommitmentSummary(summary) || isBusySummary(summary);
}

/** Instant range key so offset vs Z forms of the same slot still match. */
function slotKey(event: CalendarEvent): string {
  if (event.allDay) return `day:${event.start ?? ""}|${event.end ?? ""}`;
  const startMs = event.start ? Date.parse(event.start) : Number.NaN;
  const endMs = event.end ? Date.parse(event.end) : Number.NaN;
  if (Number.isNaN(startMs) || Number.isNaN(endMs)) {
    return `raw:${event.start ?? ""}|${event.end ?? ""}`;
  }
  return `t:${startMs}|${endMs}`;
}

/**
 * Drop placeholder / free-busy mirrors when another named event shares the
 * exact same start/end (`🏠 Personal Commitment` or `busy`).
 */
export function dedupePlaceholderEvents(
  events: CalendarEvent[],
): CalendarEvent[] {
  const occupied = new Set(
    events
      .filter((event) => !isPlaceholderSummary(event.summary))
      .map(slotKey),
  );
  return events.filter(
    (event) =>
      !isPlaceholderSummary(event.summary) || !occupied.has(slotKey(event)),
  );
}

function ymdParts(
  instant: string,
  allDay: boolean,
  timeZone: string,
): { year: number; month: number; day: number } | null {
  if (allDay && /^\d{4}-\d{2}-\d{2}$/.test(instant)) {
    const [year, month, day] = instant.split("-").map(Number);
    return { year, month, day };
  }
  const date = new Date(instant);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value);
  return { year: get("year"), month: get("month"), day: get("day") };
}

function formatDayPrefix(
  instant: string,
  allDay: boolean,
  timeZone: string,
): string | null {
  const ymd = ymdParts(instant, allDay, timeZone);
  if (!ymd) return null;
  const weekday = WEEKDAYS[new Date(Date.UTC(ymd.year, ymd.month - 1, ymd.day, 12)).getUTCDay()];
  return `${weekday} ${ymd.day} ${MONTHS[ymd.month - 1]}`;
}

function formatClockPart(
  date: Date,
  timeZone: string,
): { hour12: number; minute: number; meridiem: "am" | "pm"; label: string } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).formatToParts(date);
  const hour12 = Number(parts.find((part) => part.type === "hour")?.value);
  const minute = Number(parts.find((part) => part.type === "minute")?.value);
  const dayPeriod = (
    parts.find((part) => part.type === "dayPeriod")?.value ?? "AM"
  ).toLowerCase();
  const meridiem: "am" | "pm" = dayPeriod.startsWith("p") ? "pm" : "am";
  const label =
    minute === 0
      ? `${hour12}`
      : `${hour12}:${String(minute).padStart(2, "0")}`;
  return { hour12, minute, meridiem, label };
}

function formatTimeRange(
  startInstant: string,
  endInstant: string | null,
  timeZone: string,
): string | null {
  const start = new Date(startInstant);
  if (Number.isNaN(start.getTime())) return null;
  const startClock = formatClockPart(start, timeZone);
  if (!endInstant) return `${startClock.label}${startClock.meridiem}`;

  const end = new Date(endInstant);
  if (Number.isNaN(end.getTime())) {
    return `${startClock.label}${startClock.meridiem}`;
  }
  const endClock = formatClockPart(end, timeZone);
  if (startClock.meridiem === endClock.meridiem) {
    return `${startClock.label}${EN_DASH}${endClock.label}${endClock.meridiem}`;
  }
  return `${startClock.label}${startClock.meridiem}${EN_DASH}${endClock.label}${endClock.meridiem}`;
}

function formatTitle(summary: string | null): string {
  let title = (summary ?? "").trim();
  if (
    (title.startsWith('"') && title.endsWith('"')) ||
    (title.startsWith("'") && title.endsWith("'"))
  ) {
    title = title.slice(1, -1).trim();
  }
  if (isPersonalCommitmentSummary(title)) {
    return PERSONAL_COMMITMENT_SUMMARY.toLowerCase();
  }
  return title.toLowerCase() || BUSY_SUMMARY;
}

type ScheduleSegment = {
  start: string | null;
  end: string | null;
  allDay: boolean;
  title: string;
  withOverlap: boolean;
};

function eventStartMs(event: { start: string | null; allDay: boolean }): number {
  if (!event.start) return Number.POSITIVE_INFINITY;
  if (event.allDay && /^\d{4}-\d{2}-\d{2}$/.test(event.start)) {
    const [year, month, day] = event.start.split("-").map(Number);
    return Date.UTC(year, month - 1, day);
  }
  const ms = Date.parse(event.start);
  return Number.isNaN(ms) ? Number.POSITIVE_INFINITY : ms;
}

function eventEndMs(event: { end: string | null; start: string | null; allDay: boolean }): number {
  if (!event.end) return eventStartMs(event);
  if (event.allDay && /^\d{4}-\d{2}-\d{2}$/.test(event.end)) {
    const [year, month, day] = event.end.split("-").map(Number);
    return Date.UTC(year, month - 1, day);
  }
  const ms = Date.parse(event.end);
  return Number.isNaN(ms) ? eventStartMs(event) : ms;
}

function timedIntervalsOverlap(
  a: { start: string | null; end: string | null; allDay: boolean },
  b: { start: string | null; end: string | null; allDay: boolean },
): boolean {
  if (a.allDay || b.allDay || !a.start || !b.start) return false;
  const a0 = eventStartMs(a);
  const a1 = eventEndMs(a);
  const b0 = eventStartMs(b);
  const b1 = eventEndMs(b);
  return a0 < b1 && b0 < a1;
}

/**
 * Collapse overlapping `busy` blocks into one span marked `withOverlap`.
 * Named events stay intact.
 */
export function collapseOverlappingBusy(
  events: CalendarEvent[],
): ScheduleSegment[] {
  const sorted = events
    .slice()
    .sort((a, b) => eventStartMs(a) - eventStartMs(b) || eventEndMs(a) - eventEndMs(b));

  const segments: ScheduleSegment[] = [];
  for (const event of sorted) {
    const title = formatTitle(event.summary);
    const next: ScheduleSegment = {
      start: event.start,
      end: event.end,
      allDay: event.allDay,
      title,
      withOverlap: false,
    };
    const prev = segments[segments.length - 1];
    if (
      prev &&
      prev.title === BUSY_SUMMARY &&
      next.title === BUSY_SUMMARY &&
      timedIntervalsOverlap(prev, next)
    ) {
      if (eventEndMs(next) > eventEndMs(prev)) {
        prev.end = next.end;
      }
      prev.withOverlap = true;
      continue;
    }
    segments.push(next);
  }
  return segments;
}

function formatSegmentBody(segment: ScheduleSegment, timeZone: string): string | null {
  const overlap = segment.withOverlap ? " with overlap" : "";
  if (segment.allDay || !segment.start) return `${segment.title}${overlap}`;
  const times = formatTimeRange(segment.start, segment.end, timeZone);
  if (!times) return `${segment.title}${overlap}`;
  return `${segment.title} ${times}${overlap}`;
}

/** One skill-shaped day line, e.g. `mon 10 aug: writing club 12–1:30pm`. */
export function formatEventLine(
  event: CalendarEvent,
  timeZone: string,
): string | null {
  if (!event.start) return null;
  const day = formatDayPrefix(event.start, event.allDay, timeZone);
  if (!day) return null;
  const body = formatSegmentBody(
    {
      start: event.start,
      end: event.end,
      allDay: event.allDay,
      title: formatTitle(event.summary),
      withOverlap: false,
    },
    timeZone,
  );
  if (!body) return null;
  return `${day}: ${body}`;
}

function formatDayLine(
  day: string,
  segments: ScheduleSegment[],
  timeZone: string,
): string | null {
  const parts: Array<{ body: string; busy: boolean }> = [];
  for (const segment of segments) {
    const body = formatSegmentBody(segment, timeZone);
    if (!body) continue;
    parts.push({ body, busy: segment.title === BUSY_SUMMARY });
  }
  if (parts.length === 0) return null;

  let joined = parts[0].body;
  for (let i = 1; i < parts.length; i++) {
    const joiner = parts[i - 1].busy && parts[i].busy ? ", " : " | ";
    joined += `${joiner}${parts[i].body}`;
  }
  return `${day}: ${joined}`;
}

/**
 * Merge-ready listing text for iMessage. Dedupes placeholders, sorts by start,
 * collapses overlapping busy blocks, and emits one line per day.
 */
export function formatScheduleListing(
  events: CalendarEvent[],
  timeZone: string,
  emptyMessage = "nothing scheduled",
): string {
  const segments = collapseOverlappingBusy(dedupePlaceholderEvents(events));
  const byDay = new Map<string, ScheduleSegment[]>();
  for (const segment of segments) {
    if (!segment.start) continue;
    const day = formatDayPrefix(segment.start, segment.allDay, timeZone);
    if (!day) continue;
    const list = byDay.get(day) ?? [];
    list.push(segment);
    byDay.set(day, list);
  }

  const lines = [...byDay.entries()]
    .map(([day, daySegments]) => formatDayLine(day, daySegments, timeZone))
    .filter((line): line is string => Boolean(line));

  return lines.length === 0 ? emptyMessage : lines.join("\n");
}

/** List every configured calendar in a window, dedupe, and format. */
export async function listFormattedSchedule(params: {
  timeMin: string;
  timeMax?: string;
  timeZone: string;
  query?: string;
  maxResultsPerCalendar?: number;
  emptyMessage?: string;
}): Promise<{ text: string; count: number; events: CalendarEvent[] }> {
  const maxResults = params.maxResultsPerCalendar ?? 50;
  const perCalendar = await Promise.all(
    listCalendarAliases().map(async (alias) => {
      const { calendarId } = resolveCalendar(alias);
      return listCalendarEventsInRange({
        calendarId,
        timeMin: params.timeMin,
        timeMax: params.timeMax,
        timeZone: params.timeZone,
        query: params.query,
        maxResults,
      });
    }),
  );
  const emptyMessage = params.emptyMessage ?? "nothing scheduled";
  const events = dedupePlaceholderEvents(perCalendar.flat());
  const text = formatScheduleListing(events, params.timeZone, emptyMessage);
  return {
    text,
    count: text === emptyMessage ? 0 : events.length,
    events,
  };
}

export function serializeEvent(
  event: calendar_v3.Schema$Event,
): CalendarEvent | null {
  if (!event.id) return null;
  if (event.status === "cancelled") return null;
  // Free/"available" blocks with no title are not busy time.
  if (event.transparency === "transparent" && !event.summary?.trim()) {
    return null;
  }
  const start = eventTime(event.start);
  const end = eventTime(event.end);
  return {
    id: event.id,
    status: event.status ?? null,
    summary: normalizeSummary(event.summary),
    description: event.description ?? null,
    location: event.location ?? null,
    htmlLink: event.htmlLink ?? null,
    start: start.instant,
    end: end.instant,
    allDay: start.allDay,
    attendees: (event.attendees ?? [])
      .filter((a): a is calendar_v3.Schema$EventAttendee & { email: string } =>
        Boolean(a.email),
      )
      .map((a) => ({
        email: a.email,
        displayName: a.displayName ?? null,
        responseStatus: a.responseStatus ?? null,
      })),
    recurringEventId: event.recurringEventId ?? null,
  };
}

function isCalendarAccessError(err: unknown): boolean {
  const e = err as { code?: number | string; response?: { status?: number } };
  const status = Number(e.code ?? e.response?.status ?? 0);
  return status === 403 || status === 404;
}

function busyPeriodToEvent(
  period: { start?: string | null; end?: string | null },
  index: number,
): CalendarEvent | null {
  const start = period.start?.trim() ?? "";
  const end = period.end?.trim() ?? "";
  if (!start || !end) return null;
  const allDay = /^\d{4}-\d{2}-\d{2}$/.test(start);
  return {
    id: `busy-${index}-${start}-${end}`,
    status: "confirmed",
    summary: BUSY_SUMMARY,
    description: null,
    location: null,
    htmlLink: null,
    start,
    end,
    allDay,
    attendees: [],
    recurringEventId: null,
  };
}

async function listBusyBlocks(params: {
  calendarId: string;
  timeMin: string;
  timeMax: string;
  timeZone: string;
  maxResults: number;
}): Promise<CalendarEvent[]> {
  const client = getCalendarClient();
  const res = await client.freebusy.query({
    requestBody: {
      timeMin: params.timeMin,
      timeMax: params.timeMax,
      timeZone: params.timeZone,
      items: [{ id: params.calendarId }],
    },
  });

  const calendars = res.data.calendars ?? {};
  const entry =
    calendars[params.calendarId] ?? Object.values(calendars)[0] ?? null;
  const busy = entry?.busy ?? [];
  return busy
    .map((period, index) => busyPeriodToEvent(period, index))
    .filter((event): event is CalendarEvent => event != null)
    .slice(0, params.maxResults);
}

export type ListCalendarEventsParams = {
  calendarId: string;
  timeMin: string;
  /** Required for free/busy fallback when the calendar only exposes busy blocks. */
  timeMax?: string;
  timeZone: string;
  query?: string;
  maxResults?: number;
};

/**
 * List events for a calendar. Untitled / private free-busy entries become
 * `busy`. If `events.list` is empty or forbidden (freeBusyReader calendars),
 * falls back to the FreeBusy API so busy blocks still appear with times.
 */
export async function listCalendarEventsInRange(
  params: ListCalendarEventsParams,
): Promise<CalendarEvent[]> {
  const maxResults = params.maxResults ?? 20;
  const client = getCalendarClient();

  let events: CalendarEvent[] = [];
  let listFailed = false;

  try {
    const res = await client.events.list({
      calendarId: params.calendarId,
      timeMin: params.timeMin,
      timeMax: params.timeMax,
      q: params.query,
      maxResults,
      singleEvents: true,
      orderBy: "startTime",
    });
    events = (res.data.items ?? [])
      .map(serializeEvent)
      .filter((event): event is CalendarEvent => event != null);
  } catch (err) {
    if (!isCalendarAccessError(err) || params.query) throw err;
    listFailed = true;
  }

  // Free/busy-only calendars often return nothing (or 403) from events.list.
  // FreeBusy has no text search — skip when the caller passed `query`.
  if ((listFailed || events.length === 0) && !params.query) {
    const timeMax =
      params.timeMax ??
      new Date(
        new Date(params.timeMin).getTime() + 7 * 24 * 60 * 60 * 1000,
      ).toISOString();
    const busy = await listBusyBlocks({
      calendarId: params.calendarId,
      timeMin: params.timeMin,
      timeMax,
      timeZone: params.timeZone,
      maxResults,
    });
    if (busy.length > 0) return busy;
  }

  return events;
}

export function toEventDateTime(
  value: string,
  timeZone?: string,
): calendar_v3.Schema$EventDateTime {
  // All-day events use YYYY-MM-DD; timed events use RFC3339 / ISO timestamps.
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return { date: value };
  }
  return timeZone ? { dateTime: value, timeZone } : { dateTime: value };
}

/** Offset of `timeZone` at `instant`, as milliseconds to add to UTC to get local wall time. */
function getTimeZoneOffsetMs(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);

  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value;
  const asUtc = Date.UTC(
    Number(get("year")),
    Number(get("month")) - 1,
    Number(get("day")),
    Number(get("hour")),
    Number(get("minute")),
    Number(get("second")),
  );
  return asUtc - instant.getTime();
}

/**
 * Google Calendar `timeMin`/`timeMax` require RFC3339 with `Z` or an offset.
 * Bare dates / datetimes are interpreted in `timeZone` (caller's effective zone).
 */
export function toListTimeBound(value: string, timeZone: string): string {
  const v = value.trim();
  if (!v) {
    throw new Error("time bound must be a non-empty ISO-8601 / RFC3339 string");
  }

  // Already RFC3339 with timezone.
  if (/[zZ]$/.test(v) || /[+-]\d{2}:?\d{2}$/.test(v)) {
    return v;
  }

  let local: string;
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) {
    local = `${v}T00:00:00`;
  } else if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v)) {
    local = `${v}:00`;
  } else if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?$/.test(v)) {
    local = v.replace(/\.\d+$/, "");
  } else {
    const parsed = new Date(v);
    if (Number.isNaN(parsed.getTime())) {
      throw new Error(
        `Invalid time bound "${value}". Use RFC3339 with offset/Z, or YYYY-MM-DD.`,
      );
    }
    return parsed.toISOString();
  }

  const [datePart, timePart] = local.split("T");
  const [year, month, day] = datePart.split("-").map(Number);
  const [hour, minute, second] = timePart.split(":").map(Number);
  const wallAsUtc = Date.UTC(year, month - 1, day, hour, minute, second);

  // Refine once so DST around the target local time is correct.
  let utcMs = wallAsUtc;
  for (let i = 0; i < 2; i++) {
    const offsetMs = getTimeZoneOffsetMs(new Date(utcMs), timeZone);
    utcMs = wallAsUtc - offsetMs;
  }

  return new Date(utcMs).toISOString();
}

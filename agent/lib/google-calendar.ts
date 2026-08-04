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

function normalizeSummary(summary?: string | null): string {
  const trimmed = summary?.trim() ?? "";
  if (!trimmed || trimmed.toLowerCase() === BUSY_SUMMARY) return BUSY_SUMMARY;
  return trimmed;
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

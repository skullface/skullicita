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

export function serializeEvent(
  event: calendar_v3.Schema$Event,
): CalendarEvent | null {
  if (!event.id) return null;
  const start = eventTime(event.start);
  const end = eventTime(event.end);
  return {
    id: event.id,
    status: event.status ?? null,
    summary: event.summary ?? null,
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

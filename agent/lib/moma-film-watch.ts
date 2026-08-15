import {
  parseWorkspaceJson,
  runWorkspacePython,
} from "./workspace-python";
import {
  readMomaFilmWatchStore,
  writeMomaFilmWatchStore,
  type MomaFilmWatchStore,
} from "./moma-film-watch-store";

export const MOMA_FILM_WATCH_DATES = [
  "2026-10-09",
  "2026-10-23",
  "2026-10-24",
  "2026-10-25",
  "2026-10-26",
] as const;

type MomaCalendarCheckResult = {
  dates: Array<{
    date: string;
    hasEvents: boolean;
  }>;
};

function momaFilmsUrl(date: string): string {
  return `https://www.moma.org/calendar/?happening_filter=Films&date=${date}`;
}

async function fetchMomaCalendarState(): Promise<
  Record<string, { hasEvents: boolean }>
> {
  const { stdout, stderr } = await runWorkspacePython({
    scriptRelative: "sandbox/workspace/scripts/check_moma_calendar.py",
    sandboxCommand: "scripts/check_moma_calendar.py",
    env: {
      MOMA_WATCH_DATES: MOMA_FILM_WATCH_DATES.join(","),
    },
  });

  const parsed = parseWorkspaceJson<MomaCalendarCheckResult>(stdout, stderr);
  const byDate: Record<string, { hasEvents: boolean }> = {};

  for (const entry of parsed.dates) {
    byDate[entry.date] = { hasEvents: entry.hasEvents };
  }

  for (const date of MOMA_FILM_WATCH_DATES) {
    if (!(date in byDate)) {
      throw new Error(`MoMA calendar check missing result for ${date}`);
    }
  }

  return byDate;
}

function newlyAvailableDates(
  previous: MomaFilmWatchStore,
  current: Record<string, { hasEvents: boolean }>,
): string[] {
  const flipped: string[] = [];

  for (const date of MOMA_FILM_WATCH_DATES) {
    const wasEmpty = previous.dates[date]?.hasEvents === false;
    const nowHasEvents = current[date]?.hasEvents === true;
    if (wasEmpty && nowHasEvents) {
      flipped.push(date);
    }
  }

  return flipped;
}

function buildNextStore(
  previous: MomaFilmWatchStore,
  current: Record<string, { hasEvents: boolean }>,
  checkedAt: string,
): MomaFilmWatchStore {
  const dates = { ...previous.dates };

  for (const date of MOMA_FILM_WATCH_DATES) {
    dates[date] = {
      hasEvents: current[date].hasEvents,
      checkedAt,
    };
  }

  return {
    dates,
    updatedAt: checkedAt,
  };
}

export function formatMomaFilmWatchMessage(dates: string[]): string {
  return dates
    .map((date) => `moma films added for ${date}\n${momaFilmsUrl(date)}`)
    .join("\n\n");
}

export async function pollMomaFilmWatch(): Promise<{
  newlyAvailable: string[];
  seeded: boolean;
}> {
  const previous = await readMomaFilmWatchStore();
  const current = await fetchMomaCalendarState();
  const checkedAt = new Date().toISOString();
  const seeded = MOMA_FILM_WATCH_DATES.every((date) => !(date in previous.dates));

  const next = buildNextStore(previous, current, checkedAt);
  await writeMomaFilmWatchStore(next);

  if (seeded) {
    return { newlyAvailable: [], seeded: true };
  }

  return {
    newlyAvailable: newlyAvailableDates(previous, current),
    seeded: false,
  };
}

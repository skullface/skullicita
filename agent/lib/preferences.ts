import { get, put } from "@vercel/blob";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

/** Home / default timezone when no travel override is set. */
export const HOME_TIME_ZONE =
  process.env.GOOGLE_CALENDAR_TIMEZONE?.trim() || "America/New_York";

export type Preferences = {
  /** Travel override; null means use HOME_TIME_ZONE. */
  timeZone: string | null;
  updatedAt: string | null;
};

const BLOB_PATH = "skullicita/preferences.json";
const LOCAL_PATH = path.join(process.cwd(), ".data", "preferences.json");

const EMPTY: Preferences = { timeZone: null, updatedAt: null };

function hasBlobAuth(): boolean {
  return Boolean(
    process.env.BLOB_READ_WRITE_TOKEN?.trim() ||
      process.env.BLOB_STORE_ID?.trim(),
  );
}

export function assertValidTimeZone(timeZone: string): string {
  const tz = timeZone.trim();
  if (!tz) {
    throw new Error("timeZone must be a non-empty IANA name like America/Los_Angeles");
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz }).format(new Date());
  } catch {
    throw new Error(
      `Invalid IANA timezone "${timeZone}". Use a name like America/Los_Angeles or Europe/London.`,
    );
  }
  return tz;
}

async function readLocal(): Promise<Preferences> {
  try {
    const raw = await readFile(LOCAL_PATH, "utf8");
    return parsePreferences(raw);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return EMPTY;
    throw error;
  }
}

async function writeLocal(prefs: Preferences): Promise<void> {
  await mkdir(path.dirname(LOCAL_PATH), { recursive: true });
  await writeFile(LOCAL_PATH, `${JSON.stringify(prefs, null, 2)}\n`, "utf8");
}

async function streamToText(
  stream: ReadableStream<Uint8Array>,
): Promise<string> {
  return new Response(stream).text();
}

function parsePreferences(raw: string): Preferences {
  try {
    const parsed = JSON.parse(raw) as Partial<Preferences>;
    return {
      timeZone:
        typeof parsed.timeZone === "string" && parsed.timeZone.trim()
          ? parsed.timeZone.trim()
          : null,
      updatedAt:
        typeof parsed.updatedAt === "string" ? parsed.updatedAt : null,
    };
  } catch {
    return EMPTY;
  }
}

async function readBlob(): Promise<Preferences> {
  const result = await get(BLOB_PATH, {
    access: "private",
    useCache: false,
  });
  if (!result?.stream) return EMPTY;
  return parsePreferences(await streamToText(result.stream));
}

async function writeBlob(prefs: Preferences): Promise<void> {
  await put(BLOB_PATH, JSON.stringify(prefs, null, 2), {
    access: "private",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json",
  });
}

export async function readPreferences(): Promise<Preferences> {
  if (hasBlobAuth()) {
    try {
      return await readBlob();
    } catch {
      // Fall through to local when Blob isn't linked yet (common in eve dev).
    }
  }
  return readLocal();
}

export async function writePreferences(
  prefs: Preferences,
): Promise<Preferences> {
  if (hasBlobAuth()) {
    await writeBlob(prefs);
    return prefs;
  }

  if (process.env.VERCEL) {
    throw new Error(
      "Timezone preferences need a Vercel Blob store. Create one (Storage → Blob), link it to this project, pull env, and redeploy.",
    );
  }

  await writeLocal(prefs);
  return prefs;
}

export async function getEffectiveTimeZone(): Promise<string> {
  const prefs = await readPreferences();
  return prefs.timeZone ?? HOME_TIME_ZONE;
}

export async function setTravelTimeZone(
  timeZone: string,
): Promise<Preferences> {
  const tz = assertValidTimeZone(timeZone);
  return writePreferences({
    timeZone: tz,
    updatedAt: new Date().toISOString(),
  });
}

export async function clearTravelTimeZone(): Promise<Preferences> {
  return writePreferences({
    timeZone: null,
    updatedAt: new Date().toISOString(),
  });
}

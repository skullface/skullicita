import { get, put } from "@vercel/blob";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export type MomaFilmWatchDateState = {
  hasEvents: boolean;
  checkedAt: string;
};

export type MomaFilmWatchStore = {
  dates: Record<string, MomaFilmWatchDateState>;
  updatedAt: string | null;
};

const BLOB_PATH = "skullicita/moma-film-watch.json";
const LOCAL_PATH = path.join(process.cwd(), ".data", "moma-film-watch.json");

const EMPTY: MomaFilmWatchStore = { dates: {}, updatedAt: null };

function hasBlobAuth(): boolean {
  return Boolean(
    process.env.BLOB_READ_WRITE_TOKEN?.trim() ||
      process.env.BLOB_STORE_ID?.trim(),
  );
}

async function streamToText(
  stream: ReadableStream<Uint8Array>,
): Promise<string> {
  return new Response(stream).text();
}

function parseStore(raw: string): MomaFilmWatchStore {
  try {
    const parsed = JSON.parse(raw) as Partial<MomaFilmWatchStore>;
    const dates =
      parsed.dates && typeof parsed.dates === "object" ? parsed.dates : {};
    const normalized: Record<string, MomaFilmWatchDateState> = {};

    for (const [date, value] of Object.entries(dates)) {
      if (!value || typeof value !== "object") continue;
      const entry = value as Partial<MomaFilmWatchDateState>;
      if (typeof entry.hasEvents !== "boolean") continue;
      if (typeof entry.checkedAt !== "string") continue;
      normalized[date] = {
        hasEvents: entry.hasEvents,
        checkedAt: entry.checkedAt,
      };
    }

    return {
      dates: normalized,
      updatedAt:
        typeof parsed.updatedAt === "string" ? parsed.updatedAt : null,
    };
  } catch {
    return EMPTY;
  }
}

async function readLocal(): Promise<MomaFilmWatchStore> {
  try {
    const raw = await readFile(LOCAL_PATH, "utf8");
    return parseStore(raw);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return EMPTY;
    throw error;
  }
}

async function writeLocal(store: MomaFilmWatchStore): Promise<void> {
  await mkdir(path.dirname(LOCAL_PATH), { recursive: true });
  await writeFile(LOCAL_PATH, `${JSON.stringify(store, null, 2)}\n`, "utf8");
}

async function readBlob(): Promise<MomaFilmWatchStore> {
  const result = await get(BLOB_PATH, {
    access: "private",
    useCache: false,
  });
  if (!result?.stream) return EMPTY;
  return parseStore(await streamToText(result.stream));
}

async function writeBlob(store: MomaFilmWatchStore): Promise<void> {
  await put(BLOB_PATH, JSON.stringify(store, null, 2), {
    access: "private",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json",
  });
}

export async function readMomaFilmWatchStore(): Promise<MomaFilmWatchStore> {
  if (hasBlobAuth()) {
    try {
      return await readBlob();
    } catch {
      // Fall through to local when Blob isn't linked yet (common in eve dev).
    }
  }
  return readLocal();
}

export async function writeMomaFilmWatchStore(
  store: MomaFilmWatchStore,
): Promise<MomaFilmWatchStore> {
  if (hasBlobAuth()) {
    await writeBlob(store);
    return store;
  }

  if (process.env.VERCEL) {
    throw new Error(
      "MoMA film watch state needs a Vercel Blob store. Create one (Storage → Blob), link it to this project, pull env, and redeploy.",
    );
  }

  await writeLocal(store);
  return store;
}

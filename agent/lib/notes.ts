import { toListTimeBound } from "./google-calendar";
import { getEffectiveTimeZone } from "./preferences";
import { get, put } from "@vercel/blob";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export type Note = {
  id: string;
  text: string;
  createdAt: string;
  sender?: string;
  messageId?: string;
};

type NotesStore = {
  notes: Note[];
  updatedAt: string | null;
};

const BLOB_PATH = "skullicita/notes.json";
const LOCAL_PATH = path.join(process.cwd(), ".data", "notes.json");

const EMPTY: NotesStore = { notes: [], updatedAt: null };

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

function parseNotesStore(raw: string): NotesStore {
  try {
    const parsed = JSON.parse(raw) as Partial<NotesStore>;
    const notes = Array.isArray(parsed.notes)
      ? parsed.notes.filter(isValidNote)
      : [];
    return {
      notes,
      updatedAt:
        typeof parsed.updatedAt === "string" ? parsed.updatedAt : null,
    };
  } catch {
    return EMPTY;
  }
}

function isValidNote(value: unknown): value is Note {
  if (!value || typeof value !== "object") return false;
  const note = value as Partial<Note>;
  return (
    typeof note.id === "string" &&
    typeof note.text === "string" &&
    typeof note.createdAt === "string"
  );
}

async function readLocal(): Promise<NotesStore> {
  try {
    const raw = await readFile(LOCAL_PATH, "utf8");
    return parseNotesStore(raw);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return EMPTY;
    throw error;
  }
}

async function writeLocal(store: NotesStore): Promise<void> {
  await mkdir(path.dirname(LOCAL_PATH), { recursive: true });
  await writeFile(LOCAL_PATH, `${JSON.stringify(store, null, 2)}\n`, "utf8");
}

async function readBlob(): Promise<NotesStore> {
  const result = await get(BLOB_PATH, {
    access: "private",
    useCache: false,
  });
  if (!result?.stream) return EMPTY;
  return parseNotesStore(await streamToText(result.stream));
}

async function writeBlob(store: NotesStore): Promise<void> {
  await put(BLOB_PATH, JSON.stringify(store, null, 2), {
    access: "private",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json",
  });
}

async function readNotesStore(): Promise<NotesStore> {
  if (hasBlobAuth()) {
    try {
      return await readBlob();
    } catch {
      // Fall through to local when Blob isn't linked yet (common in eve dev).
    }
  }
  return readLocal();
}

async function writeNotesStore(store: NotesStore): Promise<NotesStore> {
  if (hasBlobAuth()) {
    await writeBlob(store);
    return store;
  }

  if (process.env.VERCEL) {
    throw new Error(
      "Notes need a Vercel Blob store. Create one (Storage → Blob), link it to this project, pull env, and redeploy.",
    );
  }

  await writeLocal(store);
  return store;
}

export async function appendNote(
  note: Omit<Note, "id" | "createdAt">,
): Promise<Note> {
  const store = await readNotesStore();
  const entry: Note = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    text: note.text,
    ...(note.sender ? { sender: note.sender } : {}),
    ...(note.messageId ? { messageId: note.messageId } : {}),
  };

  await writeNotesStore({
    notes: [...store.notes, entry],
    updatedAt: entry.createdAt,
  });

  return entry;
}

export type ListNotesOptions = {
  limit?: number;
  /** Inclusive start. YYYY-MM-DD or RFC3339; bare datetimes use timeZone. */
  since?: string;
  /** Exclusive end. YYYY-MM-DD or RFC3339; bare datetimes use timeZone. */
  until?: string;
  /** IANA timezone for interpreting bare date/datetime bounds. */
  timeZone?: string;
};

export async function listNotes(options: ListNotesOptions = {}): Promise<Note[]> {
  const store = await readNotesStore();
  const limit = Math.max(1, Math.min(options.limit ?? 20, 50));

  let sinceMs: number | undefined;
  let untilMs: number | undefined;

  if (options.since?.trim() || options.until?.trim()) {
    const timeZone = options.timeZone?.trim() || (await getEffectiveTimeZone());
    if (options.since?.trim()) {
      sinceMs = Date.parse(toListTimeBound(options.since, timeZone));
      if (Number.isNaN(sinceMs)) {
        throw new Error(`Invalid since bound "${options.since}"`);
      }
    }
    if (options.until?.trim()) {
      untilMs = Date.parse(toListTimeBound(options.until, timeZone));
      if (Number.isNaN(untilMs)) {
        throw new Error(`Invalid until bound "${options.until}"`);
      }
    }
  }

  return [...store.notes]
    .filter((note) => {
      const createdMs = Date.parse(note.createdAt);
      if (Number.isNaN(createdMs)) return false;
      if (sinceMs !== undefined && createdMs < sinceMs) return false;
      if (untilMs !== undefined && createdMs >= untilMs) return false;
      return true;
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit);
}

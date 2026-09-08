import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

export const ROOT = path.resolve(here, "..", "..");

/**
 * `ROOT` always points at the repo (the scripts need it to find node_modules),
 * but the data directory is overridable so tests can drive the CLIs against a
 * fixture tree instead of the committed artifacts.
 */
export const DATA_DIR = process.env.BOOKMARKS_DATA_DIR
  ? path.resolve(process.env.BOOKMARKS_DATA_DIR)
  : path.join(ROOT, "data");
export const SEED_FILE = path.join(DATA_DIR, "bookmarks-seed.json");
export const CRAWL_DIR = path.join(DATA_DIR, "crawls");
export const CRAWL_INDEX_FILE = path.join(CRAWL_DIR, "index.json");
export const INDEX_DIR = path.join(DATA_DIR, "index");
export const BOOKMARKS_INDEX_FILE = path.join(INDEX_DIR, "bookmarks.json");
export const VECTORS_FILE = path.join(INDEX_DIR, "vectors.json");
export const META_FILE = path.join(INDEX_DIR, "meta.json");

export function urlKey(url: string): string {
  return createHash("sha1").update(url).digest("hex").slice(0, 16);
}

export async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

export async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export async function writeJson(file: string, value: unknown, pretty = true): Promise<void> {
  await ensureDir(path.dirname(file));
  const body = pretty ? `${JSON.stringify(value, null, 2)}\n` : `${JSON.stringify(value)}\n`;
  await fs.writeFile(file, body, "utf8");
}

export function relative(file: string): string {
  return path.relative(ROOT, file);
}

/** Loads `.env.local` then `.env` without clobbering real environment values. */
export async function loadEnv(): Promise<void> {
  const { config } = await import("dotenv");
  for (const file of [".env.local", ".env"]) {
    config({ path: path.join(ROOT, file), override: false, quiet: true });
  }
}

export type Args = {
  flags: Set<string>;
  values: Map<string, string>;
};

export function parseArgs(argv = process.argv.slice(2)): Args {
  const flags = new Set<string>();
  const values = new Map<string, string>();

  for (const arg of argv) {
    if (!arg.startsWith("--")) continue;
    const [key, value] = arg.slice(2).split("=");
    if (value === undefined) flags.add(key);
    else values.set(key, value);
  }
  return { flags, values };
}

export function numberArg(args: Args, key: string, fallback: number): number {
  const raw = args.values.get(key);
  const parsed = raw === undefined ? Number.NaN : Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

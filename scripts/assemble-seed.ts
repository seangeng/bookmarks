/**
 * Assemble data/bookmarks-seed.json from data/seed-parts/.
 *
 *   npm run seed:assemble                # assemble, or fail listing what is missing
 *   npm run seed:assemble -- --if-complete   # no-op unless every part has landed
 *   npm run seed:assemble -- --dry-run
 *
 * The export is delivered in chunks with a manifest that records each part's
 * record count, byte size, and line count. Single-file pushes of the whole
 * export kept arriving truncated or as placeholder text, so every part is
 * verified against those three numbers before anything is written — a part
 * that is short by even a few bytes is rejected rather than silently merged.
 */
import fs from "node:fs/promises";
import path from "node:path";

import { DATA_DIR, SEED_FILE, numberArg, parseArgs, readJson, relative, writeJson } from "./lib/fs-data";

const PARTS_DIR = path.join(DATA_DIR, "seed-parts");
const MANIFEST_FILE = path.join(PARTS_DIR, "manifest.json");

type Manifest = {
  count: number;
  last_id?: string;
  source?: string;
  owner?: string;
  parts: { file: string; n: number; bytes: number; lines: number }[];
};

type Loose = Record<string, unknown>;

function recordsOf(parsed: unknown): Loose[] | null {
  if (Array.isArray(parsed)) return parsed as Loose[];
  if (parsed && typeof parsed === "object") {
    const container = parsed as Loose;
    for (const key of ["bookmarks", "data", "items"]) {
      if (Array.isArray(container[key])) return container[key] as Loose[];
    }
  }
  return null;
}

type PartResult =
  | { file: string; ok: true; records: Loose[] }
  | { file: string; ok: false; problem: string };

async function readPart(entry: Manifest["parts"][number]): Promise<PartResult> {
  const file = path.join(PARTS_DIR, entry.file);
  let raw: string;
  try {
    raw = await fs.readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { file: entry.file, ok: false, problem: "not pushed yet" };
    }
    throw error;
  }

  const bytes = Buffer.byteLength(raw, "utf8");
  const lines = raw.split("\n").length - (raw.endsWith("\n") ? 1 : 0);

  // A trailing-newline difference is a formatting detail, not a truncation.
  if (Math.abs(bytes - entry.bytes) > 1) {
    return {
      file: entry.file,
      ok: false,
      problem: `${bytes} bytes, manifest says ${entry.bytes} (off by ${bytes - entry.bytes})`,
    };
  }
  if (Math.abs(lines - entry.lines) > 1) {
    return {
      file: entry.file,
      ok: false,
      problem: `${lines} lines, manifest says ${entry.lines}`,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return {
      file: entry.file,
      ok: false,
      problem: `invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  const records = recordsOf(parsed);
  if (!records) {
    return { file: entry.file, ok: false, problem: "no array of records found" };
  }
  if (records.length !== entry.n) {
    return {
      file: entry.file,
      ok: false,
      problem: `${records.length} records, manifest says ${entry.n}`,
    };
  }

  return { file: entry.file, ok: true, records };
}

async function main(): Promise<void> {
  const args = parseArgs();
  const ifComplete = args.flags.has("if-complete");
  const dryRun = args.flags.has("dry-run");

  const manifest = await readJson<Manifest>(MANIFEST_FILE);
  if (!manifest) {
    const message = `No manifest at ${relative(MANIFEST_FILE)}.`;
    if (ifComplete) {
      console.log(`${message} Nothing to assemble.`);
      return;
    }
    console.error(message);
    process.exit(1);
  }
  if (!Array.isArray(manifest.parts) || manifest.parts.length === 0) {
    console.error(`${relative(MANIFEST_FILE)} lists no parts.`);
    process.exit(1);
  }

  const results = await Promise.all(manifest.parts.map(readPart));
  const missing = results.filter(
    (result): result is Extract<PartResult, { ok: false }> =>
      !result.ok && result.problem === "not pushed yet",
  );
  const broken = results.filter(
    (result): result is Extract<PartResult, { ok: false }> =>
      !result.ok && result.problem !== "not pushed yet",
  );

  const expected = manifest.parts.length;
  console.log(
    `${relative(PARTS_DIR)}: ${expected - missing.length - broken.length}/${expected} parts ` +
      `verified · target ${manifest.count} bookmarks`,
  );

  for (const part of broken) {
    console.error(`  BROKEN  ${part.file}: ${part.problem}`);
  }

  if (broken.length > 0) {
    console.error(
      `\n${broken.length} part(s) do not match the manifest. Re-push them; ` +
        "nothing was written.",
    );
    process.exit(1);
  }

  if (missing.length > 0) {
    const names = missing.map((part) => part.file).join(", ");
    const message = `Waiting on ${missing.length} part(s): ${names}`;
    if (ifComplete) {
      console.log(`${message}\nLeaving ${relative(SEED_FILE)} untouched.`);
      return;
    }
    console.error(`\n${message}`);
    process.exit(1);
  }

  /* Every part is present and matches the manifest. */

  const seen = new Set<string>();
  const bookmarks: Loose[] = [];
  let duplicates = 0;

  for (const result of results) {
    if (!result.ok) continue;
    for (const record of result.records) {
      const id = String(record.id ?? record.post_id ?? "");
      if (id && seen.has(id)) {
        duplicates += 1;
        continue;
      }
      if (id) seen.add(id);
      bookmarks.push(record);
    }
  }

  if (duplicates > 0) console.warn(`Dropped ${duplicates} duplicate record(s) across parts.`);

  const minimum = numberArg(args, "min", manifest.count);
  if (bookmarks.length < minimum) {
    console.error(
      `Assembled ${bookmarks.length} bookmarks but the manifest declares ${manifest.count}.`,
    );
    process.exit(1);
  }

  if (manifest.last_id && !seen.has(manifest.last_id)) {
    console.error(
      `Manifest last_id ${manifest.last_id} is not in the assembled set — ` +
        "the parts may be out of order or a tail record is missing.",
    );
    process.exit(1);
  }

  const seed = {
    source: manifest.source ?? "x-bookmarks",
    owner: manifest.owner ?? "@seangeng",
    count: bookmarks.length,
    last_id: manifest.last_id,
    assembled_at: new Date().toISOString(),
    assembled_from: `${relative(PARTS_DIR)} (${expected} parts)`,
    bookmarks,
  };

  if (dryRun) {
    console.log(`--dry-run: would write ${bookmarks.length} bookmarks to ${relative(SEED_FILE)}`);
    return;
  }

  await writeJson(SEED_FILE, seed);
  console.log(`Wrote ${bookmarks.length} bookmarks to ${relative(SEED_FILE)}`);
  console.log("Next: npm run sync");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

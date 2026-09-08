import fs from "node:fs/promises";

import { SEED_FILE, relative } from "./fs-data";
import { normalizeExport } from "../../src/lib/normalize";
import type { Bookmark } from "../../src/lib/types";

/**
 * Single entry point for reading the seed, with diagnostics.
 *
 * The seed is written by an external export job, so "the file is there but the
 * contents are wrong" is a real and observed failure mode — an upload step once
 * committed the literal string `<file>`. Every caller needs to tell that apart
 * from "there is no seed yet", because the two demand opposite responses: the
 * first must stop the build, the second may proceed with an empty library.
 */

export type SeedFailure = "missing" | "invalid_json" | "wrong_shape" | "no_bookmarks";

export type SeedResult =
  | { ok: true; bookmarks: Bookmark[]; skipped: number }
  | { ok: false; reason: SeedFailure; message: string };

/** Placeholder tokens an export/upload step can leave behind instead of data. */
const PLACEHOLDER = /^(<file>|placeholder|null|undefined|todo|tbd|\{\}|\[\])$/i;

export async function readSeed(file: string = SEED_FILE): Promise<SeedResult> {
  const name = relative(file);
  let raw: string;
  try {
    raw = await fs.readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {
        ok: false,
        reason: "missing",
        message: `No seed at ${name}. Add the X bookmarks export.`,
      };
    }
    throw error;
  }

  const trimmed = raw.trim();

  if (PLACEHOLDER.test(trimmed) || trimmed.length < 32) {
    return {
      ok: false,
      reason: "invalid_json",
      message:
        `${name} contains ${
          trimmed.length === 0 ? "nothing" : `only ${JSON.stringify(trimmed.slice(0, 40))}`
        } (${trimmed.length} bytes). That looks like a placeholder from a failed ` +
        `upload rather than an export — re-push the file with the real JSON contents.`,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (error) {
    return {
      ok: false,
      reason: "invalid_json",
      message:
        `${name} is not valid JSON: ${
          error instanceof Error ? error.message : String(error)
        }. Starts with ${JSON.stringify(trimmed.slice(0, 60))}`,
    };
  }

  if (typeof parsed !== "object" || parsed === null) {
    return {
      ok: false,
      reason: "wrong_shape",
      message:
        `${name} parsed as ${typeof parsed}. Expected an array of ` +
        `bookmarks or an object with a "bookmarks" / "data" array.`,
    };
  }

  const { bookmarks, skipped } = normalizeExport(parsed);

  if (bookmarks.length === 0) {
    return {
      ok: false,
      reason: "no_bookmarks",
      message:
        `${name} parsed but yielded no usable bookmarks ` +
        `(${skipped} entries rejected). Each needs at least an id and an author.`,
    };
  }

  return { ok: true, bookmarks, skipped };
}

/** Reads the seed or exits with an actionable message. For the CLI scripts. */
export async function readSeedOrExit(
  file?: string,
): Promise<{ bookmarks: Bookmark[]; skipped: number }> {
  const result = await readSeed(file);
  if (!result.ok) {
    console.error(`\n${result.message}\n`);
    process.exit(1);
  }
  if (result.skipped > 0) {
    console.warn(`Skipped ${result.skipped} malformed seed entries.`);
  }
  return result;
}

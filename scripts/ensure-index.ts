/**
 * Build guard (wired to `prebuild`).
 *
 * The site imports data/index/*.json directly, so those files must exist before
 * `next build` runs. Three cases, deliberately handled differently:
 *
 *   artifacts present     -> nothing to do
 *   no seed at all        -> write empty stubs; the app renders its empty state
 *   seed present but bad  -> fail the build
 *
 * The last one matters. An unusable seed with missing artifacts previously fell
 * through to the empty stubs, which meant a corrupt export deployed a
 * successful build of an empty library instead of stopping the release.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import {
  BOOKMARKS_INDEX_FILE,
  META_FILE,
  ROOT,
  VECTORS_FILE,
  relative,
  writeJson,
} from "./lib/fs-data";
import { readSeed } from "./lib/seed";
import { LOCAL_DIMENSIONS, LOCAL_MODEL } from "../src/lib/embeddings";
import type { IndexMeta, StoredVectors } from "../src/lib/types";

async function writeEmptyIndex(): Promise<void> {
  const meta: IndexMeta = {
    generated_at: new Date().toISOString(),
    bookmark_count: 0,
    crawled_link_count: 0,
    embedding: { provider: "local", model: LOCAL_MODEL, dimensions: LOCAL_DIMENSIONS },
    vector_store: "local",
    classifier: "heuristic",
    topics: [],
  };
  const vectors: StoredVectors = {
    dimensions: LOCAL_DIMENSIONS,
    provider: "local",
    model: LOCAL_MODEL,
    vectors: {},
  };

  await writeJson(BOOKMARKS_INDEX_FILE, []);
  await writeJson(VECTORS_FILE, vectors);
  await writeJson(META_FILE, meta);
}

async function main(): Promise<void> {
  const required = [BOOKMARKS_INDEX_FILE, VECTORS_FILE, META_FILE];
  const missing = required.filter((file) => !fs.existsSync(file));

  // Even when artifacts exist, a broken seed means the committed index no
  // longer describes the seed — worth saying out loud, but not worth blocking
  // a deploy of the last known-good index.
  const seed = await readSeed();
  if (!seed.ok && seed.reason !== "missing") {
    console.warn(`\nSeed problem: ${seed.message}\n`);
    if (missing.length === 0) {
      console.warn(
        "Building with the previously committed index, which does NOT reflect the " +
          "current seed file. Fix the seed and re-run `npm run sync`.",
      );
      return;
    }
    console.error(
      "Refusing to build an empty site from an unusable seed. Fix the seed, " +
        "or delete it to build an intentionally empty library.",
    );
    process.exit(1);
  }

  if (missing.length === 0) return;
  console.log(`Missing index artifacts: ${missing.map(relative).join(", ")}`);

  if (!seed.ok) {
    console.log(`${seed.message} Writing empty index stubs.`);
    await writeEmptyIndex();
    return;
  }

  console.log(
    `Rebuilding index from ${seed.bookmarks.length} seeded bookmarks ` +
      "(local embeddings, no crawl)…",
  );
  const result = spawnSync(
    process.execPath,
    [
      path.join(ROOT, "node_modules", "tsx", "dist", "cli.mjs"),
      path.join(ROOT, "scripts", "build-index.ts"),
      "--store=local",
      "--no-llm",
    ],
    { cwd: ROOT, stdio: "inherit" },
  );

  if (result.status !== 0) {
    console.error("Index rebuild failed. Not falling back to an empty index.");
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

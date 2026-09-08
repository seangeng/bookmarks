/**
 * Build guard (wired to `prebuild`).
 *
 * The site imports data/index/*.json directly, so those files must exist before
 * `next build` runs. If they are missing — fresh clone, or a new seed was pushed
 * without running the pipeline — regenerate them from the seed using the local
 * embedding provider. If there is no seed either, write empty stubs so the app
 * still builds and renders its empty state instead of failing the deploy.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import {
  BOOKMARKS_INDEX_FILE,
  META_FILE,
  ROOT,
  SEED_FILE,
  VECTORS_FILE,
  relative,
  writeJson,
} from "./lib/fs-data";
import { LOCAL_DIMENSIONS, LOCAL_MODEL } from "../src/lib/embeddings";
import type { IndexMeta, StoredVectors } from "../src/lib/types";

async function main(): Promise<void> {
  const required = [BOOKMARKS_INDEX_FILE, VECTORS_FILE, META_FILE];
  const missing = required.filter((file) => !fs.existsSync(file));
  if (missing.length === 0) return;

  console.log(`Missing index artifacts: ${missing.map(relative).join(", ")}`);

  if (fs.existsSync(SEED_FILE)) {
    console.log("Rebuilding index from seed (local embeddings, no crawl)…");
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
    if (result.status === 0) return;
    console.warn("Index rebuild failed; falling back to empty index.");
  }

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
  console.log("Wrote empty index stubs.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

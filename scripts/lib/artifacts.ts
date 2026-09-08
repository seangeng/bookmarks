import fs from "node:fs/promises";
import path from "node:path";

import { CRAWL_DIR, readJson, urlKey } from "./fs-data";
import { CrawlRecordSchema, type CrawlRecord } from "../../src/lib/types";

/**
 * Loads crawl artifacts from disk, validating each one. Artifacts are committed
 * to git and hand-editable, so a malformed file is reported and skipped rather
 * than allowed to poison the index.
 */
export async function loadCrawlRecords(): Promise<{
  records: Map<string, CrawlRecord>;
  invalid: string[];
}> {
  const records = new Map<string, CrawlRecord>();
  const invalid: string[] = [];

  let files: string[] = [];
  try {
    files = await fs.readdir(CRAWL_DIR);
  } catch {
    return { records, invalid };
  }

  for (const file of files) {
    if (!file.endsWith(".json") || file === "index.json") continue;
    const raw = await readJson<unknown>(path.join(CRAWL_DIR, file));
    const parsed = CrawlRecordSchema.safeParse(raw);
    if (!parsed.success) {
      invalid.push(file);
      continue;
    }
    records.set(parsed.data.key ?? urlKey(parsed.data.url), parsed.data);
  }

  return { records, invalid };
}

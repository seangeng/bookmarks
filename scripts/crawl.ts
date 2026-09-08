/**
 * Crawl every unique external URL referenced by the bookmark seed.
 *
 *   npm run crawl                 # crawl anything not yet cached
 *   npm run crawl -- --force      # re-crawl everything
 *   npm run crawl -- --max-age=7  # re-crawl artifacts older than 7 days
 *   npm run crawl -- --limit=20 --concurrency=3 --timeout=15000
 *   npm run crawl -- --retry-failed
 *   npm run crawl -- --no-expand-short-links   # skip t.co resolution
 *
 * Artifacts land in data/crawls/<key>.json with a rollup in data/crawls/index.json.
 */
import fs from "node:fs/promises";
import path from "node:path";

import { loadCrawlRecords } from "./lib/artifacts";
import { crawlAll, DEFAULT_CRAWL_OPTIONS } from "./lib/crawler";
import {
  CRAWL_DIR,
  CRAWL_INDEX_FILE,
  loadEnv,
  numberArg,
  parseArgs,
  relative,
  urlKey,
  writeJson,
} from "./lib/fs-data";
import { readSeedOrExit } from "./lib/seed";
import {
  loadShortLinks,
  resolveShortLinks,
  resolvedDestinations,
  saveShortLinks,
} from "./lib/shortlinks";
import { domainOf, isExternalContentUrl } from "../src/lib/text";
import type { CrawlStatus } from "../src/lib/types";

type CrawlIndex = {
  generated_at: string;
  counts: Record<string, number>;
  entries: {
    key: string;
    url: string;
    status: CrawlStatus;
    http_status?: number;
    title?: string;
    word_count?: number;
    fetched_at: string;
  }[];
};

const RETRYABLE: CrawlStatus[] = ["timeout", "network_error", "http_error", "empty"];

async function main(): Promise<void> {
  await loadEnv();
  const args = parseArgs();

  const { bookmarks } = await readSeedOrExit();

  /* Optionally resolve link shorteners so their destinations get crawled. */
  const shortUrls = [...new Set(bookmarks.flatMap((bookmark) => bookmark.short_urls))];
  const shortLinks = await loadShortLinks();
  // The library is the set of sites behind the bookmarks, and most of those
  // sites are only reachable through a t.co redirect, so unwrapping is on by
  // default. Resolved destinations that turn out to be x.com are dropped.
  const expand = !args.flags.has("no-expand-short-links");

  if (expand) {
    const pending = shortUrls.filter(
      (url) => !shortLinks[url] || (args.flags.has("force") && true),
    );
    if (pending.length > 0) {
      console.log(
        `Resolving ${pending.length} shortened link(s). Note: t.co disallows all ` +
          "non-Twitterbot agents in robots.txt; only the redirect is requested.",
      );
      const resolved = await resolveShortLinks(pending, {
        concurrency: 4,
        timeoutMs: numberArg(args, "timeout", Number(process.env.CRAWL_TIMEOUT_MS ?? 10_000)),
        onResult: (shortUrl, result, done, total) => {
          console.log(
            `[${String(done).padStart(3)}/${total}] ${result.status.padEnd(8)} ` +
              `${shortUrl} -> ${result.url ?? result.error ?? ""}`,
          );
        },
      });
      Object.assign(shortLinks, resolved);
      await saveShortLinks(shortLinks);
    }
  } else if (shortUrls.length > 0) {
    const known = shortUrls.filter((url) => shortLinks[url]?.url).length;
    console.log(
      `${shortUrls.length} shortened link(s) in the seed, ${known} already resolved. ` +
        "Skipping resolution (--no-expand-short-links).",
    );
  }

  // Most t.co links unwrap to x.com rather than to a site, so resolved
  // destinations go through the same external-content filter as the export's
  // own URLs — otherwise the queue fills with links back into X.
  const urls = [
    ...new Set(
      [
        ...bookmarks.flatMap((bookmark) => bookmark.external_urls),
        ...bookmarks.flatMap((bookmark) => resolvedDestinations(bookmark.short_urls, shortLinks)),
      ].filter(isExternalContentUrl),
    ),
  ].sort();

  const { records: existing, invalid } = await loadCrawlRecords();
  if (invalid.length > 0) {
    console.warn(`Ignoring ${invalid.length} malformed artifact(s): ${invalid.join(", ")}`);
  }
  const force = args.flags.has("force");
  const retryFailed = args.flags.has("retry-failed");
  const maxAgeDays = numberArg(args, "max-age", Number.POSITIVE_INFINITY);
  const maxAgeMs = maxAgeDays * 86_400_000;

  const shouldCrawl = (url: string): boolean => {
    if (force) return true;
    const record = existing.get(urlKey(url));
    if (!record) return true;
    if (retryFailed && RETRYABLE.includes(record.status)) return true;
    if (Number.isFinite(maxAgeMs)) {
      return Date.now() - new Date(record.fetched_at).getTime() > maxAgeMs;
    }
    return false;
  };

  const limit = numberArg(args, "limit", Number.POSITIVE_INFINITY);
  const queue = urls.filter(shouldCrawl).slice(0, Number.isFinite(limit) ? limit : undefined);

  const options = {
    ...DEFAULT_CRAWL_OPTIONS,
    timeoutMs: numberArg(args, "timeout", Number(process.env.CRAWL_TIMEOUT_MS ?? 10_000)),
    concurrency: Math.min(
      5,
      Math.max(1, numberArg(args, "concurrency", Number(process.env.CRAWL_CONCURRENCY ?? 5))),
    ),
    respectRobots: !args.flags.has("ignore-robots"),
  };

  console.log(
    `${bookmarks.length} bookmarks · ${urls.length} unique links · ` +
      `${existing.size} cached · crawling ${queue.length} ` +
      `(concurrency ${options.concurrency}, timeout ${options.timeoutMs}ms)`,
  );

  if (queue.length > 0) {
    const fresh = await crawlAll(queue, options, (record, done, total) => {
      const marker = record.status === "ok" ? "ok  " : record.status.slice(0, 4).padEnd(4);
      const detail = record.status === "ok" ? `${record.word_count ?? 0}w` : (record.error ?? "");
      console.log(
        `[${String(done).padStart(3)}/${total}] ${marker} ${domainOf(record.url).padEnd(28)} ` +
          `${detail}`.trim(),
      );
    });

    for (const record of fresh) {
      await writeJson(path.join(CRAWL_DIR, `${record.key}.json`), record);
      existing.set(record.key, record);
    }
  }

  // Drop artifacts for links that no longer appear in the seed.
  const live = new Set(urls.map(urlKey));
  for (const key of [...existing.keys()]) {
    if (live.has(key)) continue;
    existing.delete(key);
    await fs.rm(path.join(CRAWL_DIR, `${key}.json`), { force: true });
  }

  const records = [...existing.values()].sort((a, b) => a.url.localeCompare(b.url));
  const counts: Record<string, number> = {};
  for (const record of records) counts[record.status] = (counts[record.status] ?? 0) + 1;

  const index: CrawlIndex = {
    generated_at: new Date().toISOString(),
    counts,
    entries: records.map((record) => ({
      key: record.key,
      url: record.url,
      status: record.status,
      http_status: record.http_status,
      title: record.title,
      word_count: record.word_count,
      fetched_at: record.fetched_at,
    })),
  };
  await writeJson(CRAWL_INDEX_FILE, index);

  const summary = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([status, count]) => `${status}=${count}`)
    .join(" ");
  console.log(`\nWrote ${records.length} artifacts to ${relative(CRAWL_DIR)} (${summary})`);
  console.log("Next: npm run index");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

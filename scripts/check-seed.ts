/**
 * Validate the seed without running the pipeline.
 *
 *   npm run check:seed
 *   npm run check:seed -- --min=150
 *
 * Wired into CI so a failed export upload fails the pull request instead of
 * quietly shipping a site that no longer matches its seed.
 */
import { loadEnv, numberArg, parseArgs } from "./lib/fs-data";
import { readSeed } from "./lib/seed";
import { domainOf } from "../src/lib/text";

async function main(): Promise<void> {
  await loadEnv();
  const args = parseArgs();
  const minimum = numberArg(args, "min", 1);

  const seed = await readSeed();
  if (!seed.ok) {
    console.error(`FAIL  ${seed.message}`);
    process.exit(1);
  }

  const { bookmarks, skipped } = seed;
  const links = new Set(bookmarks.flatMap((bookmark) => bookmark.external_urls));
  const authors = new Set(bookmarks.map((bookmark) => bookmark.author.handle.toLowerCase()));
  const domains = new Set([...links].map(domainOf).filter(Boolean));
  const undated = bookmarks.filter(
    (bookmark) => new Date(bookmark.created_at).getTime() <= 0,
  ).length;
  const unknownAuthors = bookmarks.filter(
    (bookmark) => bookmark.author.handle === "unknown",
  ).length;
  const empty = bookmarks.filter((bookmark) => bookmark.text.trim().length === 0).length;

  console.log(
    `OK    ${bookmarks.length} bookmarks · ${links.size} links · ${domains.size} domains · ` +
      `${authors.size} authors`,
  );

  // Soft signals: these usually mean the adapter is reading the wrong field
  // names for this export rather than that the data is genuinely missing.
  const warn = (count: number, label: string) => {
    if (count === 0) return;
    const share = Math.round((count / bookmarks.length) * 100);
    console.warn(`WARN  ${count} bookmarks (${share}%) ${label}`);
  };
  warn(skipped, "were rejected as malformed");
  warn(unknownAuthors, "have no resolvable author handle");
  warn(undated, "have no usable created_at");
  warn(empty, "have empty text");

  if (bookmarks.length < minimum) {
    console.error(`FAIL  expected at least ${minimum} bookmarks, found ${bookmarks.length}`);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

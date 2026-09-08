/**
 * Build the search index.
 *
 * The library's unit is an external site, not a bookmark: bookmarks supply
 * URLs and nothing else. Every unique external URL becomes one entry, enriched
 * with its crawled title/description/body, auto-tagged from that content, and
 * embedded. Posts with no external link produce nothing.
 *
 *   npm run index                    # auto-detect provider + store from env
 *   npm run index -- --provider=local --store=local
 *   npm run index -- --no-llm        # force heuristic topic classification
 *   npm run index -- --dry-run       # report only, write nothing
 *
 * Outputs:
 *   data/index/links.json      read model rendered by the site
 *   data/index/vectors.json    local vector store (also the Upstash payload)
 *   data/index/meta.json       provider/store/topic stats
 */
import { loadCrawlRecords } from "./lib/artifacts";
import {
  INDEX_DIR,
  LINKS_INDEX_FILE,
  META_FILE,
  VECTORS_FILE,
  loadEnv,
  numberArg,
  parseArgs,
  relative,
  urlKey,
  writeJson,
} from "./lib/fs-data";
import { readSeedOrExit } from "./lib/seed";
import { loadShortLinks, resolvedDestinations } from "./lib/shortlinks";
import { classifyWithLlm } from "./lib/classify";
import { cosineSimilarity, resolveEmbeddingProvider } from "../src/lib/embeddings";
import {
  domainOf,
  isExternalContentUrl,
  titleFromUrl,
  truncate,
} from "../src/lib/text";
import { DEFAULT_TOPIC, TOPICS, pickTopics, scoreTopics, toTopicSlug } from "../src/lib/topics";
import type {
  CrawlRecord,
  EmbeddingProviderName,
  IndexMeta,
  LibraryLink,
  StoredVectors,
  VectorStoreName,
} from "../src/lib/types";
import {
  createUpstashVectorStore,
  hasUpstashCredentials,
  resolveVectorStoreName,
} from "../src/lib/vector-store";

/** Body text kept on each entry for the detail page. */
const EXCERPT_CHARS = 2400;
/** Body text fed to the embedding. */
const EMBED_CHARS = 1600;
const RELATED_COUNT = 6;

type Candidate = {
  url: string;
  /** Earliest bookmark date referencing this URL. */
  savedAt: string;
  saves: number;
};

/** Collapses every bookmark's links into one entry per unique external URL. */
function collectCandidates(
  bookmarks: { created_at: string; external_urls: string[]; short_urls: string[] }[],
  shortLinks: Awaited<ReturnType<typeof loadShortLinks>>,
): Candidate[] {
  const byUrl = new Map<string, Candidate>();

  for (const bookmark of bookmarks) {
    const urls = [
      ...bookmark.external_urls,
      ...resolvedDestinations(bookmark.short_urls, shortLinks),
    ].filter(isExternalContentUrl);

    for (const url of new Set(urls)) {
      const existing = byUrl.get(url);
      if (existing) {
        existing.saves += 1;
        if (bookmark.created_at < existing.savedAt) existing.savedAt = bookmark.created_at;
        continue;
      }
      byUrl.set(url, { url, savedAt: bookmark.created_at, saves: 1 });
    }
  }

  return [...byUrl.values()].sort((a, b) => (a.savedAt < b.savedAt ? 1 : -1));
}

/** Text the classifier and the embedding see: the page, never the post. */
function pageText(url: string, crawl: CrawlRecord | undefined, limit: number): string {
  return [
    crawl?.title,
    crawl?.description,
    crawl?.site_name,
    domainOf(url).replace(/\./g, " "),
    crawl?.text?.slice(0, limit),
  ]
    .filter(Boolean)
    .join("\n");
}

async function main(): Promise<void> {
  await loadEnv();
  const args = parseArgs();
  const dryRun = args.flags.has("dry-run");

  const { bookmarks } = await readSeedOrExit();
  const { records: crawls, invalid } = await loadCrawlRecords();
  if (invalid.length > 0) {
    console.warn(`Ignoring ${invalid.length} malformed artifact(s): ${invalid.join(", ")}`);
  }

  const shortLinks = await loadShortLinks();
  const candidates = collectCandidates(bookmarks, shortLinks);
  const linkless = bookmarks.filter(
    (bookmark) =>
      [...bookmark.external_urls, ...resolvedDestinations(bookmark.short_urls, shortLinks)].filter(
        isExternalContentUrl,
      ).length === 0,
  ).length;

  console.log(
    `${bookmarks.length} source bookmarks -> ${candidates.length} unique external links ` +
      `(${linkless} bookmarks had none)`,
  );
  if (candidates.length === 0) {
    console.error("No external links to index.");
    process.exit(1);
  }

  /* ------------------------------------------------------------- topics */

  const useLlm =
    !args.flags.has("no-llm") &&
    Boolean(process.env.OPENAI_API_KEY) &&
    (args.values.get("classifier") ?? "auto") !== "heuristic";

  const prepared = candidates.map((candidate) => {
    const crawl = crawls.get(urlKey(candidate.url));
    return { candidate, crawl, classifierText: pageText(candidate.url, crawl, 1500) };
  });

  const heuristicScores = prepared.map(({ candidate, classifierText }) =>
    scoreTopics({ text: classifierText, urls: [candidate.url] }),
  );

  let llmTopics: (string[] | null)[] = prepared.map(() => null);
  if (useLlm) {
    console.log("Classifying topics with LLM…");
    try {
      llmTopics = await classifyWithLlm(
        prepared.map(({ candidate, classifierText }) => ({
          id: candidate.url,
          text: truncate(classifierText, 1400),
        })),
      );
    } catch (error) {
      console.warn(
        `LLM classification failed, falling back to heuristics: ${
          error instanceof Error ? error.message : error
        }`,
      );
      llmTopics = prepared.map(() => null);
    }
  }

  /* -------------------------------------------------------------- build */

  const links: LibraryLink[] = prepared.map(({ candidate, crawl }, position) => {
    const scores = heuristicScores[position];
    const fromLlm = (llmTopics[position] ?? [])
      .map(toTopicSlug)
      .filter((slug): slug is NonNullable<typeof slug> => Boolean(slug));
    const topics = fromLlm.length > 0 ? fromLlm.slice(0, 3) : pickTopics(scores);

    const title = crawl?.title?.trim() || titleFromUrl(candidate.url);
    const excerpt = crawl?.text ? truncate(crawl.text, EXCERPT_CHARS) : undefined;

    const searchText = [
      title,
      crawl?.description,
      crawl?.site_name,
      domainOf(candidate.url),
      crawl?.text,
      topics.map((topic) => topic.replace(/-/g, " ")).join(" "),
    ]
      .filter(Boolean)
      .join("\n");

    return {
      id: urlKey(candidate.url),
      url: candidate.url,
      domain: domainOf(candidate.url),
      title,
      description: crawl?.description,
      site_name: crawl?.site_name,
      excerpt,
      word_count: crawl?.word_count ?? 0,
      published_at: crawl?.published_at,
      status: crawl?.status ?? "not_crawled",
      http_status: crawl?.http_status,
      error: crawl?.error,
      fetched_at: crawl?.fetched_at,
      saved_at: candidate.savedAt,
      saves: candidate.saves,
      topics,
      topic_scores: scores,
      search_text: searchText,
      related: [],
    };
  });

  /* --------------------------------------------------------- embeddings */

  const provider = resolveEmbeddingProvider(
    args.values.get("provider") as EmbeddingProviderName | undefined,
  );
  console.log(
    `Embedding with ${provider.name} (${provider.model}, ${provider.dimensions}d)` +
      `${provider.name === "local" ? " — set OPENAI_API_KEY for true semantic search" : ""}`,
  );

  const documents = prepared.map(({ candidate, crawl }, position) =>
    [pageText(candidate.url, crawl, EMBED_CHARS), links[position].topics.join(" ")].join("\n"),
  );

  const batchSize = numberArg(args, "batch", provider.name === "local" ? 512 : 64);
  const vectors: number[][] = [];
  for (let i = 0; i < documents.length; i += batchSize) {
    const batch = documents.slice(i, i + batchSize);
    vectors.push(...(await provider.embed(batch)));
    if (documents.length > batchSize) {
      console.log(`  embedded ${Math.min(i + batch.length, documents.length)}/${documents.length}`);
    }
  }

  /* ------------------------------------------------------------ related */

  links.forEach((link, position) => {
    link.related = links
      .map((candidate, other) =>
        other === position
          ? null
          : { id: candidate.id, score: cosineSimilarity(vectors[position], vectors[other]) },
      )
      .filter((entry): entry is { id: string; score: number } => entry !== null)
      .sort((a, b) => b.score - a.score)
      .filter((entry) => entry.score > 0.02)
      .slice(0, RELATED_COUNT)
      .map((entry) => entry.id);
  });

  /* -------------------------------------------------------------- write */

  const topicCounts = TOPICS.map((topic) => ({
    slug: topic.slug,
    count: links.filter((link) => link.topics.includes(topic.slug)).length,
  })).filter((entry) => entry.count > 0 || entry.slug === DEFAULT_TOPIC);

  const storeName: VectorStoreName = resolveVectorStoreName(
    args.values.get("store") as VectorStoreName | undefined,
  );

  const stored: StoredVectors = {
    dimensions: provider.dimensions,
    provider: provider.name,
    model: provider.model,
    vectors: Object.fromEntries(
      links.map((link, position) => [
        link.id,
        vectors[position].map((value) => Math.round(value * 1e5) / 1e5),
      ]),
    ),
  };

  const meta: IndexMeta = {
    generated_at: new Date().toISOString(),
    link_count: links.length,
    source_bookmark_count: bookmarks.length,
    crawled_link_count: links.filter((link) => link.status === "ok").length,
    embedding: {
      provider: provider.name,
      model: provider.model,
      dimensions: provider.dimensions,
    },
    vector_store: storeName,
    classifier: llmTopics.some(Boolean) ? "llm" : "heuristic",
    topics: topicCounts,
  };

  if (dryRun) {
    console.log("\n--dry-run: nothing written");
    console.log(JSON.stringify(meta, null, 2));
    return;
  }

  await writeJson(LINKS_INDEX_FILE, links);
  await writeJson(VECTORS_FILE, stored, false);
  await writeJson(META_FILE, meta);

  if (storeName === "upstash") {
    if (!hasUpstashCredentials()) {
      console.warn("Upstash requested but credentials are missing — skipped remote upsert.");
    } else {
      console.log("Upserting vectors to Upstash Vector…");
      const store = await createUpstashVectorStore();
      if (!args.flags.has("no-reset")) await store.reset();
      await store.upsert(
        links.map((link, position) => ({
          id: link.id,
          vector: vectors[position],
          metadata: { topics: link.topics },
        })),
      );
      console.log(`Upserted ${links.length} vectors.`);
    }
  }

  console.log(`\nWrote ${relative(INDEX_DIR)}/{links,vectors,meta}.json`);
  console.log(
    `Topics: ${meta.topics.map((topic) => `${topic.slug}=${topic.count}`).join(" ")} ` +
      `· classifier=${meta.classifier} · store=${meta.vector_store}`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
